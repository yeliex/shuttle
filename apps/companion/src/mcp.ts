import { spawn } from 'node:child_process';
import { connect } from 'node:net';

import {
    CodexAppToolsSession,
    discoverCodexHost,
    readCompleteCodexThread,
    sendCodexMessage,
} from './codex-host.js';
import { JsonLinePeer } from './json-line-peer.js';
import { getCompanionSocketPath } from './paths.js';

const MCP_PROTOCOL_VERSION = '2025-06-18';

const tools = [
    {
        name: 'share_thread',
        description: 'Explicitly share the current Codex task metadata with selected collaborators.',
        inputSchema: {
            type: 'object',
            properties: {
                services: {
                    type: 'array',
                    description: 'Optional localhost services to include in this task share.',
                    items: {
                        type: 'object',
                        properties: {
                            localURL: { type: 'string', description: 'Local HTTP(S) URL on localhost.' },
                            name: { type: 'string', description: 'Display name for the service.' },
                        },
                        required: ['localURL', 'name'],
                        additionalProperties: false,
                    },
                },
                title: { type: 'string', description: 'Optional display title.' },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'unshare_thread',
        description: 'Stop sharing a task owned by the current Shuttle account.',
        inputSchema: {
            type: 'object',
            properties: { sharedThreadId: { type: 'string' } },
            required: ['sharedThreadId'],
            additionalProperties: false,
        },
    },
    {
        name: 'list_shared_threads',
        description: 'List Codex tasks explicitly shared with or by the current Shuttle account.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'accept_invite',
        description: 'Accept a Shuttle invitation link using the signed-in Shuttle account. Already authorized recipients receive the task reference without claiming again.',
        inputSchema: {
            type: 'object',
            properties: { inviteURL: { type: 'string', description: 'Full Shuttle sharing URL, including the invitation code after #.' } },
            required: ['inviteURL'],
            additionalProperties: false,
        },
    },
    {
        name: 'read_shared_thread',
        description: 'Read an authorized shared task live from its owner\'s online Companion.',
        inputSchema: {
            type: 'object',
            properties: { sharedThreadId: { type: 'string' } },
            required: ['sharedThreadId'],
            additionalProperties: false,
        },
    },
    {
        name: 'send_shared_message',
        description: 'Send a message to an authorized shared Codex task.',
        inputSchema: {
            type: 'object',
            properties: {
                sharedThreadId: { type: 'string' },
                prompt: { type: 'string' },
            },
            required: ['sharedThreadId', 'prompt'],
            additionalProperties: false,
        },
    },
    {
        name: 'share_local_service',
        description: 'Configure one localhost HTTP service for a task that is already shared.',
        inputSchema: {
            type: 'object',
            properties: {
                localURL: { type: 'string', description: 'Local HTTP(S) URL on localhost.' },
                name: { type: 'string', description: 'Display name for the preview.' },
                sharedThreadId: { type: 'string', description: 'Shared task that receives preview feedback.' },
            },
            required: ['localURL', 'name', 'sharedThreadId'],
            additionalProperties: false,
        },
    },
    {
        name: 'stop_sharing_local_service',
        description: 'Stop exposing a local preview owned by the current Shuttle account.',
        inputSchema: {
            type: 'object',
            properties: { previewServiceId: { type: 'string' } },
            required: ['previewServiceId'],
            additionalProperties: false,
        },
    },
] as const;

const getArguments = (params: unknown): Record<string, unknown> => {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
        throw new Error('Tool parameters must be an object');
    }
    const toolArguments = (params as { arguments?: unknown }).arguments;
    if (!toolArguments || typeof toolArguments !== 'object' || Array.isArray(toolArguments)) {
        return {};
    }
    return toolArguments as Record<string, unknown>;
};

const getToolName = (params: unknown): string => {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
        throw new Error('Tool parameters must be an object');
    }
    const name = (params as { name?: unknown }).name;
    if (typeof name !== 'string') {
        throw new Error('Tool name is required');
    }
    return name;
};

const getSourceThreadId = (params: unknown): string => {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
        throw new Error('Tool parameters must be an object');
    }
    const metadata = (params as { _meta?: unknown })._meta;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        throw new Error('Codex did not provide task metadata');
    }
    const threadId = (metadata as { threadId?: unknown }).threadId;
    if (typeof threadId !== 'string' || threadId.length === 0) {
        throw new Error('Codex did not provide a task ID');
    }
    return threadId;
};

const callDaemonTool = async (
    daemon: JsonLinePeer,
    name: string,
    toolArguments: Record<string, unknown>,
): Promise<unknown> => {
    if (name === 'share_thread') {
        return daemon.request('shuttle.shareThread', toolArguments);
    }
    if (name === 'unshare_thread') {
        return daemon.request('shuttle.unshareThread', toolArguments);
    }
    if (name === 'list_shared_threads') {
        return daemon.request('shuttle.listSharedThreads', toolArguments);
    }
    if (name === 'accept_invite') {
        return daemon.request('shuttle.acceptInvite', toolArguments);
    }
    if (name === 'read_shared_thread') {
        return daemon.request('shuttle.readSharedThread', toolArguments);
    }
    if (name === 'send_shared_message') {
        return daemon.request('shuttle.sendSharedMessage', toolArguments);
    }
    if (name === 'share_local_service') {
        return daemon.request('shuttle.shareLocalService', toolArguments);
    }
    if (name === 'stop_sharing_local_service') {
        return daemon.request('shuttle.stopSharingLocalService', toolArguments);
    }
    throw new Error(`Unknown Shuttle tool: ${name}`);
};

