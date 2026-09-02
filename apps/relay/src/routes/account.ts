import { Hono } from 'hono';

import { AUTH_PROVIDER_EMAIL_PASSWORD, isEmailAllowed } from '../auth.js';
import { readJsonObject, readRequiredString } from '../request.js';
import type { RelayHonoEnvironment } from '../runtime.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export const publicAccount = new Hono<RelayHonoEnvironment>();

publicAccount.post('/identify', async (context) => {
    const body = await readJsonObject(context.req.raw);
    const email = readRequiredString(body, 'email', 320).trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
        return context.json({ error: 'email must be an email address' }, 400);
    }

    const runtime = context.var.runtime;
    if (!runtime.authProviders.includes(AUTH_PROVIDER_EMAIL_PASSWORD)
        || !isEmailAllowed(email, runtime.allowedDomains)) {
        return context.json({ next: 'unavailable' as const });
    }

    const user = await runtime.database.user.findUnique({
        where: { email },
        select: {
            accounts: { select: { password: true, providerId: true } },
            disabledAt: true,
        },
    });
    if (user?.disabledAt) {
        return context.json({ next: 'unavailable' as const });
    }

    const hasPassword = user?.accounts.some((account) => (
        account.providerId === 'credential' && account.password !== null
    )) === true;
    if (hasPassword) {
        return context.json({ next: 'password' as const });
    }
    if (runtime.sendEmail && (user || runtime.openRegistration)) {
        return context.json({ next: 'magic-link' as const });
    }
    return context.json({ next: 'unavailable' as const });
});

export const account = new Hono<RelayHonoEnvironment>();

account.post('/password', async (context) => {
    const userId = context.var.principal.userId;
    const body = await readJsonObject(context.req.raw);
    const newPassword = readRequiredString(body, 'newPassword', 128);
    if (newPassword.length < 8) {
        return context.json({ error: 'newPassword must contain at least 8 characters' }, 400);
    }

    const existing = await context.var.runtime.database.account.findFirst({
        where: { providerId: 'credential', userId },
        select: { password: true },
    });
    if (existing?.password) {
        return context.json({ error: 'This account already has a password' }, 409);
    }

    try {
        await context.var.runtime.auth.api.setPassword({
            body: { newPassword },
            headers: context.req.raw.headers,
        });
        return context.json({ passwordSet: true });
    } catch {
        return context.json({ error: 'Unable to set password' }, 400);
    }
});
