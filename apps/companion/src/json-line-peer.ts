import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

interface JsonRpcError {
    code: number;
    message: string;
}

interface JsonRpcMessage {
    jsonrpc?: '2.0';
    id?: number;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: JsonRpcError;
}

interface PendingRequest {
    reject: (error: Error) => void;
    resolve: (value: unknown) => void;
    timeout: NodeJS.Timeout;
}

export type JsonRpcHandler = (params: unknown) => Promise<unknown> | unknown;

export class JsonLinePeer {
    private nextRequestId = 1;
    private readonly pending = new Map<number, PendingRequest>();
    private readonly handlers = new Map<string, JsonRpcHandler>();
    private readonly closeHandlers = new Set<() => void>();
    private closed = false;

    constructor(
        input: Readable,
        private readonly output: Writable,
        private readonly timeoutMilliseconds = 15_000,
    ) {
        const lines = createInterface({ input, crlfDelay: Infinity });
        lines.on('line', (line) => void this.handleLine(line));
        lines.on('close', () => this.handleClose());
        input.on('error', () => this.handleClose());
        output.on('error', () => this.handleClose());
    }

    handle(method: string, handler: JsonRpcHandler): void {
        this.handlers.set(method, handler);
    }

    onClose(handler: () => void): void {
        this.closeHandlers.add(handler);
    }

    request(method: string, params?: unknown): Promise<unknown> {
        if (this.closed) {
            return Promise.reject(new Error('JSON line peer is closed'));
        }

        const id = this.nextRequestId;
        this.nextRequestId += 1;

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Local request timed out after ${this.timeoutMilliseconds}ms`));
            }, this.timeoutMilliseconds);
            this.pending.set(id, { reject, resolve, timeout });
            this.write({ id, method, params });
        });
    }

    notify(method: string, params?: unknown): void {
        this.write({ method, params });
    }

    close(): void {
        if ('end' in this.output && typeof this.output.end === 'function') {
            this.output.end();
        }
        this.handleClose();
    }

    private async handleLine(line: string): Promise<void> {
        let message: JsonRpcMessage;
        try {
            message = JSON.parse(line) as JsonRpcMessage;
        } catch {
            return;
        }

        if (typeof message.method === 'string') {
            const handler = this.handlers.get(message.method);
            if (message.id === undefined) {
                if (handler) {
                    await handler(message.params);
                }
                return;
            }

            if (!handler) {
                this.write({
                    id: message.id,
                    error: { code: -32_601, message: `Unknown method: ${message.method}` },
                });
                return;
            }

            try {
                this.write({ id: message.id, result: await handler(message.params) });
            } catch (error) {
                this.write({
                    id: message.id,
                    error: {
                        code: -32_000,
                        message: error instanceof Error ? error.message : 'Unknown local error',
                    },
                });
            }
            return;
        }

        if (message.id === undefined) {
            return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) {
            return;
        }

        this.pending.delete(message.id);
        clearTimeout(pending.timeout);
        if (message.error) {
            pending.reject(new Error(message.error.message));
        } else {
            pending.resolve(message.result);
        }
    }

    private write(message: JsonRpcMessage): void {
        if (this.closed) {
            throw new Error('JSON line peer is closed');
        }
        this.output.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    }

    private handleClose(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        const error = new Error('JSON line peer closed');
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timeout);
            pending.reject(error);
        }
        this.pending.clear();
        for (const handler of this.closeHandlers) {
            handler();
        }
    }
}
