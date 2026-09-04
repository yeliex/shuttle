import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, lstat, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { listenOnCompanionSocket } from '../src/daemon.js';
import { JsonLinePeer } from '../src/json-line-peer.js';

test('sharing waits for an explicit retry after failure and can be cancelled', { timeout: 15_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shuttle-retry-'));
    const socketPath = join(directory, 's');
    let attempts = 0;
    let fail = true;
    const relay = createHttpServer((request, response) => {
        request.resume();
        response.setHeader('content-type', 'application/json');
        if (request.url === '/api/shared-threads') {
            response.end(JSON.stringify({ thread: { id: 'shared-test' } }));
        } else if (request.url === '/api/shared-threads/shared-test/invites') {
            attempts += 1;
            response.statusCode = fail ? 503 : 200;
            response.end(JSON.stringify(fail ? { error: '测试发送失败' } : {
                inviteURL: 'https://shuttle.example/app/invite#test',
            }));
        } else {
            response.statusCode = 404;
            response.end('{}');
        }
    });
    relay.listen(0, '127.0.0.1');
    await once(relay, 'listening');
    const address = relay.address();
    assert.ok(address && typeof address !== 'string');
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../src/cli.ts', import.meta.url)), 'serve'], {
        env: { ...process.env, SHUTTLE_SOCKET_PATH: socketPath, SHUTTLE_RELAY_URL: `http://127.0.0.1:${address.port}`, SHUTTLE_DEVICE_TOKEN: 'test-device' },
    });
    const lines = createInterface({ input: child.stdout });
    const events = lines[Symbol.asyncIterator]();
    const nextEvent = async () => {
        const event = await events.next();
        assert.equal(event.done, false);
        return JSON.parse(event.value) as { type: string; id: string; error?: string; sharedThreadId?: string };
    };
    const respond = (id: string, approved = true) => child.stdin.write(`${JSON.stringify({
        method: 'authorization.respond', id,
        result: { approved, emails: ['alex@example.com'], permission: 'read', canPreview: false, expiresInHours: 24, singleUse: false },
    })}\n`);
    let peer: JsonLinePeer | undefined;
    try {
        assert.equal((await nextEvent()).type, 'ready');
        const socket = connect(socketPath);
        await once(socket, 'connect');
        peer = new JsonLinePeer(socket, socket);
        await peer.request('host.register', { codexThreadId: 'test-task' });
        const share = peer.request('shuttle.shareThread', { title: 'Test sharing' });
        const authorization = await nextEvent();
        assert.equal(authorization.type, 'authorization-request');
        respond(authorization.id);
        const failure = await nextEvent();
        assert.equal(failure.id, authorization.id);
        assert.equal(failure.error, '测试发送失败');
        assert.equal(attempts, 1);
        fail = false;
        respond(authorization.id);
        const success = await nextEvent();
        assert.equal(success.type, 'authorization-result');
        assert.equal(success.id, authorization.id);
        assert.equal(success.sharedThreadId, 'shared-test');
        assert.equal(attempts, 2);
        await share;

        fail = true;
        const cancelled = assert.rejects(peer.request('shuttle.shareThread', { title: 'Cancel retry' }), /cancelled/u);
        const second = await nextEvent();
        respond(second.id);
        assert.equal((await nextEvent()).error, '测试发送失败');
        respond(second.id, false);
        await cancelled;
        assert.equal(attempts, 3);
    } finally {
        peer?.close();
        const exited = once(child, 'exit');
        child.kill();
        await exited;
        lines.close();
        relay.closeAllConnections();
        await new Promise<void>((resolve) => relay.close(() => resolve()));
        await rm(directory, { recursive: true, force: true });
    }
});

test('a second Companion cannot remove a live socket', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shuttle-socket-'));
    const path = join(directory, 's');
    const owner = createServer((socket) => socket.end());
    const duplicate = createServer();
    try {
        await listenOnCompanionSocket(owner, path);
        const original = await lstat(path);
        await assert.rejects(listenOnCompanionSocket(duplicate, path), /already running/u);
        assert.equal((await lstat(path)).ino, original.ino);
        const client = connect(path);
        await once(client, 'connect');
        client.destroy();
    } finally {
        await new Promise<void>((resolve) => owner.close(() => resolve()));
        await rm(directory, { recursive: true, force: true });
    }
});

test('reclaims a socket left by a crashed process', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shuttle-socket-'));
    const path = join(directory, 's');
    const child = spawn(process.execPath, ['-e',
        'require("node:net").createServer().listen(process.argv[1], () => console.log("ready"))', path]);
    const server = createServer();
    try {
        await once(child.stdout, 'data');
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        await exited;
        await listenOnCompanionSocket(server, path);
        assert.equal(server.listening, true);
    } finally {
        child.kill();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(directory, { recursive: true, force: true });
    }
});

test('never removes a regular file at the socket path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shuttle-socket-'));
    const path = join(directory, 's');
    try {
        await writeFile(path, 'keep');
        await assert.rejects(listenOnCompanionSocket(createServer(), path), /non-socket/u);
        assert.equal((await lstat(path)).isFile(), true);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
