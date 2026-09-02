import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const APP_TOOLS_RELATIVE_PATH = join(
    'plugins',
    'openai-bundled',
    'plugins',
    'codex-app-tools',
    'server.mjs',
);
const MCP_PROTOCOL_VERSION = '2025-06-18';

export interface CodexHost {
    nodePath: string;
    serverPath: string;
    pipePath: string;
}

export interface CodexHostEnvironment extends NodeJS.ProcessEnv {
    CODEX_APP_TOOLS_PIPE_PATH?: string;
    CODEX_APP_TOOLS_SERVER_PATH?: string;
    CODEX_MCP_NODE_PATH?: string;
}

export interface ReadThreadOptions {
    threadId: string;
    cursor?: string;
    includeOutputs?: boolean;
    maxOutputCharsPerItem?: number;
    turnLimit?: number;
}

export interface SendMessageOptions {
    threadId: string;
    prompt: string;
}

interface ReadThreadPage {
    page?: {
        hasMore?: unknown;
        nextCursor?: unknown;
    };
}

interface JsonRpcResponse {
    id?: number;
    result?: unknown;
    error?: {
        code?: number;
        message?: string;
    };
}

interface PendingRequest {
    reject: (error: Error) => void;
    resolve: (result: unknown) => void;
    timeout: NodeJS.Timeout;
}

const canAccess = async (path: string, mode: number): Promise<boolean> => {
    try {
        await access(path, mode);
        return true;
    } catch {
        return false;
    }
};

export const discoverCodexHost = async (
    environment: CodexHostEnvironment = process.env,
    executablePath = process.execPath,
): Promise<CodexHost> => {
    const nodePath = environment.CODEX_MCP_NODE_PATH ?? executablePath;
    const resourcesPath = resolve(dirname(nodePath), '../..');
    const serverPath = environment.CODEX_APP_TOOLS_SERVER_PATH
        ?? join(resourcesPath, APP_TOOLS_RELATIVE_PATH);
    const pipePath = environment.CODEX_APP_TOOLS_PIPE_PATH;

    if (!await canAccess(nodePath, constants.X_OK)) {
        throw new Error('Codex Node runtime is unavailable');
    }

    if (!await canAccess(serverPath, constants.R_OK)) {
        throw new Error('Codex App Tools adapter is unavailable');
    }

    if (!pipePath || !await canAccess(pipePath, constants.R_OK | constants.W_OK)) {
        throw new Error('Codex App Tools pipe was not provided by Codex');
    }

    return { nodePath, serverPath, pipePath };
};

export class CodexAppToolsSession {
    private child: ChildProcessWithoutNullStreams | undefined;
    private closed = false;
    private initializePromise: Promise<void> | undefined;
    private nextRequestId = 2;
    private readonly pending = new Map<number, PendingRequest>();
    private sourceThreadId: string | undefined;
    private stderr = '';
    private stdout = '';

    constructor(
        private readonly host: CodexHost,
        private readonly timeoutMilliseconds = 10_000,
    ) {}

    async callTool(
        sourceThreadId: string,
        name: string,
        args: object,
    ): Promise<unknown> {
        if (this.sourceThreadId && this.sourceThreadId !== sourceThreadId) {
            throw new Error('A Codex App Tools session can serve only one Codex source task');
        }
        this.sourceThreadId = sourceThreadId;
        await this.initialize(sourceThreadId);

        const id = this.nextRequestId;
        this.nextRequestId += 1;

        return this.request(id, {
            jsonrpc: '2.0',
            id,
            method: 'tools/call',
            params: {
                name,
                arguments: args,
                _meta: { 'openai/threadId': sourceThreadId },
            },
        });
    }

    close(): void {
        if (this.closed) {
            return;
        }

        this.closed = true;
        this.child?.kill();
        this.failPending(new Error('Codex App Tools session closed'));
    }

    private async initialize(sourceThreadId: string): Promise<void> {
        if (this.closed) {
            throw new Error('Codex App Tools session is closed');
        }

        if (!this.initializePromise) {
            this.startChild(sourceThreadId);
            this.initializePromise = this.request(1, {
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: MCP_PROTOCOL_VERSION,
                    capabilities: {},
                    clientInfo: { name: 'shuttle-companion', version: '0.0.0' },
                },
            }).then(() => {
                this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
            });
        }

