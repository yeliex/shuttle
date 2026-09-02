import { Hono, type MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { createRelay } from './app.js';
import { authenticateDeviceToken, readDeviceTokenFromProtocols } from './authentication.js';
import {
    createAuth,
    parseAdminEmails,
    parseAllowedDomains,
    parseAuthProviders,
    parseOpenRegistration,
} from './auth.js';
import { createWorkerDatabase } from './database-worker.js';
import { parseSmtpConfiguration } from './mail.js';
import { createWorkerMailer } from './mail-worker.js';
import {
    getPreviewTargetURL,
    isPreviewReferer,
    proxyPreviewRootRequest,
} from './preview-proxy.js';
import { getPreviewSession, getPreviewSessionAccess } from './routes/preview-services.js';
import type { RelayBindings } from './env.js';
import type { RelayHonoEnvironment, RelayRuntime } from './runtime.js';

export { PreviewHub } from './durable-objects/preview-hub.js';
export { ThreadHub } from './durable-objects/thread-hub.js';

const worker = new Hono<RelayHonoEnvironment>();
const createWorkerRuntime = (bindings: RelayBindings): RelayRuntime => {
    const database = createWorkerDatabase(bindings.DB);
    const baseURL = bindings.AUTH_BASE_URL;
    const authProviders = parseAuthProviders(bindings.AUTH_PROVIDERS);
    const allowedDomains = parseAllowedDomains(bindings.AUTH_PROVIDER_ALLOWED_DOMAINS);
    const openRegistration = parseOpenRegistration(bindings.OPEN_REGISTRATION);
    const sendEmail = createWorkerMailer(parseSmtpConfiguration(bindings));

    return {
        adminEmails: parseAdminEmails(bindings.ADMIN_EMAILS),
        allowedDomains,
        auth: createAuth(database, {
            allowedDomains,
            baseURL,
            githubClientId: bindings.GITHUB_CLIENT_ID,
            githubClientSecret: bindings.GITHUB_CLIENT_SECRET,
            ipAddressHeaders: ['cf-connecting-ip'],
            openRegistration,
            providers: authProviders,
            secret: bindings.AUTH_SECRET,
            sendEmail,
        }),
        authProviders,
        baseURL,
        database,
        openRegistration,
        previewTokenSecret: bindings.AUTH_SECRET,
        dispose: () => database.$disconnect(),
        deliverMessage: async (deviceId, codexThreadId, prompt) => {
            const id = bindings.THREAD_HUB.idFromName(deviceId);
            const response = await bindings.THREAD_HUB.get(id).fetch('https://thread-hub/deliver', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ codexThreadId, method: 'sendMessage', prompt }),
            });
            if (!response.ok) {
                const body = await response.json() as { error?: unknown };
                throw new Error(typeof body.error === 'string' ? body.error : 'Codex message delivery failed');
            }
        },
        readThread: async (deviceId, codexThreadId) => {
            const id = bindings.THREAD_HUB.idFromName(deviceId);
            const response = await bindings.THREAD_HUB.get(id).fetch('https://thread-hub/deliver', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ codexThreadId, method: 'readThread' }),
            });
            const body = await response.json() as { error?: unknown; result?: unknown };
            if (!response.ok) {
                throw new Error(typeof body.error === 'string' ? body.error : 'Codex task read failed');
            }
            return body.result;
        },
        isDeviceOnline: async (deviceId) => {
            const id = bindings.THREAD_HUB.idFromName(deviceId);
            const response = await bindings.THREAD_HUB.get(id).fetch('https://thread-hub/status');
            const body = await response.json() as { online?: unknown };
            return body.online === true;
        },
        disconnectDevice: async (deviceId) => {
            const id = bindings.THREAD_HUB.idFromName(deviceId);
            const response = await bindings.THREAD_HUB.get(id).fetch('https://thread-hub/revoke-device', {
                method: 'POST',
            });
            if (!response.ok) {
                throw new Error('Failed to disconnect the revoked Shuttle device');
            }
        },
        closePreviewConnections: async (deviceId, previewServiceId) => {
            const id = bindings.THREAD_HUB.idFromName(deviceId);
            const response = await bindings.THREAD_HUB.get(id).fetch('https://thread-hub/preview/revoke', {
                body: JSON.stringify({ previewServiceId }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            });
            if (!response.ok) {
                throw new Error('Failed to close revoked preview connections');
            }
        },
        proxyPreviewRequest: async (deviceId, previewServiceId, targetURL, request) => {
            const id = bindings.THREAD_HUB.idFromName(deviceId);
            return bindings.THREAD_HUB.get(id).fetch('https://thread-hub/preview/http', {
                body: JSON.stringify({ previewServiceId, request, targetURL }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            });
        },
        sendEmail,
    };
};
const relay = createRelay(createWorkerRuntime);

