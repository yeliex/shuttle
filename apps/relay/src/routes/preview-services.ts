import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';

import type { RelayDatabase } from '../database.js';
import { createPreviewToken, verifyPreviewToken } from '../preview-token.js';
import {
    readJsonObject,
    readRequiredString,
} from '../request.js';
import type { RelayHonoEnvironment } from '../runtime.js';
import { activeShare, grantAudience } from '../share-access.js';

export interface PreviewAccess {
    deviceId: string;
    deviceRevokedAt?: Date | null;
    localUrl: string;
    name: string;
    ownerId: string;
    ownerName: string;
    sharedThreadId: string;
    title?: string | null;
    granted: boolean;
    expiresAt?: Date | null;
}

export const normalizeLocalPreviewURL = (value: string): string => {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new HTTPException(400, { message: 'localURL must be a valid URL' });
    }

    const localHosts = new Set(['127.0.0.1', '[::1]', 'localhost']);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:')
        || !localHosts.has(url.hostname)
        || url.username
        || url.password
        || url.search
        || url.hash) {
        throw new HTTPException(400, {
            message: 'localURL must be an HTTP URL on localhost without credentials, query, or fragment',
        });
    }

    if (!url.pathname.endsWith('/')) {
        url.pathname += '/';
    }
    return url.toString();
};

export const getPreviewAccess = async (
    database: RelayDatabase,
    previewServiceId: string,
    userId: string,
): Promise<PreviewAccess | undefined> => {
    const audience = await grantAudience(database, userId);
    const service = await database.previewService.findUnique({
        where: { id: previewServiceId },
        select: {
            deviceId: true,
            localUrl: true,
            name: true,
            ownerId: true,
            sharedThreadId: true,
            device: { select: { revokedAt: true } },
            owner: { select: { name: true } },
            sharedThread: {
                select: {
                    title: true,
                    expiresAt: true,
                    grants: {
                        where: { canPreview: true, ...audience },
                        select: { id: true },
                        take: 1,
                    },
                },
            },
        },
    });

    return service
        ? {
            deviceId: service.deviceId,
            deviceRevokedAt: service.device.revokedAt,
            granted: service.sharedThread.grants.length > 0
                && (!service.sharedThread.expiresAt || service.sharedThread.expiresAt > new Date()),
            expiresAt: service.ownerId === userId ? null : service.sharedThread.expiresAt,
            localUrl: service.localUrl,
            name: service.name,
            ownerId: service.ownerId,
            ownerName: service.owner.name,
            sharedThreadId: service.sharedThreadId,
            title: service.sharedThread.title,
        }
        : undefined;
};

export const canViewPreview = (access: PreviewAccess, userId: string): boolean => (
    access.ownerId === userId || access.granted
);

export const getPreviewSessionAccess = async (
    database: RelayDatabase,
    secret: string,
    previewServiceId: string,
    token: string | undefined,
): Promise<PreviewAccess | undefined> => {
    const session = await getPreviewSession(database, secret, token);
    return session?.previewServiceId === previewServiceId ? session.access : undefined;
};

export const getPreviewSession = async (
    database: RelayDatabase,
    secret: string,
    token: string | undefined,
): Promise<{
    access: PreviewAccess;
    previewServiceId: string;
    userId: string;
} | undefined> => {
    const session = await verifyPreviewToken(secret, token);
    if (!session) {
        return undefined;
    }
    const access = await getPreviewAccess(database, session.previewServiceId, session.userId);
    return access
        && canViewPreview(access, session.userId)
        && !access.deviceRevokedAt
        ? {
            access,
            previewServiceId: session.previewServiceId,
            userId: session.userId,
        }
        : undefined;
};

export const previewServices = new Hono<RelayHonoEnvironment>();

previewServices.get('/', async (context) => {
    const userId = context.var.principal.userId;
    const audience = await grantAudience(context.var.runtime.database, userId);
    const services = await context.var.runtime.database.previewService.findMany({
        where: {
            OR: [
                { ownerId: userId },
                { sharedThread: { AND: [activeShare(), { grants: { some: { canPreview: true, ...audience } } }] } },
            ],
        },
        orderBy: { updatedAt: 'desc' },
        select: {
            id: true,
            localUrl: true,
            name: true,
            ownerId: true,
            sharedThreadId: true,
            createdAt: true,
            updatedAt: true,
            device: { select: { name: true, revokedAt: true } },
            owner: { select: { image: true, name: true } },
            sharedThread: { select: { title: true } },
        },
    });

    return context.json({
        services: services.map(({ localUrl, ...service }) => {
            const url = new URL(localUrl);
            const owner = service.ownerId === userId;
            return {
                ...service,
                device: owner ? service.device : undefined,
                permission: owner ? 'owner' : 'view',
                port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
            };
        }),
    });
});

