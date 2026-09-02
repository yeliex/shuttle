import { Hono } from 'hono';

import { createSecret, hashSecret, readJsonObject, readRequiredString } from '../request.js';
import type { RelayHonoEnvironment } from '../runtime.js';

export const devices = new Hono<RelayHonoEnvironment>();

devices.get('/', async (context) => {
    const { database } = context.var.runtime;
    const principal = context.var.principal;
    const rows = await database.device.findMany({
        where: { userId: principal.userId },
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            name: true,
            createdAt: true,
            lastSeenAt: true,
            revokedAt: true,
        },
    });

    const devices = await Promise.all(rows.map(async (device) => ({
        ...device,
        online: !device.revokedAt
            && Boolean(await context.var.runtime.isDeviceOnline?.(device.id)),
    })));

    return context.json({ devices });
});

devices.post('/', async (context) => {
    const principal = context.var.principal;
    if (principal.kind !== 'session') {
        return context.json({ error: 'A browser session is required to register a device' }, 403);
    }

    const body = await readJsonObject(context.req.raw);
    const name = readRequiredString(body, 'name', 100);
    const token = createSecret('shuttle_device');
    const row = await context.var.runtime.database.device.create({
        data: {
            id: crypto.randomUUID(),
            name,
            tokenHash: await hashSecret(token),
            userId: principal.userId,
        },
        select: { id: true, name: true, createdAt: true },
    });

    return context.json({ device: row, token }, 201);
});

devices.delete('/:deviceId', async (context) => {
    const deviceId = context.req.param('deviceId');
    const result = await context.var.runtime.database.device.updateMany({
        where: {
            id: deviceId,
            userId: context.var.principal.userId,
            revokedAt: null,
        },
        data: { revokedAt: new Date() },
    });

    if (result.count === 0) {
        return context.json({ error: 'Device not found' }, 404);
    }
    await context.var.runtime.disconnectDevice?.(deviceId);
    return context.body(null, 204);
});
