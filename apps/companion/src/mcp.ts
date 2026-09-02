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
    const sourceThreadId = process.env.CODEX_THREAD_ID ?? process.env.CODEX_SESSION_ID;
    if (!sourceThreadId) {
        throw new Error('CODEX_THREAD_ID or CODEX_SESSION_ID is required');
    }

    const socket = connect(getCompanionSocketPath());
    await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
    });
    const daemon = new JsonLinePeer(socket, socket, 5 * 60_000);
    const codexSession = new CodexAppToolsSession(await discoverCodexHost());
    daemon.handle('host.readThread', () => (
        readCompleteCodexThread(codexSession, sourceThreadId, sourceThreadId)
    ));
    daemon.handle('host.sendMessage', (params) => {
        const prompt = params && typeof params === 'object' && !Array.isArray(params)
            ? (params as { prompt?: unknown }).prompt
            : undefined;
        if (typeof prompt !== 'string' || prompt.length === 0) {
            throw new Error('prompt must be a non-empty string');
        }
        return sendCodexMessage(codexSession, sourceThreadId, {
            threadId: sourceThreadId,
            prompt,
        });
    });
    await daemon.request('host.register', { codexThreadId: sourceThreadId });

    const mcp = new JsonLinePeer(process.stdin, process.stdout);
    mcp.handle('initialize', () => ({
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'shuttle', version: '0.1.0' },
    }));
    mcp.handle('notifications/initialized', () => undefined);
    mcp.handle('tools/list', () => ({ tools }));
    mcp.handle('tools/call', async (params) => {
        try {
            return toolResult(await callDaemonTool(
                daemon,
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
    codexSession.close();
    daemon.close();
};
