import { strict as assert } from 'node:assert';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
    CodexAppToolsSession,
    discoverCodexHost,
    readCompleteCodexThread,
    type CodexHost,
} from '../src/codex-host.js';

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async (): Promise<string> => {
    const directory = await mkdtemp(join(tmpdir(), 'shuttle-companion-'));
    temporaryDirectories.push(directory);
    return directory;
};

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => (
        rm(directory, { recursive: true, force: true })
    )));
});

test('discovers the bundled adapter and the pipe provided by Codex', async () => {
    const root = await createTemporaryDirectory();
    const resources = join(root, 'Codex.app', 'Contents', 'Resources');
    const nodePath = join(resources, 'cua_node', 'bin', 'node');
    const serverPath = join(
        resources,
        'plugins',
        'openai-bundled',
        'plugins',
        'codex-app-tools',
        'server.mjs',
    );
    const pipePath = join(root, 'codex.sock');

    await mkdir(dirname(nodePath), { recursive: true });
    await mkdir(dirname(serverPath), { recursive: true });
    await writeFile(nodePath, '');
    await chmod(nodePath, 0o700);
    await writeFile(serverPath, '');
    await writeFile(pipePath, '');

    const host = await discoverCodexHost({
        CODEX_APP_TOOLS_PIPE_PATH: pipePath,
        CODEX_MCP_NODE_PATH: nodePath,
    });

    assert.deepEqual(host, { nodePath, serverPath, pipePath });
});

test('keeps one MCP session alive across tool calls', async () => {
    const root = await createTemporaryDirectory();
    const serverPath = join(root, 'server.mjs');
    const mockServer = `
        import { createInterface } from 'node:readline';
        const interactionIndex = process.argv.indexOf('--interaction-client-id');
        const interactionClientId = process.argv[interactionIndex + 1];
        const input = createInterface({ input: process.stdin });
        const write = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
        input.on('line', (line) => {
            const request = JSON.parse(line);
            if (request.id === 1) {
                write({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } });
            } else if (request.id >= 2) {
                write({
                    jsonrpc: '2.0',
                    id: request.id,
                    result: {
                        structuredContent: {
                            name: request.params.name,
                            arguments: request.params.arguments,
                            interactionClientId,
                            sourceThreadId: request.params._meta['openai/threadId'],
                        },
                    },
                });
            }
        });
    `;
    await writeFile(serverPath, mockServer);

    const host: CodexHost = {
        nodePath: process.execPath,
        serverPath,
        pipePath: join(root, 'unused.sock'),
    };
    const session = new CodexAppToolsSession(host);

    const firstResult = await session.callTool(
        'source-thread',
        'read_thread',
        { threadId: 'target-thread' },
    );
    const secondResult = await session.callTool(
        'source-thread',
        'send_message_to_thread',
        { threadId: 'target-thread', prompt: 'hello' },
    );
    session.close();

    assert.deepEqual(firstResult, {
        structuredContent: {
            name: 'read_thread',
            arguments: { threadId: 'target-thread' },
            interactionClientId: 'source-thread',
            sourceThreadId: 'source-thread',
        },
    });
    assert.deepEqual(secondResult, {
        structuredContent: {
            name: 'send_message_to_thread',
            arguments: { threadId: 'target-thread', prompt: 'hello' },
            interactionClientId: 'source-thread',
            sourceThreadId: 'source-thread',
        },
    });
    await assert.rejects(
        session.callTool('another-source-thread', 'read_thread', { threadId: 'target-thread' }),
        /only one Codex source task/u,
    );
});

test('reads every Codex thread page until the cursor is exhausted', async () => {
    const root = await createTemporaryDirectory();
    const serverPath = join(root, 'server.mjs');
    const mockServer = `
        import { createInterface } from 'node:readline';
        const input = createInterface({ input: process.stdin });
        const write = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
        input.on('line', (line) => {
            const request = JSON.parse(line);
            if (request.method === 'initialize') {
                write({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2025-06-18' } });
            } else if (request.method === 'tools/call') {
                const arguments_ = request.params.arguments;
                if ('maxOutputCharsPerItem' in arguments_ || arguments_.turnLimit !== 10) {
                    write({
                        jsonrpc: '2.0',
                        id: request.id,
                        error: { code: -32602, message: 'read_thread limits exceeded' },
                    });
                    return;
                }
                const cursor = arguments_.cursor;
                const page = cursor
                    ? { page: { hasMore: false }, turns: [{ id: 'older' }] }
                    : { page: { hasMore: true, nextCursor: 'page-2' }, turns: [{ id: 'newer' }] };
                write({
                    jsonrpc: '2.0',
                    id: request.id,
                    result: { content: [{ type: 'text', text: JSON.stringify(page) }] },
                });
            }
        });
    `;
    await writeFile(serverPath, mockServer);
    const session = new CodexAppToolsSession({
        nodePath: process.execPath,
        serverPath,
        pipePath: join(root, 'unused.sock'),
    });

    const result = await readCompleteCodexThread(session, 'source-thread', 'target-thread');
    session.close();

    assert.deepEqual(result, {
        pages: [
            { page: { hasMore: true, nextCursor: 'page-2' }, turns: [{ id: 'newer' }] },
            { page: { hasMore: false }, turns: [{ id: 'older' }] },
        ],
        schemaVersion: 1,
    });
});
