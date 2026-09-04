import type { WSContext, WSMessageReceive } from 'hono/ws';

interface PendingDelivery {
    deviceId: string;
    reject: (error: Error) => void;
    resolve: (value: unknown) => void;
    timeout: NodeJS.Timeout;
}

interface PendingHttpRequest {
    controller?: ReadableStreamDefaultController<Uint8Array>;
    deviceId: string;
    reject: (error: Error) => void;
    previewServiceId: string;
    resolve: (response: Response) => void;
    responseStarted: boolean;
    socket: WSContext;
    timeout: NodeJS.Timeout;
}

interface PreviewWebSocket {
    browser: WSContext;
    deviceId: string;
    deviceSocket: WSContext;
    previewServiceId: string;
    expiresAt?: number;
}

const decodeBase64 = (value: string): Uint8Array<ArrayBuffer> => {
    const binary = atob(value);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
};

const encodeBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32_768) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
    }
    return btoa(binary);
};

export class DeviceHub {
    private readonly connections = new Map<string, WSContext>();
    private readonly httpRequests = new Map<string, PendingHttpRequest>();
    private readonly pending = new Map<string, PendingDelivery>();
    private readonly previewWebSockets = new Map<string, PreviewWebSocket>();

    connect(deviceId: string, socket: WSContext): void {
        this.connections.get(deviceId)?.close(1012, 'Replaced by a new Shuttle connection');
        this.connections.set(deviceId, socket);
    }

    isConnected(deviceId: string): boolean {
        return this.connections.get(deviceId)?.readyState === 1;
    }

    disconnectDevice(deviceId: string): void {
        const socket = this.connections.get(deviceId);
        if (!socket) {
            return;
        }
        socket.close(1008, 'This Shuttle device was revoked');
        this.disconnect(deviceId, socket);
    }

    closePreviewConnections(deviceId: string, previewServiceId: string): void {
        const error = new Error('Preview access was revoked');
        for (const [requestId, request] of this.httpRequests) {
            if (request.deviceId !== deviceId || request.previewServiceId !== previewServiceId) {
                continue;
            }
            clearTimeout(request.timeout);
            if (request.responseStarted && request.controller) {
                request.controller.error(error);
            } else {
                request.reject(error);
            }
            if (request.socket.readyState === 1) {
                request.socket.send(JSON.stringify({
                    method: 'previewHttpCancel',
                    previewId: requestId,
                }));
            }
            this.httpRequests.delete(requestId);
        }
        for (const [previewId, preview] of this.previewWebSockets) {
            if (preview.deviceId !== deviceId || preview.previewServiceId !== previewServiceId) {
                continue;
            }
            this.closePreviewWebSocket(previewId, 4003, error.message);
            preview.browser.close(4003, error.message);
        }
    }

    disconnect(deviceId: string, socket: WSContext): void {
        if (this.connections.get(deviceId) !== socket) {
            return;
        }
        this.connections.delete(deviceId);
        for (const [requestId, delivery] of this.pending) {
            if (delivery.deviceId === deviceId) {
                clearTimeout(delivery.timeout);
                delivery.reject(new Error('The task owner went offline'));
                this.pending.delete(requestId);
            }
        }
        for (const [requestId, request] of this.httpRequests) {
            if (request.deviceId === deviceId) {
                clearTimeout(request.timeout);
                const error = new Error('The preview owner went offline');
                if (request.responseStarted && request.controller) {
                    request.controller.error(error);
                } else {
                    request.reject(error);
                }
                this.httpRequests.delete(requestId);
            }
        }
        for (const [previewId, preview] of this.previewWebSockets) {
            if (preview.deviceId === deviceId) {
                preview.browser.close(1012, 'The preview owner went offline');
                this.previewWebSockets.delete(previewId);
            }
        }
    }

