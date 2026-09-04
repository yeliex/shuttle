import { lstat, mkdir, unlink } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { type RawData, WebSocket as LocalWebSocket } from 'ws';

import { CompanionService } from './companion-service.js';
import { CodexAppServer } from './codex-host.js';
import { JsonLinePeer } from './json-line-peer.js';
import { getCompanionSocketPath } from './paths.js';
import { RelayClient } from './relay-client.js';
import { getCompanionRuntime } from './index.js';
import { createMcpHttpServer, getMcpAuthorization, MCP_HTTP_PORT } from './mcp-http.js';

const getObject = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Parameters must be an object');
    }
    return value as Record<string, unknown>;
};

const getString = (value: unknown, name: string): string => {
    const object = getObject(value);
    const field = object[name];
    if (typeof field !== 'string' || field.length === 0) {
        throw new Error(`${name} must be a non-empty string`);
    }
    return field;
};

interface AuthorizationDecision {
    approved: boolean;
    canPreview: boolean;
    emails: string[];
    expiresInHours: number | null;
    singleUse: boolean;
    permission: 'message' | 'read';
}

const readAuthorizationDecision = (value: unknown): AuthorizationDecision => {
    const object = getObject(value);
    if (object.approved !== true) {
        return { approved: false, canPreview: false, emails: [], expiresInHours: 24, singleUse: false, permission: 'read' };
    }
    if (!Array.isArray(object.emails) || object.emails.some((email) => typeof email !== 'string')) {
        throw new Error('Authorization emails must be an array');
    }
    const emails = object.emails.map((email: string) => email.trim().toLowerCase());
    const expiresInHours = object.expiresInHours === 0 ? null : object.expiresInHours;
    if (expiresInHours !== null && (typeof expiresInHours !== 'number' || ![24, 168, 720].includes(expiresInHours))) {
        throw new Error('Authorization expiration must be 1, 7, 30 days, or permanent');
    }
    if (object.permission !== 'read' && object.permission !== 'message') {
        throw new Error('Authorization permission is invalid');
    }
    return {
        approved: true,
        canPreview: object.canPreview === true,
        emails,
        singleUse: object.singleUse === true,
        expiresInHours,
        permission: object.permission,
    };
};

interface SharedLocalService {
    localURL: string;
    name: string;
}

const readSharedLocalServices = (value: unknown): SharedLocalService[] => {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new Error('services must be an array');
    }
    return value.map((service) => ({
        localURL: getString(service, 'localURL'),
        name: getString(service, 'name'),
    }));
};

const getCreatedResourceId = (value: unknown, resource: 'service' | 'thread'): string => {
    const object = getObject(value);
    const created = object[resource];
    const id = created && typeof created === 'object' && !Array.isArray(created)
        ? (created as Record<string, unknown>).id
        : undefined;
    if (typeof id !== 'string') {
        throw new Error(`Relay did not return a shared ${resource} ID`);
    }
    return id;
};

export const listenOnCompanionSocket = async (server: Server, path: string): Promise<void> => {
    const listen = () => new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(path, () => {
            server.removeListener('error', reject);
            resolve();
        });
    });
    try {
        await listen();
    } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EADDRINUSE')) {
            throw error;
        }
        const existing = await lstat(path);
        if (!existing.isSocket()) {
            throw new Error(`Refusing to replace non-socket path: ${path}`);
        }
        // Only reclaim a dead listener; a second app must never detach the live Companion.
        const probe = connect(path);
        try {
            const active = await new Promise<boolean>((resolve, reject) => {
                probe.once('connect', () => resolve(true));
                probe.once('error', (probeError: NodeJS.ErrnoException) => {
                    if (probeError.code === 'ECONNREFUSED' || probeError.code === 'ENOENT') {
                        resolve(false);
                    } else {
                        reject(probeError);
                    }
                });
            });
            if (active) {
                throw new Error('Shuttle Companion is already running');
            }
        } finally {
            probe.destroy();
        }
        await unlink(path).catch((unlinkError: NodeJS.ErrnoException) => {
            if (unlinkError.code !== 'ENOENT') { throw unlinkError; }
        });
        await listen();
    }
};

const RESPONSE_HEADERS_TO_REMOVE = new Set([
    'connection',
    'content-length',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'proxy-connection',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
]);