previewServices.post('/', async (context) => {
    const principal = context.var.principal;
    if (principal.kind !== 'device') {
        return context.json({ error: 'A registered device is required to configure a preview' }, 403);
    }

    const body = await readJsonObject(context.req.raw);
    const name = readRequiredString(body, 'name', 200).trim();
    const localUrl = normalizeLocalPreviewURL(readRequiredString(body, 'localURL', 2_000));
    const sharedThreadId = readRequiredString(body, 'sharedThreadId', 200);
    if (!name) {
        return context.json({ error: 'name must not contain only whitespace' }, 400);
    }

    const database = context.var.runtime.database;
    const sharedThread = await database.sharedThread.findFirst({
        where: {
            deviceId: principal.deviceId,
            id: sharedThreadId,
            ownerId: principal.userId,
        },
        select: { id: true },
    });
    if (!sharedThread) {
        return context.json({ error: 'The preview must belong to a task shared by this device' }, 404);
    }

    const service = await database.previewService.upsert({
        where: { ownerId_localUrl: { localUrl, ownerId: principal.userId } },
        create: {
            deviceId: principal.deviceId,
            id: crypto.randomUUID(),
            localUrl,
            name,
            ownerId: principal.userId,
            sharedThreadId,
        },
        update: {
            deviceId: principal.deviceId,
            name,
            sharedThreadId,
        },
        select: {
            id: true,
            localUrl: true,
            name: true,
            sharedThreadId: true,
            createdAt: true,
            updatedAt: true,
        },
    });

    return context.json({ service }, 201);
});

previewServices.get('/:previewServiceId', async (context) => {
    const database = context.var.runtime.database;
    const userId = context.var.principal.userId;
    const previewServiceId = context.req.param('previewServiceId');
    const access = await getPreviewAccess(database, previewServiceId, userId);
    if (!access || !canViewPreview(access, userId)) {
        return context.json({ error: 'Preview not found' }, 404);
    }

    const service = await database.previewService.findUnique({
        where: { id: previewServiceId },
        select: {
            id: true,
            name: true,
            ownerId: true,
            sharedThreadId: true,
            createdAt: true,
            updatedAt: true,
            device: { select: { name: true, revokedAt: true } },
            owner: { select: { email: true, image: true, name: true } },
            sharedThread: { select: { title: true } },
        },
    });
    if (!service) {
        return context.json({ error: 'Preview not found' }, 404);
    }

    const owner = access.ownerId === userId;
    return context.json({
        service: {
            ...service,
            device: owner ? service.device : undefined,
            localURL: owner ? access.localUrl : undefined,
            permission: owner ? 'owner' : 'view',
            previewURL: new URL(`/preview/${previewServiceId}/`, context.var.runtime.baseURL).toString(),
        },
    });
});

previewServices.post('/:previewServiceId/session', async (context) => {
    const principal = context.var.principal;
    if (principal.kind !== 'session') {
        return context.json({ error: 'A browser session is required to open a preview' }, 403);
    }
    const previewServiceId = context.req.param('previewServiceId');
    const access = await getPreviewAccess(
        context.var.runtime.database,
        previewServiceId,
        principal.userId,
    );
    if (!access || !canViewPreview(access, principal.userId) || access.deviceRevokedAt) {
        return context.json({ error: 'Preview not found' }, 404);
    }

    const expiresAt = new Date(Math.min(Date.now() + 8 * 60 * 60 * 1_000, access.expiresAt?.getTime() ?? Infinity));
    const token = await createPreviewToken(context.var.runtime.previewTokenSecret, {
        expiresAt: expiresAt.getTime(),
        previewServiceId,
        userId: principal.userId,
    });
    setCookie(context, 'shuttle_preview', token, {
        httpOnly: true,
        maxAge: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1_000)),
        path: '/',
        sameSite: 'Lax',
        secure: new URL(context.var.runtime.baseURL).protocol === 'https:',
    });

    return context.json({
        expiresAt,
        previewURL: new URL(`/preview/${previewServiceId}/`, context.var.runtime.baseURL).toString(),
    });
});

previewServices.delete('/:previewServiceId', async (context) => {
    const principal = context.var.principal;
    const previewServiceId = context.req.param('previewServiceId');
    const database = context.var.runtime.database;
    const service = await database.previewService.findFirst({
        where: {
            id: previewServiceId,
            ownerId: principal.userId,
            ...(principal.kind === 'device' ? { deviceId: principal.deviceId } : {}),
        },
        select: { deviceId: true },
    });
    if (!service) {
        return context.json({ error: 'Preview not found' }, 404);
    }
    await database.previewService.deleteMany({ where: { id: previewServiceId } });
    await context.var.runtime.closePreviewConnections?.(service.deviceId, previewServiceId);
    return context.body(null, 204);
});
