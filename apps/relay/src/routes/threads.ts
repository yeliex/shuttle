import { Hono, type Context } from 'hono';

import {
    createSecret,
    hashSecret,
    readJsonObject,
    readOptionalEmail,
    readOptionalString,
    readPermission,
    readRequiredString,
} from '../request.js';
import type { RelayDatabase } from '../database.js';
import { createInviteEmailContent } from '../mail.js';
import type { RelayHonoEnvironment } from '../runtime.js';

interface ThreadAccess {
    canPreview?: boolean;
    codexThreadId: string;
    deviceId: string;
    deviceRevokedAt?: Date | null;
    ownerId: string;
    ownerName: string;
    permission?: string;
    title?: string | null;
}

const getThreadAccess = async (
    database: RelayDatabase,
    sharedThreadId: string,
    userId: string,
): Promise<ThreadAccess | undefined> => {
    const thread = await database.sharedThread.findUnique({
        where: { id: sharedThreadId },
        select: {
            codexThreadId: true,
            deviceId: true,
            ownerId: true,
            title: true,
            owner: { select: { name: true } },
            device: { select: { revokedAt: true } },
            grants: {
                where: { userId },
                select: { canPreview: true, permission: true },
                take: 1,
            },
        },
    });

    return thread
        ? {
            codexThreadId: thread.codexThreadId,
            canPreview: thread.grants[0]?.canPreview,
            deviceId: thread.deviceId,
            deviceRevokedAt: thread.device.revokedAt,
            ownerId: thread.ownerId,
            ownerName: thread.owner.name,
            permission: thread.grants[0]?.permission,
            title: thread.title,
        }
        : undefined;
};

const canRead = (access: ThreadAccess, userId: string): boolean => (
    access.ownerId === userId || access.permission === 'read' || access.permission === 'message'
);

const canMessage = (access: ThreadAccess, userId: string): boolean => (
    access.ownerId === userId || access.permission === 'message'
);

const closeThreadPreviews = async (
    context: Context<RelayHonoEnvironment>,
    sharedThreadId: string,
): Promise<void> => {
    const services = await context.var.runtime.database.previewService.findMany({
        where: { sharedThreadId },
        select: { deviceId: true, id: true },
    });
    await Promise.all(services.map((service) => (
        context.var.runtime.closePreviewConnections?.(service.deviceId, service.id)
    )));
};

export const threads = new Hono<RelayHonoEnvironment>();

threads.get('/', async (context) => {
    const userId = context.var.principal.userId;
    const rows = await context.var.runtime.database.sharedThread.findMany({
        where: {
            OR: [
                { ownerId: userId },
                { grants: { some: { userId } } },
            ],
        },
        orderBy: { updatedAt: 'desc' },
        select: {
            id: true,
            deviceId: true,
            ownerId: true,
            title: true,
            createdAt: true,
            updatedAt: true,
            device: { select: { name: true } },
            owner: { select: { image: true, name: true } },
            grants: {
                where: { userId },
                select: { canPreview: true, permission: true },
            },
            previewServices: {
                orderBy: { createdAt: 'asc' },
                select: { id: true, localUrl: true, name: true, updatedAt: true },
            },
        },
    });

    return context.json({
        threads: rows.map(({ grants, previewServices, ...thread }) => {
            const owner = thread.ownerId === userId;
            const canPreview = owner || grants[0]?.canPreview === true;
            return {
                ...thread,
                canPreview,
                device: owner ? thread.device : undefined,
                deviceId: owner ? thread.deviceId : undefined,
                permission: owner ? 'owner' : grants[0]?.permission,
                previewServices: canPreview
                    ? previewServices.map(({ localUrl, ...service }) => {
                        const url = new URL(localUrl);
                        return {
                            ...service,
                            port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
                        };
                    })
                    : [],
            };
        }),
    });
});