const openPreviewHttpRequest = async (
    socket: WebSocket,
    id: string,
    targetURL: string,
    request: {
        bodyBase64?: unknown;
        headers?: unknown;
        method?: unknown;
    },
    signal: AbortSignal,
): Promise<void> => {
    const target = new URL(targetURL);
    if ((target.protocol !== 'http:' && target.protocol !== 'https:')
        || !['127.0.0.1', '[::1]', 'localhost'].includes(target.hostname)) {
        throw new Error('Relay requested an invalid local preview target');
    }
    if (typeof request.method !== 'string' || !Array.isArray(request.headers)) {
        throw new Error('Relay sent an invalid preview HTTP request');
    }

    const headers = new Headers();
    for (const entry of request.headers) {
        if (Array.isArray(entry)
            && entry.length === 2
            && typeof entry[0] === 'string'
            && typeof entry[1] === 'string') {
            const name = entry[0].toLowerCase();
            if (name === 'origin') {
                headers.set(entry[0], target.origin);
            } else if (name === 'referer') {
                headers.set(entry[0], targetURL);
            } else {
                headers.append(entry[0], entry[1]);
            }
        }
    }
    const body = typeof request.bodyBase64 === 'string'
        ? Buffer.from(request.bodyBase64, 'base64')
        : undefined;
    const response = await fetch(target, {
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : body,
        headers,
        method: request.method,
        redirect: 'manual',
        signal,
    });
    const responseHeaders = [...response.headers.entries()]
        .filter(([name]) => !RESPONSE_HEADERS_TO_REMOVE.has(name.toLowerCase()));
    socket.send(JSON.stringify({
        event: 'previewHttpHead',
        headers: responseHeaders,
        id,
        status: response.status,
    }));

    const reader = response.body?.getReader();
    if (reader) {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) {
                break;
            }
            socket.send(JSON.stringify({
                data: Buffer.from(chunk.value).toString('base64'),
                event: 'previewHttpData',
                id,
            }));
        }
    }
    socket.send(JSON.stringify({ event: 'previewHttpEnd', id }));
};

const openPreviewWebSocket = (
    relaySocket: globalThis.WebSocket,
    previewSockets: Map<string, LocalWebSocket>,
    id: string,
    targetURL: string,
    protocols: unknown,
    requestHeaders: unknown,
): void => {
    const target = new URL(targetURL);
    if ((target.protocol !== 'ws:' && target.protocol !== 'wss:')
        || !['127.0.0.1', '[::1]', 'localhost'].includes(target.hostname)) {
        throw new Error('Relay requested an invalid local preview WebSocket target');
    }
    if (!Array.isArray(protocols)
        || !protocols.every((protocol) => typeof protocol === 'string')) {
        throw new Error('Relay sent invalid WebSocket protocols');
    }

    const headers: Record<string, string> = {};
    if (Array.isArray(requestHeaders)) {
        for (const entry of requestHeaders) {
            if (Array.isArray(entry)
                && entry.length === 2
                && typeof entry[0] === 'string'
                && typeof entry[1] === 'string'
                && entry[0].toLowerCase() !== 'origin') {
                headers[entry[0]] = entry[1];
            }
        }
    }
    const socket = new LocalWebSocket(target, protocols, {
        headers,
        origin: target.origin.replace(/^ws/u, 'http'),
    });
    previewSockets.set(id, socket);
    socket.on('open', () => relaySocket.send(JSON.stringify({
        event: 'previewWebSocketOpen',
        id,
        protocol: socket.protocol,
    })));
    socket.on('message', (data: RawData, binary: boolean) => {
        const buffer = Array.isArray(data)
            ? Buffer.concat(data)
            : data instanceof ArrayBuffer ? Buffer.from(data) : data;
        relaySocket.send(JSON.stringify({
            binary,
            data: buffer.toString(binary ? 'base64' : 'utf8'),
            event: 'previewWebSocketData',
            id,
        }));
    });
    socket.on('close', (code, reason) => {
        previewSockets.delete(id);
        relaySocket.send(JSON.stringify({
            code,
            event: 'previewWebSocketClose',
            id,
            reason: reason.toString(),
        }));
    });
    socket.on('error', (error) => {
        if (socket.readyState === LocalWebSocket.CONNECTING) {
            relaySocket.send(JSON.stringify({ error: error.message, id }));
        }
    });
};

