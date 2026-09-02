import { serve, upgradeWebSocket } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { WebSocketServer } from 'ws';
import { createRelay } from './app.js';
import { authenticateDeviceToken, readDeviceTokenFromProtocols } from './authentication.js';
import {
    createAuth,
    parseAdminEmails,
    parseAllowedDomains,
    parseAuthProviders,
    parseOpenRegistration,
} from './auth.js';
import { createNodeDatabase } from './database-node.js';
import { DeviceHub } from './device-hub.js';
import { parseSmtpConfiguration } from './mail.js';
import { createNodeMailer } from './mail-node.js';
import {
    getPreviewTargetURL,
    isPreviewReferer,
    proxyPreviewRootRequest,
} from './preview-proxy.js';
import { getPreviewSession, getPreviewSessionAccess } from './routes/preview-services.js';
import type { RelayHonoEnvironment } from './runtime.js';

const port = Number(process.env.PORT ?? 8787);
const baseURL = process.env.AUTH_BASE_URL ?? `http://localhost:${port}`;
const secret = process.env.AUTH_SECRET;
if (!secret) {
    throw new Error('AUTH_SECRET is required');
}

const database = createNodeDatabase(process.env.DATABASE_URL ?? 'file:./data/shuttle.db');
const authProviders = parseAuthProviders(process.env.AUTH_PROVIDERS);
const allowedDomains = parseAllowedDomains(process.env.AUTH_PROVIDER_ALLOWED_DOMAINS);
const openRegistration = parseOpenRegistration(process.env.OPEN_REGISTRATION);
const sendEmail = createNodeMailer(parseSmtpConfiguration(process.env));
const deviceHub = new DeviceHub();
const runtime = {
    adminEmails: parseAdminEmails(process.env.ADMIN_EMAILS),
    allowedDomains,
    auth: createAuth(database, {
        allowedDomains,
        baseURL,
        githubClientId: process.env.GITHUB_CLIENT_ID,
        githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
        openRegistration,
        providers: authProviders,
        secret,
        sendEmail,
    }),
    authProviders,
    baseURL,
    database,
    openRegistration,
    previewTokenSecret: secret,
    deliverMessage: (
        deviceId: string,
        codexThreadId: string,
        prompt: string,
    ) => deviceHub.deliver(deviceId, codexThreadId, prompt),
    readThread: (deviceId: string, codexThreadId: string) => (
        deviceHub.readThread(deviceId, codexThreadId)
    ),
    isDeviceOnline: async (deviceId: string) => deviceHub.isConnected(deviceId),
    disconnectDevice: async (deviceId: string) => deviceHub.disconnectDevice(deviceId),
    closePreviewConnections: async (deviceId: string, previewServiceId: string) => (
        deviceHub.closePreviewConnections(deviceId, previewServiceId)
    ),
    proxyPreviewRequest: (deviceId: string, previewServiceId: string, targetURL: string, request: {
        bodyBase64?: string;
        headers: [string, string][];
        method: string;
    }) => deviceHub.proxyPreviewRequest(deviceId, previewServiceId, targetURL, request),
    sendEmail,
};
const relay = createRelay(() => runtime);
const app = new Hono<RelayHonoEnvironment>();

const upgradePreviewWebSocket = upgradeWebSocket(async (context) => {
    const previewServiceId = context.req.param('previewServiceId');
    const token = getCookie(context, 'shuttle_preview');
    const session = previewServiceId
        ? undefined
        : await getPreviewSession(database, secret, token);
    const access = previewServiceId
        ? await getPreviewSessionAccess(database, secret, previewServiceId, token)
        : session?.access;
    const activePreviewServiceId = previewServiceId ?? session?.previewServiceId;
    if (!access
        || !activePreviewServiceId
        || (!previewServiceId && !isPreviewReferer(
            context.req.url,
            context.req.header('referer'),
            activePreviewServiceId,
        ))) {
        throw new HTTPException(401, { message: 'Preview access required' });
    }
    const target = new URL(getPreviewTargetURL(
        access.localUrl,
        previewServiceId,
        context.req.url,
    ));
    target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
    const protocols = context.req.header('sec-websocket-protocol')
        ?.split(',')
        .map((value) => value.trim())
        .filter(Boolean) ?? [];
    const headers = [...context.req.raw.headers.entries()].filter(([name]) => ![
        'authorization',
        'connection',
        'cookie',
        'host',
        'sec-websocket-extensions',
        'sec-websocket-key',
        'sec-websocket-protocol',
        'sec-websocket-version',
        'upgrade',
    ].includes(name.toLowerCase()));
    let previewId: string | undefined;

    return {
        onOpen: (_event, browser) => {
            try {
                previewId = deviceHub.openPreviewWebSocket(
                    access.deviceId,
                    activePreviewServiceId,
                    target.toString(),
                    protocols,
                    headers,
                    browser,
                );
            } catch (error) {
                browser.close(1011, error instanceof Error ? error.message : 'Preview unavailable');
            }
        },
        onMessage: (event) => {
            if (previewId) {
                void deviceHub.forwardPreviewWebSocketData(previewId, event.data);
            }
        },
        onClose: (event) => {
            if (previewId) {
                deviceHub.closePreviewWebSocket(previewId, event.code, event.reason);
            }
        },
        onError: () => {
            if (previewId) {
                deviceHub.closePreviewWebSocket(previewId, 1011, 'Browser WebSocket failed');
            }
        },
    };
});

const previewWebSocketRoute: MiddlewareHandler<RelayHonoEnvironment> = async (context, next) => (
    context.req.header('upgrade')?.toLowerCase() === 'websocket'
        ? upgradePreviewWebSocket(context, next)
        : next()
);

app.get('/preview/:previewServiceId', previewWebSocketRoute);
app.get('/preview/:previewServiceId/*', previewWebSocketRoute);

app.get('/connect/device', upgradeWebSocket(async (context) => {
    const device = await authenticateDeviceToken(
        database,
        readDeviceTokenFromProtocols(context.req.header('sec-websocket-protocol')),
        allowedDomains,
    );
    if (!device) {
        throw new HTTPException(401, { message: 'Authentication required' });
    }

    return {
        onOpen: (_event, socket) => deviceHub.connect(device.deviceId, socket),
        onMessage: (event) => deviceHub.handleMessage(device.deviceId, event.data),
        onClose: (_event, socket) => deviceHub.disconnect(device.deviceId, socket),
        onError: (_event, socket) => deviceHub.disconnect(device.deviceId, socket),
    };
}));

app.get('*', previewWebSocketRoute);
app.all('*', async (context, next) => {
    if (!context.req.header('referer') || !getCookie(context, 'shuttle_preview')) {
        return next();
    }
    context.set('runtime', runtime);
    return await proxyPreviewRootRequest(context) ?? next();
});

app.use('/app/*', serveStatic({ root: './.assets' }));
app.get('/app', serveStatic({
    path: './.assets/app/index.html',
}));
app.get('/app/*', serveStatic({
    path: './.assets/app/index.html',
}));
app.route('/', relay);
app.get('*', serveStatic({ root: './.assets' }));

const webSocketServer = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => protocols.values().next().value ?? false,
});
serve({
    fetch: app.fetch,
    port,
    websocket: { server: webSocketServer },
});