threads.post('/', async (context) => {
    const principal = context.var.principal;
    if (principal.kind !== 'device') {
        return context.json({ error: 'A registered device is required to share a task' }, 403);
    }

    const body = await readJsonObject(context.req.raw);
    const codexThreadId = readRequiredString(body, 'codexThreadId', 200);
    const title = readOptionalString(body, 'title', 300);
    const ownerId = principal.userId;
    const database = context.var.runtime.database;
    const existing = await database.sharedThread.findUnique({
        where: { ownerId_codexThreadId: { ownerId, codexThreadId } },
        select: { id: true, title: true, createdAt: true },
    });
    if (existing) {
        return context.json({ thread: existing });
    }

    const thread = await database.sharedThread.create({
        data: {
            id: crypto.randomUUID(),
            deviceId: principal.deviceId,
            ownerId,
            codexThreadId,
            title,
        },
        select: { id: true, title: true, createdAt: true },
    });

    return context.json({ thread }, 201);
});

threads.get('/:sharedThreadId', async (context) => {
    const database = context.var.runtime.database;
    const sharedThreadId = context.req.param('sharedThreadId');
    const userId = context.var.principal.userId;
    const access = await getThreadAccess(database, sharedThreadId, userId);
    if (!access || !canRead(access, userId)) {
        return context.json({ error: 'Shared thread not found' }, 404);
    }

    const includeContent = context.req.query('includeContent') !== 'false';
    let content: unknown;
    if (includeContent) {
        const readThread = context.var.runtime.readThread;
        if (!readThread || access.deviceRevokedAt) {
            return context.json({ error: 'The owner device is offline' }, 503);
        }
        try {
            content = await readThread(access.deviceId, access.codexThreadId);
        } catch {
            return context.json({ error: 'Live Codex task read failed' }, 503);
        }
    }

    const thread = await database.sharedThread.findUnique({
        where: { id: sharedThreadId },
        select: {
            id: true,
            deviceId: true,
            ownerId: true,
            title: true,
            createdAt: true,
            updatedAt: true,
            device: { select: { name: true } },
            owner: { select: { email: true, image: true, name: true } },
            previewServices: {
                orderBy: { createdAt: 'asc' },
                select: { id: true, localUrl: true, name: true, updatedAt: true },
            },
        },
    });
    if (!thread) {
        return context.json({ error: 'Shared thread not found' }, 404);
    }
    const ownerDetails = access.ownerId === userId
        ? {
            grants: await database.shareGrant.findMany({
                where: { sharedThreadId },
                orderBy: { createdAt: 'asc' },
                select: {
                    canPreview: true,
                    permission: true,
                    updatedAt: true,
                    user: { select: { email: true, id: true, image: true, name: true } },
                },
            }),
            invites: (await database.shareInvite.findMany({
                where: { sharedThreadId },
                orderBy: { createdAt: 'desc' },
                select: {
                    acceptedAt: true,
                    canPreview: true,
                    createdAt: true,
                    expiresAt: true,
                    id: true,
                    permission: true,
                    recipientEmail: true,
                    token: true,
                },
                take: 20,
            })).map(({ token, ...invite }) => {
                if (!token) {
                    return { ...invite, inviteURL: null };
                }
                const inviteURL = new URL('/app/invite', context.var.runtime.baseURL);
                inviteURL.hash = token;
                return { ...invite, inviteURL: inviteURL.toString() };
            }),
        }
        : {};

    return context.json({
        thread: {
            ...thread,
            ...ownerDetails,
            content: includeContent ? content : undefined,
            device: access.ownerId === userId ? thread.device : undefined,
            deviceId: access.ownerId === userId ? thread.deviceId : undefined,
            canPreview: access.ownerId === userId || access.canPreview === true,
            permission: access.ownerId === userId ? 'owner' : access.permission,
            previewServices: access.ownerId === userId || access.canPreview === true
                ? thread.previewServices.map(({ localUrl, ...service }) => {
                    const url = new URL(localUrl);
                    return {
                        ...service,
                        port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
                    };
                })
                : [],
        },
    });
});

