import type { MiddlewareHandler } from 'hono';

import { isEmailAllowed } from './auth.js';
import { hashSecret } from './request.js';
import type { RelayDatabase } from './database.js';
import type { Principal, RelayHonoEnvironment } from './runtime.js';

export const readDeviceTokenFromProtocols = (header: string | undefined): string | undefined => {
    const protocol = header?.split(',')
        .map((value) => value.trim())
        .find((value) => value.startsWith('shuttle-auth.'));
    return protocol?.slice('shuttle-auth.'.length) || undefined;
};

export const authenticateDeviceToken = async (
    database: RelayDatabase,
    token: string | undefined,
    allowedDomains: string[] = [],
): Promise<{ deviceId: string; userId: string } | undefined> => {
    if (!token) {
        return undefined;
    }
    const device = await database.device.findUnique({
        where: { tokenHash: await hashSecret(token) },
        select: {
            id: true,
            revokedAt: true,
            userId: true,
            user: { select: { disabledAt: true, email: true } },
        },
    });
    if (!device
        || device.revokedAt
        || device.user.disabledAt
        || !isEmailAllowed(device.user.email, allowedDomains)) {
        return undefined;
    }
    await database.device.update({
        where: { id: device.id },
        data: { lastSeenAt: new Date() },
    });
    return { deviceId: device.id, userId: device.userId };
};

const resolvePrincipal = async (
    authorization: string | undefined,
    headers: Headers,
    environment: RelayHonoEnvironment['Variables'],
): Promise<Principal | undefined> => {
    if (authorization?.startsWith('Bearer ')) {
        const token = authorization.slice('Bearer '.length);
        if (!token) {
            return undefined;
        }

        const device = await authenticateDeviceToken(
            environment.runtime.database,
            token,
            environment.runtime.allowedDomains,
        );
        if (!device) {
            return undefined;
        }
        return { deviceId: device.deviceId, kind: 'device', userId: device.userId };
    }

    const session = await environment.runtime.auth.api.getSession({ headers });
    if (!session) {
        return undefined;
    }
    const user = await environment.runtime.database.user.findUnique({
        where: { id: session.user.id },
        select: { disabledAt: true, email: true },
    });
    return user
        && !user.disabledAt
        && isEmailAllowed(user.email, environment.runtime.allowedDomains)
        ? { kind: 'session', userId: session.user.id }
        : undefined;
};

export const requirePrincipal: MiddlewareHandler<RelayHonoEnvironment> = async (
    context,
    next,
) => {
    const principal = await resolvePrincipal(
        context.req.header('authorization'),
        context.req.raw.headers,
        context.var,
    );
    if (!principal) {
        return context.json({ error: 'Authentication required' }, 401);
    }

    context.set('principal', principal);
    return next();
};