        return this.initializePromise;
    }

    private startChild(sourceThreadId: string): void {
        const child = spawn(
            this.host.nodePath,
            [this.host.serverPath, '--interaction-client-id', sourceThreadId],
            {
                cwd: dirname(this.host.serverPath),
                env: {
                    ...process.env,
                    CODEX_APP_TOOLS_PIPE_PATH: this.host.pipePath,
                },
                stdio: ['pipe', 'pipe', 'pipe'],
            },
        );
        this.child = child;

        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => this.handleStdout(chunk));
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => {
            this.stderr = `${this.stderr}${chunk}`.slice(-4_000);
        });
        child.on('error', (error) => this.handleFailure(error));
        child.on('exit', (code, signal) => {
            if (!this.closed) {
                const detail = this.stderr.trim() || `code=${String(code)} signal=${String(signal)}`;
                this.handleFailure(new Error(`Codex App Tools exited before responding: ${detail}`));
            }
        });
    }

    private request(id: number, message: unknown): Promise<unknown> {
        return new Promise((resolvePromise, rejectPromise) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                rejectPromise(new Error(
                    `Codex App Tools call timed out after ${this.timeoutMilliseconds}ms`,
                ));
            }, this.timeoutMilliseconds);

            this.pending.set(id, {
                reject: rejectPromise,
                resolve: resolvePromise,
                timeout,
            });
            try {
                this.send(message);
            } catch (error) {
                clearTimeout(timeout);
                this.pending.delete(id);
                rejectPromise(error instanceof Error ? error : new Error('Codex App Tools write failed'));
            }
        });
    }

    private send(message: unknown): void {
        if (!this.child || this.child.stdin.destroyed) {
            throw new Error('Codex App Tools process is unavailable');
        }

        this.child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    private handleStdout(chunk: string): void {
        this.stdout += chunk;

        while (true) {
            const newline = this.stdout.indexOf('\n');
            if (newline === -1) {
                return;
            }

            const line = this.stdout.slice(0, newline).trim();
            this.stdout = this.stdout.slice(newline + 1);
            if (!line) {
                continue;
            }

            let response: JsonRpcResponse;
            try {
                response = JSON.parse(line) as JsonRpcResponse;
            } catch {
                this.child?.kill();
                this.handleFailure(new Error('Codex App Tools returned invalid JSON'));
                return;
            }

            if (response.id === undefined) {
                continue;
            }

            const pending = this.pending.get(response.id);
            if (!pending) {
                continue;
            }

            this.pending.delete(response.id);
            clearTimeout(pending.timeout);

            if (response.error) {
                pending.reject(new Error(response.error.message ?? 'Codex App Tools call failed'));
            } else {
                pending.resolve(response.result);
            }
        }
    }

    private failPending(error: Error): void {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timeout);
            pending.reject(error);
        }
        this.pending.clear();
    }

    private handleFailure(error: Error): void {
        this.closed = true;
        this.failPending(error);
    }
}

export const readCodexThread = async (
    session: CodexAppToolsSession,
    sourceThreadId: string,
    options: ReadThreadOptions,
): Promise<unknown> => session.callTool(sourceThreadId, 'read_thread', options);

const decodeReadThreadPage = (result: unknown): unknown => {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
        return result;
    }
    const structuredContent = (result as { structuredContent?: unknown }).structuredContent;
    if (structuredContent && typeof structuredContent === 'object') {
        return structuredContent;
    }
    const content = (result as { content?: unknown }).content;
    if (!Array.isArray(content)) {
        return result;
    }
    const text = content.find((item) => (
        item && typeof item === 'object' && (item as { type?: unknown }).type === 'text'
    ));
    const value = text && typeof text === 'object' ? (text as { text?: unknown }).text : undefined;
    if (typeof value !== 'string') {
        return result;
    }
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return result;
    }
};

export const readCompleteCodexThread = async (
    session: CodexAppToolsSession,
    sourceThreadId: string,
    threadId: string,
): Promise<{ pages: unknown[]; schemaVersion: 1 }> => {
    const pages: unknown[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;

    while (true) {
        const result = await readCodexThread(session, sourceThreadId, {
            threadId,
            cursor,
            includeOutputs: true,
            turnLimit: 10,
        });
        const page = decodeReadThreadPage(result);
        pages.push(page);
        const pageInfo = page && typeof page === 'object' && !Array.isArray(page)
            ? (page as ReadThreadPage).page
            : undefined;
        const nextCursor = pageInfo?.nextCursor;
        if (pageInfo?.hasMore !== true || typeof nextCursor !== 'string') {
            break;
        }
        if (seenCursors.has(nextCursor)) {
            throw new Error('Codex read_thread returned a repeated cursor');
        }
        seenCursors.add(nextCursor);
        cursor = nextCursor;
    }

    return { pages, schemaVersion: 1 };
};

export const sendCodexMessage = async (
    session: CodexAppToolsSession,
    sourceThreadId: string,
    options: SendMessageOptions,
): Promise<unknown> => session.callTool(sourceThreadId, 'send_message_to_thread', options);
