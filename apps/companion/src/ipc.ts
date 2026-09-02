import { createInterface } from 'node:readline';

import {
    CodexAppToolsSession,
    discoverCodexHost,
    readCodexThread,
    sendCodexMessage,
} from './codex-host.js';
import { getCompanionRuntime } from './index.js';

interface IpcRequest {
    id: string | number;
    method: string;
    params?: Record<string, unknown>;
}

const writeMessage = (message: unknown) => {
    process.stdout.write(`${JSON.stringify(message)}\n`);
};

let codexSession: CodexAppToolsSession | undefined;

const getCodexSession = async (): Promise<CodexAppToolsSession> => {
    codexSession ??= new CodexAppToolsSession(await discoverCodexHost());
    return codexSession;
};

const getRequiredString = (
    params: Record<string, unknown> | undefined,
    name: string,
): string => {
    const value = params?.[name];
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`${name} must be a non-empty string`);
    }

    return value;
};

const getHostStatus = async (): Promise<{ configured: boolean; reason?: string }> => {
    try {
        await discoverCodexHost();
        return { configured: true };
    } catch (error) {
        return {
            configured: false,
            reason: error instanceof Error ? error.message : 'Unknown Codex host error',
        };
    }
};

const handleRequest = async (request: IpcRequest): Promise<unknown> => {
    if (request.method === 'health') {
        return {
            status: 'ok',
            runtime: getCompanionRuntime(),
            codexHost: await getHostStatus(),
        };
    }

    if (request.method === 'codex.readThread') {
        const sourceThreadId = getRequiredString(request.params, 'sourceThreadId');
        const threadId = getRequiredString(request.params, 'threadId');
        const session = await getCodexSession();

        return readCodexThread(session, sourceThreadId, {
            threadId,
            cursor: typeof request.params?.cursor === 'string' ? request.params.cursor : undefined,
            includeOutputs: request.params?.includeOutputs === true,
            maxOutputCharsPerItem: typeof request.params?.maxOutputCharsPerItem === 'number'
                ? request.params.maxOutputCharsPerItem
                : undefined,
            turnLimit: typeof request.params?.turnLimit === 'number'
                ? request.params.turnLimit
                : undefined,
        });
    }

    if (request.method === 'codex.sendMessage') {
        const sourceThreadId = getRequiredString(request.params, 'sourceThreadId');
        const threadId = getRequiredString(request.params, 'threadId');
        const prompt = getRequiredString(request.params, 'prompt');
        const session = await getCodexSession();

        return sendCodexMessage(session, sourceThreadId, { threadId, prompt });
    }

    if (request.method === 'shutdown') {
        codexSession?.close();
        codexSession = undefined;
        return { shuttingDown: true };
    }

    throw new Error(`Unknown method: ${request.method}`);
};

export const serveIpc = async (): Promise<void> => {
    const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

    writeMessage({
        type: 'ready',
        protocolVersion: 1,
        pid: process.pid,
        runtime: getCompanionRuntime(),
    });

    for await (const line of input) {
        let request: IpcRequest | undefined;

        try {
            request = JSON.parse(line) as IpcRequest;
            if ((typeof request.id !== 'string' && typeof request.id !== 'number')
                || typeof request.method !== 'string') {
                throw new Error('Invalid IPC request');
            }

            const result = await handleRequest(request);
            writeMessage({ id: request.id, result });

            if (request.method === 'shutdown') {
                input.close();
                return;
            }
        } catch (error) {
            writeMessage({
                id: request?.id ?? null,
                error: {
                    code: 'INVALID_REQUEST',
                    message: error instanceof Error ? error.message : 'Unknown IPC error',
                },
            });
        }
    }
};
