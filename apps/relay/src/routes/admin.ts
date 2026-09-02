import { Hono } from 'hono';

import { isEmailAllowed } from '../auth.js';
import {
    readJsonObject,
    readRequiredString,
} from '../request.js';
import type { RelayHonoEnvironment } from '../runtime.js';

export const admin = new Hono<RelayHonoEnvironment>();

admin.use('*', async (context, next) => {
    const principal = context.var.principal;
    if (principal.kind !== 'session') {
        return context.json({ error: 'A browser session is required' }, 403);
    }
    const database = context.var.runtime.database;
    const currentUser = await database.user.findUnique({
        where: { id: principal.userId },
        select: { email: true },
    });
    if (!currentUser
        || !context.var.runtime.adminEmails.includes(currentUser.email.toLowerCase())) {
        return context.json({ error: 'Admin access required' }, 403);
    }
    return next();
});

admin.get('/overview', async (context) => {
    const database = context.var.runtime.database;
    const [users, userCount, activeDevices, sharedThreads, previewServices] = await Promise.all([
        database.user.findMany({
            orderBy: { createdAt: 'desc' },
            select: {
                createdAt: true,
                disabledAt: true,
                email: true,
                id: true,
                image: true,
                name: true,
                _count: {
                    select: {
                        devices: true,
                        ownedPreviewServices: true,
                        ownedThreads: true,
                    },
                },
            },
        }),
        database.user.count(),
        database.device.count({ where: { revokedAt: null } }),
        database.sharedThread.count(),
        database.previewService.count(),
    ]);

    return context.json({
        metrics: {
            activeDevices,
            previewServices,
            sharedThreads,
            users: userCount,
        },
        users: users.map((user) => ({
            ...user,
            isAdmin: context.var.runtime.adminEmails.includes(user.email.toLowerCase()),
        })),
    });
});

admin.post('/users', async (context) => {
    const body = await readJsonObject(context.req.raw);
    const email = readRequiredString(body, 'email', 320).trim().toLowerCase();
    const name = readRequiredString(body, 'name', 100).trim();
    if (!name) {
        return context.json({ error: 'name must not be blank' }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
        return context.json({ error: 'email must be an email address' }, 400);
    }
    if (!isEmailAllowed(email, context.var.runtime.allowedDomains)) {
        return context.json({ error: 'This email domain is not allowed by this Shuttle Relay' }, 403);
    }
    const database = context.var.runtime.database;
    const existing = await database.user.findUnique({
        where: { email },
        select: { id: true },
    });
    if (existing) {
        return context.json({ error: 'A user with this email already exists' }, 409);
    }

    const userId = crypto.randomUUID();
    const user = await database.user.create({
        data: {
            email,
            emailVerified: false,
            id: userId,
            name,
        },
        select: {
            createdAt: true,
            disabledAt: true,
            email: true,
            id: true,
            image: true,
            name: true,
        },
    });
    return context.json({ user }, 201);
});

admin.patch('/users/:userId', async (context) => {
    const database = context.var.runtime.database;
    const userId = context.req.param('userId');
    const body = await readJsonObject(context.req.raw);
    if (typeof body.disabled !== 'boolean') {
        return context.json({ error: 'disabled must be a boolean' }, 400);
    }

    const user = await database.user.findUnique({
        where: { id: userId },
        select: { disabledAt: true, email: true, id: true },
    });
    if (!user) {
        return context.json({ error: 'User not found' }, 404);
    }
    if (body.disabled
        && context.var.runtime.adminEmails.includes(user.email.toLowerCase())) {
        return context.json({ error: 'Relay administrators cannot be disabled' }, 409);
    }

    if (!body.disabled) {
        const enabled = await database.user.update({
            where: { id: userId },
            data: { disabledAt: null },
            select: { disabledAt: true, id: true },
        });
        return context.json({ user: enabled });
    }

    const devices = await database.device.findMany({
        where: { revokedAt: null, userId },
        select: { id: true },
    });
    const disabledAt = user.disabledAt ?? new Date();
    await database.user.update({
        where: { id: userId },
        data: { disabledAt },
    });
    await database.session.deleteMany({ where: { userId } });
    await database.device.updateMany({
        where: { revokedAt: null, userId },
        data: { revokedAt: disabledAt },
    });
    await Promise.all(devices.map(({ id }) => context.var.runtime.disconnectDevice?.(id)));

    return context.json({ user: { disabledAt, id: userId } });
});
