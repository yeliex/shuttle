import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { JsonLinePeer } from '../src/json-line-peer.js';

test('plugin inherits the Codex Desktop host environment', async () => {
    const config = JSON.parse(await readFile(
        new URL('../../../plugins/shuttle/.mcp.json', import.meta.url),
        'utf8',
    )) as {
        mcpServers: {
            shuttle: { env_vars?: string[] };
        };
    };

    assert.deepEqual(config.mcpServers.shuttle.env_vars, [
        'CODEX_APP_TOOLS_PIPE_PATH',
        'CODEX_MCP_NODE_PATH',
    ]);
});

test('initializes and lists tools before Codex provides task metadata', async () => {
    const environment = { ...process.env };
    delete environment.CODEX_THREAD_ID;
    delete environment.CODEX_SESSION_ID;

    const child = spawn(
        process.execPath,
        ['--import', 'tsx', fileURLToPath(new URL('../src/cli.ts', import.meta.url)), 'mcp'],
        { env: environment },
    );
    const lines = createInterface({ input: child.stdout });
    const responses = lines[Symbol.asyncIterator]();
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
    });

    const request = async (message: object): Promise<Record<string, unknown>> => {
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
        const response = await responses.next();
        assert.equal(response.done, false, stderr);
        return JSON.parse(response.value) as Record<string, unknown>;
    };

    try {
        const initialize = await request({
            id: 1,
            method: 'initialize',
            params: {
                capabilities: {},
                clientInfo: { name: 'shuttle-test', version: '1' },
                protocolVersion: '2025-06-18',
            },
        });
        assert.equal(initialize.jsonrpc, '2.0');
        assert.equal(initialize.id, 1);

        const list = await request({ id: 2, method: 'tools/list', params: {} });
        const tools = (list.result as { tools: Array<{ name: string }> }).tools;
        assert.equal(tools[0]?.name, 'share_thread');
        assert.equal(tools.some((tool) => tool.name === 'accept_invite'), true);

        const call = await request({
            id: 3,
            method: 'tools/call',
            params: { arguments: {}, name: 'list_shared_threads' },
        });
        assert.equal((call.result as { isError: boolean }).isError, true);
        assert.match(
            (call.result as { content: Array<{ text: string }> }).content[0]?.text ?? '',
            /task metadata/u,
        );
    } finally {
        child.stdin.end();
        await once(child, 'exit');
        lines.close();
    }
});

test('reconnects an existing MCP session after the Companion restarts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shuttle-mcp-'));
    const resources = join(directory, 'Codex.app/Contents/Resources');
    const bin = join(resources, 'cua_node/bin');
    const adapter = join(resources, 'plugins/openai-bundled/plugins/codex-app-tools');
    await mkdir(bin, { recursive: true });
    await mkdir(adapter, { recursive: true });
    await symlink(process.execPath, join(bin, 'node'));
    await writeFile(join(adapter, 'server.mjs'), '');
    const hostPipe = join(directory, 'host.sock');
    await writeFile(hostPipe, '');
    const socketPath = join(directory, 'companion.sock');
    const peers = new Set<JsonLinePeer>();
    let registrations = 0;
    const server = createServer((socket) => {
        const peer = new JsonLinePeer(socket, socket);
        peers.add(peer);
        peer.onClose(() => peers.delete(peer));
        peer.handle('host.register', () => { registrations += 1; return {}; });
        peer.handle('shuttle.listSharedThreads', () => ({ registrations }));
        peer.handle('shuttle.acceptInvite', (params) => ({ accepted: params }));
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    const child = spawn(process.execPath, [
        '--import', 'tsx', fileURLToPath(new URL('../src/cli.ts', import.meta.url)), 'mcp',
    ], { env: {
        ...process.env,
        SHUTTLE_SOCKET_PATH: socketPath,
        CODEX_MCP_NODE_PATH: join(bin, 'node'),
        CODEX_APP_TOOLS_PIPE_PATH: hostPipe,
    } });
    const lines = createInterface({ input: child.stdout });
    const responses = lines[Symbol.asyncIterator]();
    const request = async (id: number, name = 'list_shared_threads', args: object = {}) => {
        child.stdin.write(`${JSON.stringify({
            jsonrpc: '2.0', id, method: 'tools/call', params: {
                name, arguments: args, _meta: { threadId: 'test-thread' },
            },
        })}\n`);
        const response = await responses.next();
        assert.equal(response.done, false);
        return JSON.parse(response.value) as {
            result: { isError?: boolean; content: Array<{ text: string }> };
        };
    };
    try {
        assert.equal((await request(1)).result.isError, undefined);
        const acceptance = await request(3, 'accept_invite', { inviteURL: 'https://relay.example/app/invite#test' });
        assert.deepEqual(JSON.parse(acceptance.result.content[0]!.text), {
            accepted: { inviteURL: 'https://relay.example/app/invite#test' },
        });
        for (const peer of peers) { peer.close(); }
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await new Promise<void>((resolve) => server.listen(socketPath, resolve));
        await new Promise((resolve) => setTimeout(resolve, 20));
        const response = await request(2);
        assert.equal(response.result.isError, undefined);
        assert.equal(registrations, 2);
    } finally {
        child.stdin.end();
        await once(child, 'exit');
        lines.close();
        for (const peer of peers) { peer.close(); }
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(directory, { recursive: true, force: true });
    }
});