threads.delete('/:sharedThreadId', async (context) => {
    const sharedThreadId = context.req.param('sharedThreadId');
    const owned = await context.var.runtime.database.sharedThread.findFirst({
        where: { id: sharedThreadId, ownerId: context.var.principal.userId },
        select: { id: true },
    });
    if (!owned) {
        return context.json({ error: 'Shared thread not found' }, 404);
    }
    await closeThreadPreviews(context, sharedThreadId);
    const result = await context.var.runtime.database.sharedThread.deleteMany({
        where: {
            id: sharedThreadId,
            ownerId: context.var.principal.userId,
        },
    });

    return result.count === 0
        ? context.json({ error: 'Shared thread not found' }, 404)
        : context.body(null, 204);
});

threads.put('/:sharedThreadId/grants/:userId', async (context) => {
    const database = context.var.runtime.database;
    const sharedThreadId = context.req.param('sharedThreadId');
    const ownerId = context.var.principal.userId;
    const access = await getThreadAccess(database, sharedThreadId, ownerId);
    if (!access || access.ownerId !== ownerId) {
        return context.json({ error: 'Shared thread not found' }, 404);
    }

    const targetUserId = context.req.param('userId');
    if (targetUserId === ownerId) {
        return context.json({ error: 'The owner already has full access' }, 409);
    }

    const body = await readJsonObject(context.req.raw);
    const permission = readPermission(body);
    if (body.canPreview !== undefined && typeof body.canPreview !== 'boolean') {
        return context.json({ error: 'canPreview must be a boolean' }, 400);
    }
    const canPreview = body.canPreview === true;
    const target = await database.user.findUnique({
        where: { id: targetUserId },
        select: { id: true },
    });
    if (!target) {
        return context.json({ error: 'User not found' }, 404);
    }

    const grant = await database.shareGrant.upsert({
        where: { sharedThreadId_userId: { sharedThreadId, userId: targetUserId } },
        create: {
            id: crypto.randomUUID(),
            canPreview,
            permission,
            sharedThreadId,
            userId: targetUserId,
        },
        update: { canPreview, permission },
        select: { canPreview: true, userId: true, permission: true, updatedAt: true },
    });

    if (!canPreview) {
        await closeThreadPreviews(context, sharedThreadId);
    }

    return context.json({ grant });
});

threads.delete('/:sharedThreadId/grants/me', async (context) => {
    const sharedThreadId = context.req.param('sharedThreadId');
    const result = await context.var.runtime.database.shareGrant.deleteMany({
        where: {
            sharedThreadId,
            userId: context.var.principal.userId,
        },
    });

    if (result.count === 0) {
        return context.json({ error: 'Shared thread not found' }, 404);
    }
    await closeThreadPreviews(context, sharedThreadId);
    return context.body(null, 204);
});

threads.delete('/:sharedThreadId/grants/:userId', async (context) => {
    const database = context.var.runtime.database;
    const sharedThreadId = context.req.param('sharedThreadId');
    const ownerId = context.var.principal.userId;
    const access = await getThreadAccess(database, sharedThreadId, ownerId);
    if (!access || access.ownerId !== ownerId) {
        return context.json({ error: 'Shared thread not found' }, 404);
    }

    await database.shareGrant.deleteMany({
        where: { sharedThreadId, userId: context.req.param('userId') },
    });
    await closeThreadPreviews(context, sharedThreadId);
    return context.body(null, 204);
});

