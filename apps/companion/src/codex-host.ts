import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { JsonLinePeer } from './json-line-peer.js';

export interface CodexHost {
    readThread(threadId: string): Promise<unknown>;
    readCompleteThread(threadId: string): Promise<unknown>;
    sendMessage(threadId: string, prompt: string): Promise<unknown>;
}

interface AppServerOptions {
    executable?: () => Promise<string>;
    timeoutMilliseconds?: number;
    checkIntervalMilliseconds?: number;
}

interface Connection {
    child: ChildProcessWithoutNullStreams;
    peer: JsonLinePeer;
    fingerprint: string;
    available: boolean;
    exited: boolean;
    exit: Promise<void>;
}

interface ThreadResult {
    thread: { id: string; [key: string]: unknown };
}

interface TurnsPage {
    data: unknown[];
    nextCursor: string | null;
}

const executeFile = promisify(execFile);

// 优先使用启动 Companion 的 Codex 安装包，避免 PATH 中另一版 CLI 访问同一份数据。
export const discoverCodexExecutable = async (
    environment: NodeJS.ProcessEnv = process.env,
    nodePath = process.execPath,
): Promise<string> => {
    const candidates = environment.SHUTTLE_CODEX_PATH
        ? [environment.SHUTTLE_CODEX_PATH]
        : [
            resolve(dirname(nodePath), '../../codex'),
            '/Applications/ChatGPT.app/Contents/Resources/codex',
            '/Applications/Codex.app/Contents/Resources/codex',
            join(homedir(), 'Applications/ChatGPT.app/Contents/Resources/codex'),
            join(homedir(), 'Applications/Codex.app/Contents/Resources/codex'),
        ];
    for (const path of candidates) {
        try {
            await access(path, constants.X_OK);
            if ((await stat(path)).isFile()) return path;
        } catch { /* 安装替换期间候选路径可能暂时不存在。 */ }
    }
    if (!environment.SHUTTLE_CODEX_PATH && process.platform === 'darwin') {
        // 安装包被移动时再通过系统索引定位；不复制或固定缓存旧版本二进制。
        const located = await executeFile('/usr/bin/mdfind', ['kMDItemCFBundleIdentifier == "com.openai.codex"'], {
            timeout: 2_000, maxBuffer: 64 * 1024,
        }).catch(() => undefined);
        for (const application of located?.stdout.trim().split('\n').filter(Boolean) ?? []) {
            const path = join(application, 'Contents/Resources/codex');
            try {
                await access(path, constants.X_OK);
                if ((await stat(path)).isFile()) return path;
            } catch { /* 忽略尚未完成替换的安装包。 */ }
        }
    }
    throw new Error('Codex App Server is unavailable. Install Codex Desktop or wait for its update to finish.');
};

/**
 * Companion 独占一个 stdio 子进程。这里只读持久历史或入队，绝不 resume/start 任务。
 * 重连不重放请求：尤其是已写入但尚未收到响应的入队，不能安全地自动重发。
 */
export class CodexAppServer implements CodexHost {
    private connection: Connection | undefined;
    private refreshing: Promise<Connection> | undefined;
    private timer: NodeJS.Timeout | undefined;
    private closed = false;
    private readonly inFlight = new Set<Promise<unknown>>();

    constructor(private readonly options: AppServerOptions = {}) {}

    async start(): Promise<void> {
        const interval = this.options.checkIntervalMilliseconds ?? 5_000;
        if (!this.timer && interval > 0 && !this.closed) {
            this.timer = setInterval(() => { void this.ensureConnection().catch(() => {}); }, interval);
            this.timer.unref();
        }
        await this.ensureConnection();
    }

    async close(): Promise<void> {
        this.closed = true;
        clearInterval(this.timer);
        await this.stopConnection();
        await this.refreshing?.catch(() => {});
        await this.stopConnection();
    }

    readThread(threadId: string): Promise<ThreadResult> {
        return this.execute((peer) => this.readMetadata(peer, threadId));
    }

    readCompleteThread(threadId: string): Promise<unknown> {
        return this.execute(async (peer) => {
            const { thread } = await this.readMetadata(peer, threadId);
            const turns: unknown[] = [];
            const cursors = new Set<string>();
            let cursor: string | undefined;
            do {
                const page = await peer.request('thread/turns/list', {
                    threadId, cursor, limit: 50, itemsView: 'full', sortDirection: 'asc',
                }) as TurnsPage;
                if (!page || !Array.isArray(page.data)
                    || (page.nextCursor !== null && typeof page.nextCursor !== 'string')) {
                    throw new Error('Invalid Codex history response');
                }
                turns.push(...page.data);
                cursor = page.nextCursor ?? undefined;
                if (cursor && cursors.has(cursor)) throw new Error('Repeated Codex history cursor');
                if (cursor) cursors.add(cursor);
            } while (cursor);
            return { schemaVersion: 1, thread, turns };
        });
    }