    handleMessage(deviceId: string, value: WSMessageReceive): void {
        let response: {
            data?: unknown;
            error?: unknown;
            event?: unknown;
            headers?: unknown;
            id?: unknown;
            result?: unknown;
            status?: unknown;
        };
        try {
            response = JSON.parse(String(value)) as typeof response;
        } catch {
            return;
        }
        if (typeof response.id !== 'string') {
            return;
        }
        const httpRequest = this.httpRequests.get(response.id);
        if (httpRequest && httpRequest.deviceId === deviceId) {
            this.handleHttpMessage(response.id, httpRequest, response);
            return;
        }
        const preview = this.previewWebSockets.get(response.id);
        if (preview && preview.deviceId === deviceId) {
            this.handlePreviewWebSocketMessage(response.id, preview, response);
            return;
        }
        const delivery = this.pending.get(response.id);
        if (!delivery || delivery.deviceId !== deviceId) {
            return;
        }
        this.pending.delete(response.id);
        clearTimeout(delivery.timeout);
        if (typeof response.error === 'string') {
            delivery.reject(new Error(response.error));
        } else {
            delivery.resolve(response.result);
        }
    }

    async deliver(deviceId: string, codexThreadId: string, prompt: string): Promise<void> {
        await this.request(deviceId, { codexThreadId, method: 'sendMessage', prompt });
    }

    readThread(deviceId: string, codexThreadId: string): Promise<unknown> {
        return this.request(deviceId, { codexThreadId, method: 'readThread' });
    }