threads.post('/:sharedThreadId/invites', async (context) => {
    const database = context.var.runtime.database;
    const sharedThreadId = context.req.param('sharedThreadId');
    const ownerId = context.var.principal.userId;
    const access = await getThreadAccess(database, sharedThreadId, ownerId);
    if (!access || access.ownerId !== ownerId) {
        return context.json({ error: 'Shared thread not found' }, 404);
    }

    const body = await readJsonObject(context.req.raw);
    const recipient = readOptionalEmail(body, 'email');
    const permission = readPermission(body);
    if (body.canPreview !== undefined && typeof body.canPreview !== 'boolean') {
        return context.json({ error: 'canPreview must be a boolean' }, 400);
    }
    const canPreview = body.canPreview === true;
    const expiresInHours = body.expiresInHours === undefined ? 24 : body.expiresInHours;
    if (typeof expiresInHours !== 'number' || expiresInHours <= 0 || expiresInHours > 24 * 30) {
        return context.json({ error: 'expiresInHours must be greater than 0 and at most 720' }, 400);
    }
    const token = createSecret('shuttle_invite');
    const invite = await database.shareInvite.create({
        data: {
            id: crypto.randomUUID(),
            canPreview,
            expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1_000),
            permission,
            recipientEmail: recipient?.toLowerCase(),
            sharedThreadId,
            token: recipient ? null : token,
            tokenHash: await hashSecret(token),
        },
        select: { canPreview: true, id: true, permission: true, expiresAt: true },
    });

    const inviteURL = new URL('/app/invite', context.var.runtime.baseURL);
    inviteURL.hash = token;
    if (!recipient) {
        return context.json({ emailDelivery: 'not-requested', invite, inviteURL: inviteURL.toString(), token }, 201);
    }
    const sendEmail = context.var.runtime.sendEmail;
    if (!sendEmail) {
        return context.json({ emailDelivery: 'not-configured', invite, inviteURL: inviteURL.toString(), token }, 201);
    }

    try {
        const content = createInviteEmailContent({
            expiresAt: invite.expiresAt,
            inviteURL: inviteURL.toString(),
            ownerName: access.ownerName,
            canPreview,
            permission,
            recipient,
            resourceTitle: access.title ?? undefined,
        });
        await sendEmail({ ...content, recipient });
        return context.json({ emailDelivery: 'sent', invite, inviteURL: inviteURL.toString(), token }, 201);
    } catch (error) {
        console.error('Failed to send invitation email', error);
        return context.json({
            emailDelivery: 'failed',
            error: 'Invitation created, but email delivery failed',
            invite,
            inviteURL: inviteURL.toString(),
            token,
        }, 201);
    }
});

threads.delete('/:sharedThreadId/invites/:inviteId', async (context) => {
    const database = context.var.runtime.database;
    const sharedThreadId = context.req.param('sharedThreadId');
    const ownerId = context.var.principal.userId;
    const access = await getThreadAccess(database, sharedThreadId, ownerId);
    if (!access || access.ownerId !== ownerId) {
        return context.json({ error: 'Shared thread not found' }, 404);
    }

    const result = await database.shareInvite.deleteMany({
        where: {
            id: context.req.param('inviteId'),
            sharedThreadId,
        },
    });
    return result.count === 0
        ? context.json({ error: 'Invitation not found' }, 404)
        : context.body(null, 204);
});

threads.post('/:sharedThreadId/messages', async (context) => {
    const database = context.var.runtime.database;
    const sharedThreadId = context.req.param('sharedThreadId');
    const userId = context.var.principal.userId;
    const access = await getThreadAccess(database, sharedThreadId, userId);
    if (!access || !canMessage(access, userId) || access.deviceRevokedAt) {
        return context.json({ error: 'Shared thread not found' }, 404);
    }

    const body = await readJsonObject(context.req.raw);
    const prompt = readRequiredString(body, 'prompt', 100_000);
    const deliverMessage = context.var.runtime.deliverMessage;
    if (!deliverMessage) {
        return context.json({ error: 'Synchronous message delivery is unavailable' }, 503);
    }

    try {
        await deliverMessage(access.deviceId, access.codexThreadId, prompt);
        return context.json({ delivered: true });
    } catch {
        return context.json({ error: 'Codex message delivery failed' }, 503);
    }
});

export const invites = new Hono<RelayHonoEnvironment>();