worker.get('/connect/device', async (context) => {
    const database = createWorkerDatabase(context.env.DB);
    try {
        const device = await authenticateDeviceToken(
            database,
            readDeviceTokenFromProtocols(context.req.header('sec-websocket-protocol')),
            parseAllowedDomains(context.env.AUTH_PROVIDER_ALLOWED_DOMAINS),
        );
        if (!device) {
            return context.json({ error: 'Authentication required' }, 401);
        }
        const id = context.env.THREAD_HUB.idFromName(device.deviceId);
        const request = new Request('https://thread-hub/connect', {
            headers: {
                Upgrade: 'websocket',
                'Sec-WebSocket-Protocol': 'shuttle.v1',
            },
        });
        return context.env.THREAD_HUB.get(id).fetch(request);
    } finally {
        await database.$disconnect();
    }
});

const proxyPreviewWebSocket: MiddlewareHandler<RelayHonoEnvironment> = async (context, next) => {
    if (context.req.header('upgrade')?.toLowerCase() !== 'websocket') {
        return next();
    }
    const previewServiceId = context.req.param('previewServiceId');
    const database = createWorkerDatabase(context.env.DB);
    try {
        const token = getCookie(context, 'shuttle_preview');
        const session = previewServiceId
            ? undefined
            : await getPreviewSession(database, context.env.AUTH_SECRET, token);
        const access = previewServiceId
            ? await getPreviewSessionAccess(
                database,
                context.env.AUTH_SECRET,
                previewServiceId,
                token,
            )
            : session?.access;
        const activePreviewServiceId = previewServiceId ?? session?.previewServiceId;
        if (!access
            || !activePreviewServiceId
            || (!previewServiceId && !isPreviewReferer(
                context.req.url,
                context.req.header('referer'),
                activePreviewServiceId,
            ))) {
            return context.json({ error: 'Preview access required' }, 401);
        }
        const target = new URL(getPreviewTargetURL(
            access.localUrl,
            previewServiceId,
            context.req.url,
        ));
        target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
        const headers = new Headers({
            Upgrade: 'websocket',
            'X-Shuttle-Preview-Service-ID': activePreviewServiceId,
            'X-Shuttle-Target-URL': target.toString(),
        });
        for (const name of ['origin', 'sec-websocket-protocol', 'user-agent']) {
            const value = context.req.header(name);
            if (value) {
                headers.set(name, value);
            }
        }
        const id = context.env.THREAD_HUB.idFromName(access.deviceId);
        return context.env.THREAD_HUB.get(id).fetch(new Request(
            'https://thread-hub/preview/ws',
            { headers },
        ));
    } finally {
        await database.$disconnect();
    }
};

worker.get('/preview/:previewServiceId', proxyPreviewWebSocket);
worker.get('/preview/:previewServiceId/*', proxyPreviewWebSocket);
worker.get('*', proxyPreviewWebSocket);

worker.all('*', async (context, next) => {
    if (!context.req.header('referer') || !getCookie(context, 'shuttle_preview')) {
        return next();
    }
    const runtime = createWorkerRuntime(context.env);
    context.set('runtime', runtime);
    try {
        return await proxyPreviewRootRequest(context) ?? next();
    } finally {
        await runtime.dispose?.();
    }
});

worker.get('/app/assets/*', (context) => context.env.ASSETS.fetch(context.req.raw));
worker.get('/app', (context) => {
    const shell = new URL('/app/', context.req.url);
    return context.env.ASSETS.fetch(new Request(shell, context.req.raw));
});
worker.get('/app/*', (context) => {
    const shell = new URL('/app/', context.req.url);
    return context.env.ASSETS.fetch(new Request(shell, context.req.raw));
});
worker.route('/', relay);
worker.all('*', (context) => context.env.ASSETS.fetch(context.req.raw));

export default worker;
