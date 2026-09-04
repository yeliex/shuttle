import { strict as assert } from 'node:assert';
import { once } from 'node:events';
import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { createMcpHttpServer, getMcpAuthorization } from '../src/mcp-http.js';
import { JsonLinePeer } from '../src/json-line-peer.js';

test('本地认证凭据跨重启保留，拒绝不安全的已有文件', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shuttle-mcp-auth-'));
    const original = process.env.SHUTTLE_DATA_DIR;
    process.env.SHUTTLE_DATA_DIR = directory;
    try {
        const first = await getMcpAuthorization();
        assert.match(first, /^Bearer [A-Za-z0-9_-]{43}$/u);
        assert.equal(await getMcpAuthorization(), first);
        const path = join(directory, 'mcp-headers.json');
        assert.equal((await stat(path)).mode & 0o777, 0o600);
        const content = await readFile(path, 'utf8');
        await chmod(path, 0o644);
        await assert.rejects(getMcpAuthorization(), /owner-only/u);
        assert.equal(await readFile(path, 'utf8'), content);
    } finally {
        if (original === undefined) delete process.env.SHUTTLE_DATA_DIR;
        else process.env.SHUTTLE_DATA_DIR = original;
        await rm(directory, { recursive: true, force: true });
    }
});

test('HTTP MCP 校验来源与任务身份，断线后重连且不重放消息', { timeout: 20_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shuttle-http-'));
    const original = process.env.SHUTTLE_SOCKET_PATH;
    const socketPath = join(directory, 'companion.sock');
    process.env.SHUTTLE_SOCKET_PATH = socketPath;

    const registrations: string[] = [];
    let deliveries = 0;
    const peers = new Set<JsonLinePeer>();
    const daemon = createServer((socket) => {
        const peer = new JsonLinePeer(socket, socket);
        peers.add(peer);
        peer.onClose(() => peers.delete(peer));
        let registered: string | undefined;
        peer.handle('host.register', (params) => {
            registered = (params as { codexThreadId: string }).codexThreadId;
            registrations.push(registered);
            return { registered: true };
        });
        peer.handle('shuttle.listSharedThreads', () => ({ source: registered }));
        peer.handle('shuttle.sendSharedMessage', () => {
            deliveries++;
            throw new Error('测试消息发送失败');
        });
    });
    daemon.listen(socketPath);
    await once(daemon, 'listening');
    const authorization = 'Bearer local-test-token';
    let http = createMcpHttpServer(authorization);
    http.listen(0, '127.0.0.1');
    await once(http, 'listening');
    const address = http.address();
    assert.ok(address && typeof address !== 'string');
    const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
    const headers = { Authorization: authorization };
    const client = new Client({ name: 'shuttle-test', version: '1' });
    try {
        assert.equal((await fetch(url, { method: 'POST' })).status, 401);
        assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: authorization, Origin: 'https://example.com' } })).status, 403);
        // fetch 会规范化 Host，使用原始 HTTP 请求验证 DNS rebinding 防护。
        const invalidHostStatus = await new Promise<number | undefined>((resolve, reject) => {
            const outgoing = request(url, { method: 'POST', headers: { Authorization: authorization, Host: 'evil.example' } }, (response) => {
                response.resume();
                resolve(response.statusCode);
            });
            outgoing.on('error', reject);
            outgoing.end();
        });
        assert.equal(invalidHostStatus, 403);
        assert.equal((await fetch(url, { headers })).status, 405);
        await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
        const inventory = await client.listTools();
        assert.equal(inventory.tools.length, 8);
        await assert.rejects(client.callTool({ name: 'list_shared_threads', arguments: {} }), /task metadata/u);
        await assert.rejects(client.callTool({ name: 'read_shared_thread', arguments: {}, _meta: { threadId: 'one' } }), /Invalid Shuttle tool arguments/u);
        await assert.rejects(client.callTool({ name: 'unknown', arguments: {}, _meta: { threadId: 'one' } }), /Unknown Shuttle tool/u);
        assert.deepEqual(registrations, []);

        const one = await client.callTool({ name: 'list_shared_threads', arguments: {}, _meta: { threadId: 'one' } });
        const two = await client.callTool({ name: 'list_shared_threads', arguments: {}, _meta: { threadId: 'two' } });
        assert.deepEqual(one.content, [{ type: 'text', text: JSON.stringify({ source: 'one' }, null, 2) }]);
        assert.deepEqual(two.content, [{ type: 'text', text: JSON.stringify({ source: 'two' }, null, 2) }]);
        assert.deepEqual(registrations, ['one', 'two']);
        const failure = await client.callTool({ name: 'send_shared_message', arguments: { sharedThreadId: 'test', prompt: 'test' }, _meta: { threadId: 'one' } });
        assert.equal(failure.isError, true);
        assert.equal(deliveries, 1);

        http.closeAllConnections();
        await new Promise<void>((resolve) => http.close(() => resolve()));
        await assert.rejects(client.callTool({ name: 'list_shared_threads', arguments: {}, _meta: { threadId: 'one' } }));
        http = createMcpHttpServer(authorization);
        http.listen(address.port, '127.0.0.1');
        await once(http, 'listening');
        const restored = await client.callTool({ name: 'list_shared_threads', arguments: {}, _meta: { threadId: 'one' } });
        assert.deepEqual(restored.content, one.content);
        assert.deepEqual(registrations, ['one', 'two', 'one']);
        assert.equal(deliveries, 1);
    } finally {
        await client.close();
        http.closeAllConnections();
        await new Promise<void>((resolve) => http.close(() => resolve()));
        for (const peer of peers) peer.close();
        await new Promise<void>((resolve) => daemon.close(() => resolve()));
        if (original === undefined) delete process.env.SHUTTLE_SOCKET_PATH;
        else process.env.SHUTTLE_SOCKET_PATH = original;
        await rm(directory, { recursive: true, force: true });
    }
});