invites.post('/inspect', async (context) => {
    const principal = context.var.principal;
    if (principal.kind !== 'session') {
        return context.json({ error: 'A browser session is required to inspect an invite' }, 403);
    }

    const database = context.var.runtime.database;
    const body = await readJsonObject(context.req.raw);
    const token = readRequiredString(body, 'token', 200);
    const invite = await database.shareInvite.findUnique({
        where: { tokenHash: await hashSecret(token) },
        select: {
            acceptedAt: true,
            canPreview: true,
            expiresAt: true,
            permission: true,
            recipientEmail: true,
            sharedThread: {
                select: {
                    id: true,
                    ownerId: true,
                    title: true,
                    owner: { select: { image: true, name: true } },
                },
            },
        },
    });
    if (!invite || invite.acceptedAt || invite.expiresAt <= new Date()) {
        return context.json({ error: 'Invite is invalid or expired' }, 404);
    }
    if (invite.sharedThread.ownerId === principal.userId) {
        return context.json({ error: 'You already own this shared task' }, 409);
    }
    if (invite.recipientEmail) {
        const user = await database.user.findUnique({
            where: { id: principal.userId },
            select: { email: true },
        });
        if (!user || user.email.toLowerCase() !== invite.recipientEmail) {
            return context.json({ error: 'Invite is intended for a different account' }, 403);
        }
    }

    return context.json({
        invite: {
            expiresAt: invite.expiresAt,
            canPreview: invite.canPreview,
            permission: invite.permission,
            recipientEmailBound: invite.recipientEmail !== null,
            sharedThread: {
                id: invite.sharedThread.id,
                owner: invite.sharedThread.owner,
                title: invite.sharedThread.title,
            },
        },
    });
});

invites.post('/accept', async (context) => {
    const principal = context.var.principal;
    if (principal.kind !== 'session') {
        return context.json({ error: 'A browser session is required to accept an invite' }, 403);
    }

    const database = context.var.runtime.database;
    const body = await readJsonObject(context.req.raw);
    const token = readRequiredString(body, 'token', 200);
    const invite = await database.shareInvite.findUnique({
        where: { tokenHash: await hashSecret(token) },
        select: {
            id: true,
            canPreview: true,
            sharedThreadId: true,
            permission: true,
            recipientEmail: true,
            expiresAt: true,
            acceptedAt: true,
            sharedThread: { select: { ownerId: true } },
        },
    });
    if (!invite || invite.acceptedAt || invite.expiresAt <= new Date()) {
        return context.json({ error: 'Invite is invalid or expired' }, 404);
    }
    if (invite.sharedThread.ownerId === principal.userId) {
        return context.json({ error: 'You already own this shared task' }, 409);
    }
    if (invite.recipientEmail) {
        const user = await database.user.findUnique({
            where: { id: principal.userId },
            select: { email: true },
        });
        if (!user || user.email.toLowerCase() !== invite.recipientEmail) {
            return context.json({ error: 'Invite is intended for a different account' }, 403);
        }
    }

    const currentGrant = await database.shareGrant.findUnique({
        where: {
            sharedThreadId_userId: {
                sharedThreadId: invite.sharedThreadId,
                userId: principal.userId,
            },
        },
        select: { canPreview: true, permission: true },
    });
    const permission = currentGrant?.permission === 'message' ? 'message' : invite.permission;
    const canPreview = currentGrant?.canPreview === true || invite.canPreview;
    await database.shareGrant.upsert({
        where: {
            sharedThreadId_userId: {
                sharedThreadId: invite.sharedThreadId,
                userId: principal.userId,
            },
        },
        create: {
            id: crypto.randomUUID(),
            canPreview,
            permission,
            sharedThreadId: invite.sharedThreadId,
            userId: principal.userId,
        },
        update: { canPreview, permission },
    });
    await database.shareInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date(), acceptedById: principal.userId },
    });

    return context.json({ sharedThreadId: invite.sharedThreadId });
});
