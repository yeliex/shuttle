import { Hono, type Context } from 'hono';

import {
    createSecret,
    hashSecret,
    readJsonObject,
    readOptionalString,
    readPermission,
    readRequiredString,
} from '../request.js';
import type { RelayDatabase } from '../database.js';
import { createInviteEmailContent } from '../mail.js';
import type { RelayHonoEnvironment } from '../runtime.js';
import { activeShare, grantAudience } from '../share-access.js';

interface ThreadAccess {
    canPreview?: boolean;
    codexThreadId: string;
    deviceId: string;
    deviceRevokedAt?: Date | null;
    ownerId: string;
    ownerName: string;
    permission?: string;
    title?: string | null;
    expiresAt?: Date | null;
}

const getThreadAccess = async (
    database: RelayDatabase,
    sharedThreadId: string,
    userId: string,
): Promise<ThreadAccess | undefined> => {
    const audience = await grantAudience(database, userId);
    const thread = await database.sharedThread.findUnique({
        where: { id: sharedThreadId },
        select: {
            codexThreadId: true,
            deviceId: true,
            ownerId: true,
            title: true,
            expiresAt: true,
            owner: { select: { name: true } },
            device: { select: { revokedAt: true } },
            grants: {
                where: audience,
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
            expiresAt: thread.expiresAt,
        }
        : undefined;
};

const canRead = (access: ThreadAccess, userId: string): boolean => (
    access.ownerId === userId || ((!access.expiresAt || access.expiresAt > new Date())
        && (access.permission === 'read' || access.permission === 'message'))
);

const canMessage = (access: ThreadAccess, userId: string): boolean => (
    access.ownerId === userId || ((!access.expiresAt || access.expiresAt > new Date()) && access.permission === 'message')
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
    const audience = await grantAudience(context.var.runtime.database, userId);
    const rows = await context.var.runtime.database.sharedThread.findMany({
        where: {
            OR: [
                { ownerId: userId },
                { AND: [activeShare(), { grants: { some: audience } }] },
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
            _count: { select: { grants: true } },
            device: { select: { name: true } },
            owner: { select: { image: true, name: true } },
            grants: {
                where: audience,
                select: { canPreview: true, permission: true },
            },
            previewServices: {
                orderBy: { createdAt: 'asc' },
                select: { id: true, localUrl: true, name: true, updatedAt: true },
            },
        },
    });

    return context.json({
        threads: rows.map(({ grants, previewServices, _count, ...thread }) => {
            const owner = thread.ownerId === userId;
            const canPreview = owner || grants[0]?.canPreview === true;
            return {
                ...thread,
                canPreview,
                grantCount: owner ? _count.grants : undefined,
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

threads.get('/recipients', async (context) => {
    const query = context.req.query('q')?.trim() ?? '';
    if (query.length < 2) return context.json({ users: [] });
    const users = await context.var.runtime.database.user.findMany({
        where: {
            disabledAt: null,
            emailVerified: true,
            OR: [{ email: { contains: query.toLowerCase() } }, { name: { contains: query } }],
            id: { not: context.var.principal.userId },
        },
        select: { email: true, name: true },
        orderBy: { email: 'asc' },
        take: 10,
    });
    return context.json({ users });
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
            expiresAt: true,
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
                    id: true,
                    email: true,
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
                    restricted: true,
                    singleUse: true,
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

threads.put('/:sharedThreadId/grants/:grantId', async (context) => {
    const database = context.var.runtime.database;
    const sharedThreadId = context.req.param('sharedThreadId');
    const ownerId = context.var.principal.userId;
    const access = await getThreadAccess(database, sharedThreadId, ownerId);
    if (!access || access.ownerId !== ownerId) {
        return context.json({ error: 'Shared thread not found' }, 404);
    }

    const body = await readJsonObject(context.req.raw);
    const permission = readPermission(body);
    if (body.canPreview !== undefined && typeof body.canPreview !== 'boolean') {
        return context.json({ error: 'canPreview must be a boolean' }, 400);
    }
    const canPreview = body.canPreview === true;
    const target = await database.shareGrant.findFirst({
        where: { id: context.req.param('grantId'), sharedThreadId },
        select: { id: true },
    });
    if (!target) {
        return context.json({ error: 'Grant not found' }, 404);
    }

    const grant = await database.shareGrant.update({
        where: { id: target.id },
        data: { canPreview, permission },
        select: { id: true, canPreview: true, permission: true, updatedAt: true },
    });

    if (!canPreview) {
        await closeThreadPreviews(context, sharedThreadId);
    }

    return context.json({ grant });
});

threads.delete('/:sharedThreadId/grants/me', async (context) => {
    const sharedThreadId = context.req.param('sharedThreadId');
    const audience = await grantAudience(context.var.runtime.database, context.var.principal.userId);
    const result = await context.var.runtime.database.shareGrant.deleteMany({
        where: {
            sharedThreadId,
            ...audience,
        },
    });

    if (result.count === 0) {
        return context.json({ error: 'Shared thread not found' }, 404);
    }
    await closeThreadPreviews(context, sharedThreadId);
    return context.body(null, 204);
});

threads.delete('/:sharedThreadId/grants/:grantId', async (context) => {
    const database = context.var.runtime.database;
    const sharedThreadId = context.req.param('sharedThreadId');
    const ownerId = context.var.principal.userId;
    const access = await getThreadAccess(database, sharedThreadId, ownerId);
    if (!access || access.ownerId !== ownerId) {
        return context.json({ error: 'Shared thread not found' }, 404);
    }

    await database.shareGrant.deleteMany({
        where: { sharedThreadId, id: context.req.param('grantId') },
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
    if (!Array.isArray(body.emails) || body.emails.length > 50
        || body.emails.some((email) => typeof email !== 'string'
            || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email.trim()))) {
        return context.json({ error: 'emails must contain at most 50 valid email addresses' }, 400);
    }
    const emails = [...new Set((body.emails as string[]).map((email) => email.trim().toLowerCase()))];
    const permission = readPermission(body);
    if (typeof body.canPreview !== 'boolean' || typeof body.singleUse !== 'boolean') {
        return context.json({ error: 'canPreview and singleUse must be booleans' }, 400);
    }
    const expiresInHours = body.expiresInHours;
    if (expiresInHours !== undefined && expiresInHours !== null && (typeof expiresInHours !== 'number' || ![24, 168, 720].includes(expiresInHours))) {
        return context.json({ error: 'expiresInHours must be 24, 168, 720, or null' }, 400);
    }
    const current = await database.shareInvite.findUnique({ where: { id: sharedThreadId }, select: { token: true, singleUse: true } });
    if (expiresInHours === undefined && !current) {
        return context.json({ error: 'Choose an authorization lifetime for a new share link' }, 400);
    }
    // 网页编辑可保留截止时间；只有明确选择新期限才续期，与原生端显式授权一致。
    const expiresAt = expiresInHours === undefined ? access.expiresAt ?? null
        : expiresInHours === null ? null : new Date(Date.now() + expiresInHours * 3_600_000);
    const canPreview = body.canPreview;
    const restricted = emails.length > 0;
    const singleUse = !restricted && body.singleUse;
    const sendEmail = context.var.runtime.sendEmail;
    if (restricted && !sendEmail) return context.json({ error: 'Invitation email delivery is not configured' }, 503);

    // 一个分享始终使用同一链接；重新配置先关闭旧授权，避免中途暴露旧权限。
    await database.sharedThread.update({ where: { id: sharedThreadId }, data: { expiresAt: new Date(0) } });
    await closeThreadPreviews(context, sharedThreadId);
    const token = current?.token ?? createSecret('shuttle_invite');
    await database.shareInvite.deleteMany({ where: { sharedThreadId, id: { not: sharedThreadId } } });
    if (restricted) {
        await database.shareGrant.deleteMany({ where: { sharedThreadId, email: { notIn: emails } } });
    }
    await database.shareGrant.updateMany({ where: { sharedThreadId }, data: { canPreview, permission } });
    const invite = await database.shareInvite.upsert({
        where: { id: sharedThreadId },
        create: {
            id: sharedThreadId, sharedThreadId, token, tokenHash: await hashSecret(token),
            canPreview, permission, restricted, singleUse, expiresAt,
        },
        update: {
            canPreview, permission, restricted, singleUse, expiresAt,
            ...(!singleUse || !current?.singleUse ? { acceptedAt: null, acceptedById: null } : {}),
        },
        select: { canPreview: true, id: true, permission: true, expiresAt: true },
    });
    for (const email of emails) {
        const user = await database.user.findUnique({ where: { email }, select: { id: true, emailVerified: true } });
        await database.shareGrant.upsert({
            where: { sharedThreadId_email: { sharedThreadId, email } },
            create: {
                id: crypto.randomUUID(), sharedThreadId, email,
                userId: user?.emailVerified ? user.id : null, permission, canPreview,
            },
            update: { canPreview, permission, userId: user?.emailVerified ? user.id : null },
        });
    }
    await database.sharedThread.update({ where: { id: sharedThreadId }, data: { expiresAt } });
    const inviteURL = new URL('/app/invite', context.var.runtime.baseURL);
    inviteURL.hash = token;
    const failedEmails: string[] = [];
    if (sendEmail) {
        for (const recipient of emails) {
            try {
                const content = createInviteEmailContent({
                    expiresAt, inviteURL: inviteURL.toString(), ownerName: access.ownerName,
                    canPreview, permission, recipient, resourceTitle: access.title ?? undefined,
                });
                await sendEmail({ ...content, recipient });
            } catch {
                failedEmails.push(recipient);
            }
        }
    }
    return context.json({
        emailDelivery: !restricted ? 'not-requested' : failedEmails.length ? 'failed' : 'sent',
        failedEmails, invite, inviteURL: inviteURL.toString(), token,
    }, 201);
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
        return context.json({ error: 'Codex queue submission is unavailable' }, 503);
    }

    try {
        await deliverMessage(access.deviceId, access.codexThreadId, prompt);
        return context.json({ queued: true });
    } catch (error) {
        // 只放行 Companion 的固定归档提示，其他设备错误仍需脱敏。
        if (error instanceof Error
            && error.message === 'Codex task is archived. The message was not sent. Ask the owner to unarchive the task before trying again.') {
            return context.json({ error: error.message }, 409);
        }
        return context.json({ error: 'Codex queue submission failed or its result is unknown. Check the task queue before sending again.' }, 503);
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
    const audience = await grantAudience(database, principal.userId);
    const invite = await database.shareInvite.findUnique({
        where: { tokenHash: await hashSecret(token) },
        include: {
            sharedThread: {
                select: {
                    id: true, ownerId: true, title: true, expiresAt: true,
                    owner: { select: { image: true, name: true } },
                    grants: { where: audience, take: 1 },
                },
            },
        },
    });
    if (!invite || (invite.sharedThread.expiresAt && invite.sharedThread.expiresAt <= new Date())
        || (invite.expiresAt && invite.expiresAt <= new Date())) {
        return context.json({ error: 'Share authorization is invalid or expired' }, 404);
    }
    const grant = invite.sharedThread.grants[0];
    const hasAccess = Boolean(grant) || invite.sharedThread.ownerId === principal.userId;
    if (!hasAccess && (invite.restricted || (invite.singleUse && (invite.acceptedAt
        || (invite.acceptedById && invite.acceptedById !== principal.userId))))) {
        return context.json({ error: 'This account does not have access to this share' }, 403);
    }
    return context.json({
        invite: {
            expiresAt: invite.sharedThread.expiresAt,
            canPreview: grant?.canPreview ?? invite.canPreview,
            permission: grant?.permission ?? invite.permission,
            recipientEmailBound: invite.restricted,
            singleUse: invite.singleUse,
            hasAccess,
            sharedThread: { id: invite.sharedThread.id, owner: invite.sharedThread.owner, title: invite.sharedThread.title },
        },
    });
});

invites.post('/accept', async (context) => {
    const principal = context.var.principal;
    // 浏览器和 Companion 都代表经过认证的用户，沿用同一套邮箱、有效期和单次领取校验。
    const database = context.var.runtime.database;
    const body = await readJsonObject(context.req.raw);
    const token = readRequiredString(body, 'token', 200);
    const audience = await grantAudience(database, principal.userId);
    const invite = await database.shareInvite.findUnique({
        where: { tokenHash: await hashSecret(token) },
        include: { sharedThread: { select: { ownerId: true, expiresAt: true, grants: { where: audience, take: 1 } } } },
    });
    if (!invite || (invite.sharedThread.expiresAt && invite.sharedThread.expiresAt <= new Date())
        || (invite.expiresAt && invite.expiresAt <= new Date())) {
        return context.json({ error: 'Share authorization is invalid or expired' }, 404);
    }
    if (invite.sharedThread.ownerId === principal.userId || invite.sharedThread.grants.length) {
        return context.json({ sharedThreadId: invite.sharedThreadId });
    }
    if (invite.restricted) {
        return context.json({ error: 'This account does not have access to this share' }, 403);
    }
    const user = await database.user.findUnique({
        where: { id: principal.userId }, select: { email: true, emailVerified: true },
    });
    if (!user?.emailVerified) return context.json({ error: 'Verify your email before joining a share' }, 403);
    if (invite.singleUse) {
        // 只在领取时原子占用；同一账户可重试，其他账户不能同时领取。
        const claimed = await database.shareInvite.updateMany({
            where: {
                id: invite.id, restricted: false, singleUse: true,
                sharedThread: activeShare(),
                acceptedAt: null,
                OR: [{ acceptedById: null }, { acceptedById: principal.userId }],
            },
            data: { acceptedById: principal.userId },
        });
        if (!claimed.count) return context.json({ error: 'This link has already been used or expired' }, 409);
    }
    await database.shareGrant.upsert({
        where: { sharedThreadId_email: { sharedThreadId: invite.sharedThreadId, email: user.email.toLowerCase() } },
        create: {
            id: crypto.randomUUID(), sharedThreadId: invite.sharedThreadId,
            userId: principal.userId, email: user.email.toLowerCase(),
            permission: invite.permission, canPreview: invite.canPreview,
        },
        update: { userId: principal.userId, permission: invite.permission, canPreview: invite.canPreview },
    });
    if (invite.singleUse) {
        await database.shareInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    }
    return context.json({ sharedThreadId: invite.sharedThreadId });
});