    sendMessage(threadId: string, prompt: string): Promise<unknown> {
        if (!prompt.trim()) return Promise.reject(new Error('Message must not be empty'));
        return this.execute(async (peer) => {
            const result = await peer.request('thread/queue/add', {
                threadId,
                input: [{ type: 'text', text: prompt, text_elements: [] }],
                clientUserMessageId: crypto.randomUUID(),
            }) as { queuedSubmission?: { id?: unknown } };
            if (typeof result?.queuedSubmission?.id !== 'string') throw new Error('Invalid Codex queue response');
            return { status: 'queued', threadId, queuedSubmissionId: result.queuedSubmission.id };
        }, true);
    }

    private async readMetadata(peer: JsonLinePeer, threadId: string): Promise<ThreadResult> {
        const result = await peer.request('thread/read', { threadId, includeTurns: false }) as ThreadResult;
        if (result?.thread?.id !== threadId) throw new Error('Codex returned a different task');
        return result;
    }

    private async execute<T>(operation: (peer: JsonLinePeer) => Promise<T>, mutation = false): Promise<T> {
        const connection = await this.ensureConnection();
        const request = operation(connection.peer);
        this.inFlight.add(request);
        try {
            return await request;
        } catch {
            // 宿主错误可能包含任务正文或输入；不把原始 stderr/JSON-RPC 错误转发给 Relay。
            throw new Error(mutation
                ? 'Codex queue submission failed or its result is unknown. It was not retried; check the task queue before sending again.'
                : 'Codex task history is unavailable. The task may not exist, or this Codex version may be incompatible.');
        } finally {
            this.inFlight.delete(request);
        }
    }

    private async ensureConnection(): Promise<Connection> {
        if (this.closed) throw new Error('Codex App Server has stopped');
        if (this.refreshing) return this.refreshing;
        const refresh = (async () => {
            let path: string;
            let fingerprint: string;
            try {
                path = await (this.options.executable ?? discoverCodexExecutable)();
                const file = await stat(path);
                fingerprint = `${path}:${file.dev}:${file.ino}:${file.size}:${file.mtimeMs}:${file.ctimeMs}`;
            } catch {
                await Promise.allSettled([...this.inFlight]);
                await this.stopConnection();
                throw new Error('Codex App Server is unavailable. Install Codex Desktop or wait for its update to finish.');
            }
            if (this.connection?.fingerprint === fingerprint && this.connection.available && !this.connection.exited) return this.connection;
            // 新请求等待握手，已有请求先结束；更新不会主动中断一条正在提交的消息。
            await Promise.allSettled([...this.inFlight]);
            await this.stopConnection();
            if (this.closed) throw new Error('Codex App Server has stopped');
            const child = spawn(path, ['app-server', '--listen', 'stdio://'], { stdio: ['pipe', 'pipe', 'pipe'] });
            const peer = new JsonLinePeer(child.stdout, child.stdin, this.options.timeoutMilliseconds ?? 15_000);
            const connection: Connection = { child, peer, fingerprint, available: true, exited: false, exit: Promise.resolve() };
            // stdout 可能先于进程 exit 关闭；此时已经不能复用连接，但仍需等旧进程退出。
            peer.onClose(() => { connection.available = false; });
            connection.exit = new Promise((resolveExit) => {
                const finish = () => { connection.exited = true; peer.close(); resolveExit(); };
                child.once('error', finish);
                child.once('exit', finish);
            });
            child.stderr.resume();
            this.connection = connection;
            try {
                const result = await peer.request('initialize', {
                    clientInfo: { name: 'shuttle_companion', version: '1' },
                    capabilities: { experimentalApi: true },
                }) as { userAgent?: unknown; codexHome?: unknown };
                if (typeof result?.userAgent !== 'string' || typeof result.codexHome !== 'string') {
                    throw new Error('Invalid initialization response');
                }
                peer.notify('initialized');
                return connection;
            } catch {
                await this.stopConnection();
                throw new Error('Codex App Server initialization failed. Check that Codex Desktop is up to date.');
            }
        })();
        this.refreshing = refresh;
        try { return await refresh; }
        finally { if (this.refreshing === refresh) this.refreshing = undefined; }
    }

    private async stopConnection(): Promise<void> {
        const connection = this.connection;
        if (!connection) return;
        this.connection = undefined;
        connection.peer.close();
        if (connection.exited) return;
        connection.child.kill('SIGTERM');
        const timer = setTimeout(() => connection.child.kill('SIGKILL'), 3_000);
        try { await connection.exit; }
        finally { clearTimeout(timer); }
    }
}
