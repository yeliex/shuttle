import { DurableObject } from 'cloudflare:workers';
import type { RelayBindings } from '../env.js';

interface PreviewWebSocketAttachment {
    id: string;
    previewServiceId: string;
    type: 'preview';
    expiresAt: number | null;
}

const encodeBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32_768) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
    }
    return btoa(binary);
};

export class ThreadHub extends DurableObject<RelayBindings> {
    private readonly pendingHttp = new Map<string, {
        controller?: ReadableStreamDefaultController<Uint8Array>;
        reject: (error: Error) => void;
        resolve: (response: Response) => void;
        responseStarted: boolean;
        previewServiceId: string;
        socket: WebSocket;
        timeout: ReturnType<typeof setTimeout>;
    }>();
    private readonly pending = new Map<string, {
        reject: (error: Error) => void;
        resolve: (value: unknown) => void;
        socket: WebSocket;
        timeout: ReturnType<typeof setTimeout>;
    }>();

    override async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        if (request.method === 'GET' && url.pathname === '/connect') {
            if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
                return new Response('WebSocket upgrade required', { status: 426 });
            }
            for (const connection of this.ctx.getWebSockets('device')) {
                connection.close(1012, 'Replaced by a new Shuttle connection');
            }
            const pair = new WebSocketPair();
            const client = pair[0];
            const server = pair[1];
            server.serializeAttachment({ type: 'device' });
            this.ctx.acceptWebSocket(server, ['device']);
            return new Response(null, {
                status: 101,
                webSocket: client,
                headers: { 'Sec-WebSocket-Protocol': 'shuttle.v1' },
            });
        }

        if (request.method === 'GET' && url.pathname === '/status') {
            return Response.json({
                online: this.ctx.getWebSockets('device').some((socket) => socket.readyState === 1),
            });
        }

        if (request.method === 'POST' && url.pathname === '/revoke-device') {
            const error = new Error('This Shuttle device was revoked');
            for (const connection of this.ctx.getWebSockets('device')) {
                this.failPending(connection, error);
                connection.close(1008, error.message);
            }
            this.closePreviewConnections(undefined, error.message);
            return new Response(null, { status: 204 });
        }

        if (request.method === 'POST' && url.pathname === '/preview/revoke') {
            const body = await request.json() as { previewServiceId?: unknown };
            if (typeof body.previewServiceId !== 'string') {
                return Response.json({ error: 'Invalid preview revocation' }, { status: 400 });
            }
            this.closePreviewConnections(body.previewServiceId, 'Preview access was revoked');
            return new Response(null, { status: 204 });
        }

        if (request.method === 'GET' && url.pathname === '/preview/ws') {
            if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
                return new Response('WebSocket upgrade required', { status: 426 });
            }
            const connection = this.ctx.getWebSockets('device')
                .find((socket) => socket.readyState === 1);
            const targetURL = request.headers.get('x-shuttle-target-url');
            const previewServiceId = request.headers.get('x-shuttle-preview-service-id');
            if (!connection || !targetURL || !previewServiceId) {
                return Response.json({ error: 'The preview owner is offline' }, { status: 503 });
            }
            const protocols = request.headers.get('sec-websocket-protocol')
                ?.split(',')
                .map((value) => value.trim())
                .filter(Boolean) ?? [];
            const headers: [string, string][] = [];
            for (const name of ['origin', 'user-agent']) {
                const value = request.headers.get(name);
                if (value) {
                    headers.push([name, value]);
                }
            }
            const id = crypto.randomUUID();
            const pair = new WebSocketPair();
            const client = pair[0];
            const server = pair[1];
            server.serializeAttachment({
                id,
                previewServiceId,
                type: 'preview',
                expiresAt: request.headers.get('x-shuttle-expires-at')
                    ? Date.parse(request.headers.get('x-shuttle-expires-at')!) : null,
            } satisfies PreviewWebSocketAttachment);
            this.ctx.acceptWebSocket(server, [
                `preview:${id}`,
                `preview-service:${previewServiceId}`,
            ]);
            connection.send(JSON.stringify({
                headers,
                id,
                method: 'previewWebSocket',
                protocols,
                targetURL,
            }));
            return new Response(null, {
                headers: protocols[0]
                    ? { 'Sec-WebSocket-Protocol': protocols[0] }
                    : undefined,
                status: 101,
                webSocket: client,
            });
        }

        if (request.method === 'POST' && url.pathname === '/deliver') {
            const connection = this.ctx.getWebSockets('device')
                .find((socket) => socket.readyState === 1);
            if (!connection) {
                return Response.json({ error: 'The task owner is offline' }, { status: 503 });
            }
            const body = await request.json() as {
                codexThreadId?: unknown;
                method?: unknown;
                prompt?: unknown;
            };
            if (typeof body.codexThreadId !== 'string'
                || (body.method !== 'readThread' && body.method !== 'sendMessage')
                || (body.method === 'sendMessage' && typeof body.prompt !== 'string')) {
                return Response.json({ error: 'Invalid delivery request' }, { status: 400 });
            }

            const id = crypto.randomUUID();
            try {
                const result = await new Promise<unknown>((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        this.pending.delete(id);
                        reject(new Error('Codex device request timed out'));
                    }, 30_000);
                    this.pending.set(id, { reject, resolve, socket: connection, timeout });
                    connection.send(JSON.stringify({ id, ...body }));
                });
                return Response.json({ result });
            } catch (error) {
                return Response.json({
                    error: error instanceof Error ? error.message : 'Codex message delivery failed',
                }, { status: 503 });
            }
        }

        if (request.method === 'POST' && url.pathname === '/preview/http') {
            const connection = this.ctx.getWebSockets('device')
                .find((socket) => socket.readyState === 1);
            if (!connection) {
                return Response.json({ error: 'The preview owner is offline' }, { status: 503 });
            }
            const body = await request.json() as {
                previewServiceId?: unknown;
                request?: unknown;
                targetURL?: unknown;
            };
            if (typeof body.previewServiceId !== 'string'
                || typeof body.targetURL !== 'string'
                || !body.request
                || typeof body.request !== 'object'
                || Array.isArray(body.request)) {
                return Response.json({ error: 'Invalid preview HTTP request' }, { status: 400 });
            }
            const previewServiceId = body.previewServiceId;

            const id = crypto.randomUUID();
            try {
                return await new Promise<Response>((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        this.pendingHttp.delete(id);
                        reject(new Error('Preview response headers timed out'));
                        connection.send(JSON.stringify({
                            method: 'previewHttpCancel',
                            previewId: id,
                        }));
                    }, 30_000);
                    this.pendingHttp.set(id, {
                        previewServiceId,
                        reject,
                        resolve,
                        responseStarted: false,
                        socket: connection,
                        timeout,
                    });
                    connection.send(JSON.stringify({
                        id,
                        method: 'previewHttp',
                        request: body.request,
                        targetURL: body.targetURL,
                    }));
                });
            } catch (error) {
                return Response.json({
                    error: error instanceof Error ? error.message : 'Preview request failed',
                }, { status: 503 });
            }
        }

        return new Response('Not found', { status: 404 });
    }

    override webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
        const attachment = socket.deserializeAttachment() as PreviewWebSocketAttachment | {
            type?: unknown;
        } | null;
        if (attachment?.type === 'preview' && 'id' in attachment) {
            if (attachment.expiresAt && attachment.expiresAt <= Date.now()) {
                socket.close(4003, 'Share authorization expired');
                return;
            }
            const connection = this.ctx.getWebSockets('device')
                .find((candidate) => candidate.readyState === 1);
            if (!connection) {
                socket.close(1012, 'The preview owner is offline');
                return;
            }
            connection.send(JSON.stringify({
                binary: typeof message !== 'string',
                data: typeof message === 'string'
                    ? message
                    : encodeBase64(new Uint8Array(message)),
                method: 'previewWebSocketData',
                previewId: attachment.id,
            }));
            return;
        }

        let response: {
            binary?: unknown;
            code?: unknown;
            data?: unknown;
            error?: unknown;
            event?: unknown;
            headers?: unknown;
            id?: unknown;
            protocol?: unknown;
            reason?: unknown;
            result?: unknown;
            status?: unknown;
        };
        try {
            response = JSON.parse(String(message)) as typeof response;
        } catch {
            return;
        }
        if (typeof response.id !== 'string') {
            return;
        }
        const pendingHttp = this.pendingHttp.get(response.id);
        if (pendingHttp && pendingHttp.socket === socket) {
            this.handleHttpMessage(response.id, pendingHttp, response);
            return;
        }
        const preview = this.ctx.getWebSockets(`preview:${response.id}`)[0];
        if (preview) {
            const authorization = preview.deserializeAttachment() as PreviewWebSocketAttachment;
            if (authorization.expiresAt && authorization.expiresAt <= Date.now()) {
                preview.close(4003, 'Share authorization expired');
                return;
            }
            this.handlePreviewWebSocketMessage(response.id, preview, response);
            return;
        }
        const pending = this.pending.get(response.id);
        if (!pending || pending.socket !== socket) {
            return;
        }
        this.pending.delete(response.id);
        clearTimeout(pending.timeout);
        if (typeof response.error === 'string') {
            pending.reject(new Error(response.error));
        } else {
            pending.resolve(response.result);
        }
    }

    override webSocketClose(socket: WebSocket, code: number, reason: string): void {
        const attachment = socket.deserializeAttachment() as PreviewWebSocketAttachment | {
            type?: unknown;
        } | null;
        if (attachment?.type === 'preview' && 'id' in attachment) {
            const connection = this.ctx.getWebSockets('device')
                .find((candidate) => candidate.readyState === 1);
            connection?.send(JSON.stringify({
                code,
                method: 'previewWebSocketClose',
                previewId: attachment.id,
                reason,
            }));
            return;
        }
        this.failPending(socket, new Error('The task owner went offline'));
        for (const preview of this.ctx.getWebSockets()) {
            const previewAttachment = preview.deserializeAttachment() as { type?: unknown } | null;
            if (previewAttachment?.type === 'preview') {
                preview.close(1012, 'The preview owner went offline');
            }
        }
    }

    override webSocketError(socket: WebSocket): void {
        const attachment = socket.deserializeAttachment() as PreviewWebSocketAttachment | {
            type?: unknown;
        } | null;
        if (attachment?.type === 'preview' && 'id' in attachment) {
            const connection = this.ctx.getWebSockets('device')
                .find((candidate) => candidate.readyState === 1);
            connection?.send(JSON.stringify({
                code: 1011,
                method: 'previewWebSocketClose',
                previewId: attachment.id,
                reason: 'Browser WebSocket failed',
            }));
            return;
        }
        this.failPending(socket, new Error('The task owner connection failed'));
    }

    private failPending(socket: WebSocket, error: Error): void {
        for (const [id, pending] of this.pending) {
            if (pending.socket === socket) {
                clearTimeout(pending.timeout);
                pending.reject(error);
                this.pending.delete(id);
            }
        }
        for (const [id, pending] of this.pendingHttp) {
            if (pending.socket === socket) {
                clearTimeout(pending.timeout);
                if (pending.responseStarted && pending.controller) {
                    pending.controller.error(error);
                } else {
                    pending.reject(error);
                }
                this.pendingHttp.delete(id);
            }
        }
    }

    private closePreviewConnections(
        previewServiceId: string | undefined,
        reason: string,
    ): void {
        const error = new Error(reason);
        for (const [id, pending] of this.pendingHttp) {
            if (previewServiceId && pending.previewServiceId !== previewServiceId) {
                continue;
            }
            clearTimeout(pending.timeout);
            if (pending.responseStarted && pending.controller) {
                pending.controller.error(error);
            } else {
                pending.reject(error);
            }
            if (pending.socket.readyState === 1) {
                pending.socket.send(JSON.stringify({
                    method: 'previewHttpCancel',
                    previewId: id,
                }));
            }
            this.pendingHttp.delete(id);
        }
        const previews = previewServiceId
            ? this.ctx.getWebSockets(`preview-service:${previewServiceId}`)
            : this.ctx.getWebSockets();
        for (const preview of previews) {
            const attachment = preview.deserializeAttachment() as PreviewWebSocketAttachment | null;
            if (attachment?.type !== 'preview'
                || (previewServiceId && attachment.previewServiceId !== previewServiceId)) {
                continue;
            }
            preview.close(4003, reason);
        }
    }

    private handleHttpMessage(
        id: string,
        pending: {
            controller?: ReadableStreamDefaultController<Uint8Array>;
            reject: (error: Error) => void;
            resolve: (response: Response) => void;
            responseStarted: boolean;
            socket: WebSocket;
            timeout: ReturnType<typeof setTimeout>;
        },
        message: {
            data?: unknown;
            error?: unknown;
            event?: unknown;
            headers?: unknown;
            status?: unknown;
        },
    ): void {
        if (typeof message.error === 'string') {
            this.pendingHttp.delete(id);
            clearTimeout(pending.timeout);
            const error = new Error(message.error);
            if (pending.responseStarted && pending.controller) {
                pending.controller.error(error);
            } else {
                pending.reject(error);
            }
            return;
        }
        if (message.event === 'previewHttpHead'
            && typeof message.status === 'number'
            && Array.isArray(message.headers)) {
            clearTimeout(pending.timeout);
            pending.responseStarted = true;
            pending.resolve(new Response(new ReadableStream<Uint8Array>({
                start(controller) {
                    pending.controller = controller;
                },
                cancel: () => {
                    this.pendingHttp.delete(id);
                    if (pending.socket.readyState === 1) {
                        pending.socket.send(JSON.stringify({
                            method: 'previewHttpCancel',
                            previewId: id,
                        }));
                    }
                },
            }), {
                headers: message.headers as [string, string][],
                status: message.status,
            }));
            return;
        }
        if (!pending.responseStarted) {
            return;
        }
        if (message.event === 'previewHttpData' && typeof message.data === 'string') {
            pending.controller?.enqueue(Uint8Array.from(
                atob(message.data),
                (character) => character.charCodeAt(0),
            ));
        } else if (message.event === 'previewHttpEnd') {
            this.pendingHttp.delete(id);
            pending.controller?.close();
        }
    }

    private handlePreviewWebSocketMessage(
        id: string,
        browser: WebSocket,
        message: {
            binary?: unknown;
            code?: unknown;
            data?: unknown;
            error?: unknown;
            event?: unknown;
            protocol?: unknown;
            reason?: unknown;
        },
    ): void {
        if (typeof message.error === 'string') {
            browser.close(1011, message.error.slice(0, 120));
            return;
        }
        if (message.event === 'previewWebSocketOpen') {
            const requestedProtocol = browser.protocol;
            if (requestedProtocol
                && typeof message.protocol === 'string'
                && message.protocol !== requestedProtocol) {
                browser.close(1002, 'WebSocket subprotocol mismatch');
                const device = this.ctx.getWebSockets('device')[0];
                device?.send(JSON.stringify({
                    code: 1002,
                    method: 'previewWebSocketClose',
                    previewId: id,
                    reason: 'WebSocket subprotocol mismatch',
                }));
            }
            return;
        }
        if (message.event === 'previewWebSocketData' && typeof message.data === 'string') {
            browser.send(message.binary === true
                ? Uint8Array.from(
                    atob(message.data),
                    (character) => character.charCodeAt(0),
                )
                : message.data);
        } else if (message.event === 'previewWebSocketClose') {
            const code = typeof message.code === 'number' ? message.code : 1000;
            const reason = typeof message.reason === 'string' ? message.reason : '';
            if (code === 1005) {
                browser.close();
            } else if (code === 1006 || code === 1015) {
                browser.close(1011, reason || 'Local WebSocket closed unexpectedly');
            } else {
                browser.close(code, reason);
            }
        }
    }
}