export const serveDaemon = async (): Promise<void> => {
    const relayURL = process.env.SHUTTLE_RELAY_URL;
    const deviceToken = process.env.SHUTTLE_DEVICE_TOKEN;
    if (!relayURL || !deviceToken) {
        throw new Error('SHUTTLE_RELAY_URL and SHUTTLE_DEVICE_TOKEN are required');
    }

    const socketPath = getCompanionSocketPath();
    await mkdir(dirname(socketPath), { recursive: true });

    const relay = new RelayClient({ baseURL: relayURL, deviceToken });
    const codex = new CodexAppServer();
    const service = new CompanionService(relay, codex);
    const pendingAuthorizations = new Map<string, {
        reject: (error: Error) => void;
        resolve: (decision: AuthorizationDecision) => void;
    }>();
    const requestAuthorization = (
        title: string,
        services: SharedLocalService[],
        retryID?: string,
    ): Promise<{ decision: AuthorizationDecision; id: string }> => {
        const id = retryID ?? crypto.randomUUID();
        return new Promise((resolve, reject) => {
            pendingAuthorizations.set(id, {
                reject,
                resolve: (decision) => resolve({ decision, id }),
            });
            if (!retryID) {
                process.stdout.write(`${JSON.stringify({
                    id,
                    resource: 'thread',
                    services,
                    title,
                    type: 'authorization-request',
                })}\n`);
            }
        });
    };
    const reportAuthorizationResult = (
        id: string,
        result: { error?: string; inviteURL?: string; sharedThreadId?: string },
    ) => process.stdout.write(`${JSON.stringify({
        id,
        ...result,
        type: 'authorization-result',
    })}\n`);

    const server = createServer((socket: Socket) => {
        const peer = new JsonLinePeer(socket, socket);
        let registeredThreadId: string | undefined;

        peer.handle('host.register', (params) => {
            const codexThreadId = getString(params, 'codexThreadId');
            if (registeredThreadId && registeredThreadId !== codexThreadId) {
                throw new Error('A local connection can serve only one Codex task');
            }
            registeredThreadId = codexThreadId;
            return { registered: true, codexThreadId };
        });
        peer.handle('shuttle.shareThread', async (params) => {
            if (!registeredThreadId) {
                throw new Error('The current Codex task is not registered');
            }
            const object = getObject(params);
            const title = typeof object.title === 'string' ? object.title : undefined;
            const services = readSharedLocalServices(object.services);
            let authorization = await requestAuthorization(title ?? 'Current Codex task', services);
            while (authorization.decision.approved) {
                try {
                    const share = await service.shareThread(registeredThreadId, title);
                    const sharedThreadId = getCreatedResourceId(share, 'thread');
                    const sharedServices = await Promise.all(services.map((localService) => (
                        service.shareLocalService(
                            localService.name,
                            localService.localURL,
                            sharedThreadId,
                        )
                    )));
                    const invitation = await service.createThreadInvite(
                        sharedThreadId,
                        {
                            emails: authorization.decision.emails,
                            expiresInHours: authorization.decision.expiresInHours,
                            permission: authorization.decision.permission,
                            canPreview: authorization.decision.canPreview && sharedServices.length > 0,
                            singleUse: authorization.decision.singleUse,
                        },
                    );
                    if (getObject(invitation).emailDelivery === 'failed') {
                        throw new Error('授权已保存，但部分邀请邮件发送失败，请重试发送。');
                    }
                    const inviteURL = getObject(invitation).inviteURL;
                    reportAuthorizationResult(authorization.id, {
                        inviteURL: typeof inviteURL === 'string' ? inviteURL : undefined,
                        sharedThreadId,
                    });
                    return { invitation, services: sharedServices, share };
                } catch (error) {
                    // 先恢复同一请求的等待，再让原表单显示错误；只在用户再次提交后重试。
                    const retry = requestAuthorization(title ?? 'Current Codex task', services, authorization.id);
                    reportAuthorizationResult(authorization.id, {
                        error: error instanceof Error ? error.message : 'Task sharing failed',
                    });
                    authorization = await retry;
                }
            }
            throw new Error('Task sharing was cancelled');
        });
        peer.handle('shuttle.unshareThread', (params) => (
            service.unshareThread(getString(params, 'sharedThreadId'))
        ));
        peer.handle('shuttle.listSharedThreads', () => service.listSharedThreads());
        peer.handle('shuttle.acceptInvite', (params) => service.acceptInvite(getString(params, 'inviteURL')));
        peer.handle('shuttle.readSharedThread', (params) => (
            service.readSharedThread(getString(params, 'sharedThreadId'))
        ));
        peer.handle('shuttle.sendSharedMessage', (params) => {
            const object = getObject(params);
            return service.sendSharedMessage(
                getString(object, 'sharedThreadId'),
                getString(object, 'prompt'),
            );
        });
        peer.handle('shuttle.shareLocalService', async (params) => {
            const object = getObject(params);
            const name = getString(object, 'name');
            const localURL = getString(object, 'localURL');
            return service.shareLocalService(
                name,
                localURL,
                getString(object, 'sharedThreadId'),
            );
        });
        peer.handle('shuttle.stopSharingLocalService', (params) => (
            service.stopSharingLocalService(getString(params, 'previewServiceId'))
        ));
    });

    await listenOnCompanionSocket(server, socketPath);

    const mcpServer = createMcpHttpServer(await getMcpAuthorization());
    try {
        await new Promise<void>((resolve, reject) => {
            mcpServer.once('error', reject);
            mcpServer.listen(Number(process.env.SHUTTLE_MCP_PORT ?? MCP_HTTP_PORT), '127.0.0.1', () => {
                mcpServer.removeListener('error', reject);
                resolve();
            });
        });
    } catch (error) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        throw error;
    }

    // 安装更新可能暂时阻止启动；本地工具仍可连接并得到明确错误，后台随后恢复。
    const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
    void codex.start().catch(() => {});
    const stopCodex = () => input.close();
    process.once('SIGTERM', stopCodex);
    process.once('SIGINT', stopCodex);
    let stopped = false;
    let deviceSocket: WebSocket | undefined;
    const previewHttpRequests = new Map<string, AbortController>();
    const previewWebSockets = new Map<string, LocalWebSocket>();
    const connectDevice = () => {
        if (stopped) {
            return;
        }

        const connection = relay.getDeviceConnection();
        const socket = new WebSocket(connection.url, connection.protocols);
        deviceSocket = socket;
        socket.addEventListener('message', (event) => {
            void (async () => {
                let requestId: string | undefined;
                try {
                    const request = JSON.parse(String(event.data)) as {
                        bodyBase64?: unknown;
                        binary?: unknown;
                        code?: unknown;
                        data?: unknown;
                        headers?: unknown;
                        method?: unknown;
                        id?: unknown;
                        codexThreadId?: unknown;
                        prompt?: unknown;
                        previewId?: unknown;
                        protocols?: unknown;
                        reason?: unknown;
                        request?: unknown;
                        targetURL?: unknown;
                    };
                    requestId = typeof request.id === 'string' ? request.id : undefined;
                    if (request.method === 'previewWebSocketData') {
                        if (typeof request.previewId !== 'string') {
                            throw new Error('Relay sent an invalid preview WebSocket ID');
                        }
                        const localSocket = previewWebSockets.get(request.previewId);
                        if (!localSocket) {
                            return;
                        }
                        let data: Buffer | string;
                        if (request.binary === true && typeof request.data === 'string') {
                            data = Buffer.from(request.data, 'base64');
                        } else if (request.binary === false && typeof request.data === 'string') {
                            data = request.data;
                        } else {
                            return;
                        }
                        const send = () => {
                            if (localSocket.readyState === LocalWebSocket.OPEN) {
                                localSocket.send(data);
                            }
                        };
                        if (localSocket.readyState === LocalWebSocket.CONNECTING) {
                            localSocket.once('open', send);
                        } else {
                            send();
                        }
                        return;
                    }
                    if (request.method === 'previewWebSocketClose') {
                        if (typeof request.previewId === 'string') {
                            const localSocket = previewWebSockets.get(request.previewId);
                            const code = typeof request.code === 'number' ? request.code : 1000;
                            const reason = typeof request.reason === 'string' ? request.reason : '';
                            if (code === 1005) {
                                localSocket?.close();
                            } else if (code === 1006 || code === 1015) {
                                localSocket?.terminate();
                            } else {
                                localSocket?.close(code, reason);
                            }
                            previewWebSockets.delete(request.previewId);
                        }
                        return;
                    }
                    if (request.method === 'previewWebSocket') {
                        if (!requestId || typeof request.targetURL !== 'string') {
                            throw new Error('Relay sent an invalid preview WebSocket request');
                        }
                        openPreviewWebSocket(
                            socket,
                            previewWebSockets,
                            requestId,
                            request.targetURL,
                            request.protocols,
                            request.headers,
                        );
                        return;
                    }
                    if (request.method === 'previewHttpCancel') {
                        if (typeof request.previewId === 'string') {
                            previewHttpRequests.get(request.previewId)?.abort();
                            previewHttpRequests.delete(request.previewId);
                        }
                        return;
                    }
                    if (request.method === 'previewHttp') {
                        if (!requestId
                            || typeof request.targetURL !== 'string'
                            || !request.request
                            || typeof request.request !== 'object'
                            || Array.isArray(request.request)) {
                            throw new Error('Relay sent an invalid preview HTTP request');
                        }
                        const controller = new AbortController();
                        previewHttpRequests.set(requestId, controller);
                        try {
                            await openPreviewHttpRequest(
                                socket,
                                requestId,
                                request.targetURL,
                                request.request,
                                controller.signal,
                            );
                        } finally {
                            previewHttpRequests.delete(requestId);
                        }
                        return;
                    }
                    if (!requestId
                        || typeof request.codexThreadId !== 'string'
                        || (request.method !== 'readThread' && request.method !== 'sendMessage')) {
                        throw new Error('Relay sent an invalid delivery request');
                    }
                    let result: unknown;
                    // 仅此已认证的 Relay 通道可请求原始任务 ID；Relay 已验证当前分享、权限与设备。
                    // 本地 MCP 没有原始读写入口，也无需保留已失效的每任务宿主连接。
                    if (request.method === 'readThread') {
                        result = await service.readFromCodex(request.codexThreadId);
                    } else {
                        if (typeof request.prompt !== 'string') {
                            throw new Error('Relay sent an invalid message prompt');
                        }
                        result = await service.deliverToCodex(request.codexThreadId, request.prompt);
                    }
                    socket.send(JSON.stringify({ id: requestId, result }));
                } catch (error) {
                    if (requestId) {
                        socket.send(JSON.stringify({
                            id: requestId,
                            error: error instanceof Error
                                ? error.message
                                : 'Unknown Codex delivery error',
                        }));
                    }
                }
            })();
        });
        socket.addEventListener('close', () => {
            for (const controller of previewHttpRequests.values()) {
                controller.abort();
            }
            previewHttpRequests.clear();
            for (const localSocket of previewWebSockets.values()) {
                localSocket.close(1012, 'Shuttle Relay disconnected');
            }
            previewWebSockets.clear();
            if (!stopped) {
                setTimeout(connectDevice, 1_000).unref();
            }
        });
        socket.addEventListener('error', () => socket.close());
    };
    connectDevice();

    process.stdout.write(`${JSON.stringify({
        type: 'ready',
        protocolVersion: 1,
        pid: process.pid,
        runtime: getCompanionRuntime(),
        socketPath,
    })}\n`);

    for await (const line of input) {
        try {
            const request = JSON.parse(line) as {
                id?: unknown;
                method?: unknown;
                result?: unknown;
                query?: unknown;
            };
            if (request.method === 'recipients.search' && typeof request.query === 'string') {
                const query = request.query;
                void relay.searchRecipients(query).then((result) => {
                    process.stdout.write(`${JSON.stringify({ type: 'recipients-result', query, users: getObject(result).users })}\n`);
                }).catch(() => {
                    process.stdout.write(`${JSON.stringify({ type: 'recipients-result', query, users: [], error: '暂时无法搜索邮箱，仍可手动输入。' })}\n`);
                });
                continue;
            }
            if (request.method === 'authorization.respond' && typeof request.id === 'string') {
                const pending = pendingAuthorizations.get(request.id);
                if (pending) {
                    pendingAuthorizations.delete(request.id);
                    try {
                        pending.resolve(readAuthorizationDecision(request.result));
                    } catch (error) {
                        pending.reject(error instanceof Error ? error : new Error('Invalid authorization'));
                    }
                }
                continue;
            }
            if (request.method !== 'shutdown') {
                continue;
            }
            process.stdout.write(`${JSON.stringify({ id: request.id ?? null, result: { shuttingDown: true } })}\n`);
            input.close();
            break;
        } catch {
            // The menu bar client only sends shutdown; malformed control input is ignored.
        }
    }

    stopped = true;
    process.removeListener('SIGTERM', stopCodex);
    process.removeListener('SIGINT', stopCodex);
    await codex.close();
    for (const pending of pendingAuthorizations.values()) {
        pending.reject(new Error('Shuttle Client disconnected'));
    }
    pendingAuthorizations.clear();
    deviceSocket?.close();
    mcpServer.closeAllConnections();
    await new Promise<void>((resolve) => mcpServer.close(() => resolve()));
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    // Node removes the Unix socket when its server closes.
};