    proxyPreviewRequest(
        deviceId: string,
        previewServiceId: string,
        targetURL: string,
        request: {
            bodyBase64?: string;
            headers: [string, string][];
            method: string;
        },
    ): Promise<Response> {
        const socket = this.connections.get(deviceId);
        if (!socket || socket.readyState !== 1) {
            return Promise.reject(new Error('The preview owner is offline'));
        }

        const id = crypto.randomUUID();
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.httpRequests.delete(id);
                reject(new Error('Preview response headers timed out'));
                socket.send(JSON.stringify({ method: 'previewHttpCancel', previewId: id }));
            }, 30_000);
            this.httpRequests.set(id, {
                deviceId,
                previewServiceId,
                reject,
                resolve,
                responseStarted: false,
                socket,
                timeout,
            });
            socket.send(JSON.stringify({ id, method: 'previewHttp', request, targetURL }));
        });
    }

    openPreviewWebSocket(
        deviceId: string,
        previewServiceId: string,
        targetURL: string,
        protocols: string[],
        headers: [string, string][],
        browser: WSContext,
        expiresAt?: number,
    ): string {
        const deviceSocket = this.connections.get(deviceId);
        if (!deviceSocket || deviceSocket.readyState !== 1) {
            throw new Error('The preview owner is offline');
        }
        const id = crypto.randomUUID();
        this.previewWebSockets.set(id, {
            browser,
            deviceId,
            deviceSocket,
            previewServiceId,
            expiresAt,
        });
        deviceSocket.send(JSON.stringify({
            headers,
            id,
            method: 'previewWebSocket',
            protocols,
            targetURL,
        }));
        return id;
    }

    async forwardPreviewWebSocketData(id: string, value: WSMessageReceive): Promise<void> {
        const preview = this.previewWebSockets.get(id);
        if (!preview || preview.deviceSocket.readyState !== 1) {
            return;
        }
        if (preview.expiresAt && preview.expiresAt <= Date.now()) {
            this.closePreviewWebSocket(id, 4003, 'Share authorization expired');
            preview.browser.close(4003, 'Share authorization expired');
            return;
        }
        if (typeof value === 'string') {
            preview.deviceSocket.send(JSON.stringify({
                binary: false,
                data: value,
                method: 'previewWebSocketData',
                previewId: id,
            }));
            return;
        }
        const buffer = value instanceof Blob ? await value.arrayBuffer() : value;
        preview.deviceSocket.send(JSON.stringify({
            binary: true,
            data: encodeBase64(new Uint8Array(buffer)),
            method: 'previewWebSocketData',
            previewId: id,
        }));
    }

    closePreviewWebSocket(id: string, code = 1000, reason = ''): void {
        const preview = this.previewWebSockets.get(id);
        if (!preview) {
            return;
        }
        this.previewWebSockets.delete(id);
        if (preview.deviceSocket.readyState === 1) {
            preview.deviceSocket.send(JSON.stringify({
                code,
                method: 'previewWebSocketClose',
                previewId: id,
                reason,
            }));
        }
    }

    private request(deviceId: string, request: object): Promise<unknown> {
        const socket = this.connections.get(deviceId);
        if (!socket || socket.readyState !== 1) {
            return Promise.reject(new Error('The task owner is offline'));
        }

        const id = crypto.randomUUID();
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('Codex device request timed out'));
            }, 30_000);
            this.pending.set(id, { deviceId, reject, resolve, timeout });
            socket.send(JSON.stringify({ id, ...request }));
        });
    }

    private handleHttpMessage(
        id: string,
        request: PendingHttpRequest,
        message: {
            data?: unknown;
            error?: unknown;
            event?: unknown;
            headers?: unknown;
            status?: unknown;
        },
    ): void {
        if (typeof message.error === 'string') {
            this.httpRequests.delete(id);
            clearTimeout(request.timeout);
            const error = new Error(message.error);
            if (request.responseStarted && request.controller) {
                request.controller.error(error);
            } else {
                request.reject(error);
            }
            return;
        }
        if (message.event === 'previewHttpHead'
            && typeof message.status === 'number'
            && Array.isArray(message.headers)) {
            clearTimeout(request.timeout);
            request.responseStarted = true;
            request.resolve(new Response(new ReadableStream<Uint8Array>({
                start(controller) {
                    request.controller = controller;
                },
                cancel: () => {
                    this.httpRequests.delete(id);
                    if (request.socket.readyState === 1) {
                        request.socket.send(JSON.stringify({
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
        if (!request.responseStarted) {
            return;
        }
        if (message.event === 'previewHttpData' && typeof message.data === 'string') {
            request.controller?.enqueue(decodeBase64(message.data));
        } else if (message.event === 'previewHttpEnd') {
            this.httpRequests.delete(id);
            request.controller?.close();
        }
    }

    private handlePreviewWebSocketMessage(
        id: string,
        preview: PreviewWebSocket,
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
        if (preview.expiresAt && preview.expiresAt <= Date.now()) {
            this.closePreviewWebSocket(id, 4003, 'Share authorization expired');
            preview.browser.close(4003, 'Share authorization expired');
            return;
        }
        if (typeof message.error === 'string') {
            this.previewWebSockets.delete(id);
            preview.browser.close(1011, message.error.slice(0, 120));
            return;
        }
        if (message.event === 'previewWebSocketOpen') {
            if (typeof message.protocol === 'string'
                && preview.browser.protocol
                && message.protocol !== preview.browser.protocol) {
                this.closePreviewWebSocket(id, 1002, 'WebSocket subprotocol mismatch');
                preview.browser.close(1002, 'WebSocket subprotocol mismatch');
            }
            return;
        }
        if (message.event === 'previewWebSocketData' && typeof message.data === 'string') {
            preview.browser.send(message.binary === true
                ? decodeBase64(message.data)
                : message.data);
        } else if (message.event === 'previewWebSocketClose') {
            this.previewWebSockets.delete(id);
            const code = typeof message.code === 'number' ? message.code : 1000;
            const reason = typeof message.reason === 'string' ? message.reason : '';
            if (code === 1005) {
                preview.browser.close();
            } else if (code === 1006 || code === 1015) {
                preview.browser.close(1011, reason || 'Local WebSocket closed unexpectedly');
            } else {
                preview.browser.close(code, reason);
            }
        }
    }
}