const toolResult = (value: unknown): object => ({
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
});

export const serveMcp = async (): Promise<void> => {
    let sourceThreadId: string | undefined;
    let daemon: JsonLinePeer | undefined;
    let codexSession: CodexAppToolsSession | undefined;
    let daemonPromise: Promise<JsonLinePeer> | undefined;

    const getDaemon = (threadId: string): Promise<JsonLinePeer> => {
        if (sourceThreadId && sourceThreadId !== threadId) {
            return Promise.reject(new Error('A Shuttle MCP session can serve only one Codex task'));
        }
        sourceThreadId = threadId;
        if (daemonPromise) {
            return daemonPromise;
        }
        const connection = (async () => {
            const socketPath = getCompanionSocketPath();
            let socket = connect(socketPath);
            try {
                await new Promise<void>((resolve, reject) => {
                    socket.once('connect', resolve);
                    socket.once('error', reject);
                });
            } catch (error) {
                socket.destroy();
                const errorCode = error && typeof error === 'object' && 'code' in error
                    ? String(error.code)
                    : undefined;
                if (process.platform !== 'darwin'
                    || (errorCode !== 'ENOENT' && errorCode !== 'ECONNREFUSED')) {
                    throw error;
                }

                const launchExitCode = await new Promise<number | null>((resolve, reject) => {
                    const launcher = spawn('/usr/bin/open', ['-b', 'com.yeliex.shuttle'], {
                        stdio: 'ignore',
                    });
                    launcher.once('error', reject);
                    launcher.once('exit', resolve);
                });
                if (launchExitCode !== 0) {
                    throw new Error(
                        'Shuttle for macOS is required. Download it from https://shuttle.makesth.fun.',
                    );
                }

                const deadline = Date.now() + 10_000;
                while (true) {
                    await new Promise((resolve) => setTimeout(resolve, 250));
                    socket = connect(socketPath);
                    try {
                        await new Promise<void>((resolve, reject) => {
                            socket.once('connect', resolve);
                            socket.once('error', reject);
                        });
                        break;
                    } catch {
                        socket.destroy();
                        if (Date.now() >= deadline) {
                            throw new Error(
                                'Cannot connect to Shuttle Companion. Check its status in Set Up Shuttle; sign in only if requested, then try again.',
                            );
                        }
                    }
                }
            }
            const nextDaemon = new JsonLinePeer(socket, socket, 5 * 60_000);
            const nextCodexSession = new CodexAppToolsSession(await discoverCodexHost());
            daemon = nextDaemon;
            codexSession = nextCodexSession;
            nextDaemon.onClose(() => {
                if (daemon !== nextDaemon) { return; }
                nextCodexSession.close();
                daemon = undefined;
                codexSession = undefined;
                daemonPromise = undefined;
            });
            nextDaemon.handle('host.readThread', () => (
                readCompleteCodexThread(nextCodexSession, threadId, threadId)
            ));
            nextDaemon.handle('host.sendMessage', (params) => {
                const prompt = params && typeof params === 'object' && !Array.isArray(params)
                    ? (params as { prompt?: unknown }).prompt
                    : undefined;
                if (typeof prompt !== 'string' || prompt.length === 0) {
                    throw new Error('prompt must be a non-empty string');
                }
                return sendCodexMessage(nextCodexSession, threadId, {
                    threadId,
                    prompt,
                });
            });
            await nextDaemon.request('host.register', { codexThreadId: threadId });
            return nextDaemon;
        })();
        daemonPromise = connection;
        void connection.catch(() => {
            if (daemonPromise !== connection) {
                return;
            }
            codexSession?.close();
            daemon?.close();
            codexSession = undefined;
            daemon = undefined;
            daemonPromise = undefined;
        });
        return connection;
    };

    const mcp = new JsonLinePeer(process.stdin, process.stdout);
    mcp.handle('initialize', () => ({
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'shuttle', version: '0.1.5' },
    }));
    mcp.handle('notifications/initialized', () => undefined);
    mcp.handle('tools/list', () => ({ tools }));
    mcp.handle('tools/call', async (params) => {
        try {
            return toolResult(await callDaemonTool(
                await getDaemon(getSourceThreadId(params)),
                getToolName(params),
                getArguments(params),
            ));
        } catch (error) {
            return {
                content: [{
                    type: 'text',
                    text: error instanceof Error ? error.message : 'Unknown Shuttle error',
                }],
                isError: true,
            };
        }
    });

    await new Promise<void>((resolve) => mcp.onClose(resolve));
    codexSession?.close();
    daemon?.close();
};
