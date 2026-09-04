import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

import { WebSocket, WebSocketServer } from 'ws';

const relayURL = (process.env.SHUTTLE_PROBE_RELAY_URL ?? 'http://127.0.0.1:18787').replace(/\/$/u, '');
const previewPort = Number(process.env.SHUTTLE_PROBE_PREVIEW_PORT ?? 19_191);
const previewURL = `http://127.0.0.1:${previewPort}`;
const runtime = process.env.SHUTTLE_PROBE_RUNTIME ?? 'relay';
const suffix = crypto.randomUUID().slice(0, 8);
const password = `Shuttle-${crypto.randomUUID()}-qa`;
const companionDirectory = await mkdtemp(`${tmpdir()}/shuttle-docker-probe-`);
const step = (message) => process.stderr.write(`[relay-probe:${runtime}] ${message}\n`);

const readBody = async (response) => {
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
};

const request = async (path, { body, cookie, deviceToken, expectedStatus, ...init } = {}) => {
    const headers = new Headers(init.headers);
    if (body !== undefined) {
        headers.set('content-type', 'application/json');
    }
    if (cookie) {
        headers.set('cookie', cookie);
    }
    if (deviceToken) {
        headers.set('authorization', `Bearer ${deviceToken}`);
    }
    headers.set('origin', relayURL);
    const response = await fetch(`${relayURL}${path}`, {
        ...init,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers,
    });
    const responseBody = await readBody(response);
    if (expectedStatus !== undefined) {
        assert.equal(
            response.status,
            expectedStatus,
            `${init.method ?? 'GET'} ${path} returned ${response.status}: ${JSON.stringify(responseBody)}`,
        );
        return { body: responseBody, response };
    }
    if (!response.ok) {
        throw new Error(`${init.method ?? 'GET'} ${path} failed with ${response.status}: ${JSON.stringify(responseBody)}`);
    }
    return { body: responseBody, response };
};

const sessionCookie = (response) => {
    const values = response.headers.getSetCookie();
    const cookie = values.find((value) => /^(?:__Secure-)?shuttle\.session_token=/u.test(value));
    assert.ok(cookie, 'Better Auth did not return a Shuttle session cookie');
    return cookie.split(';', 1)[0];
};

const signUp = async (name, email) => {
    const result = await request('/api/auth/sign-up/email', {
        body: { email, name, password },
        method: 'POST',
    });
    return sessionCookie(result.response);
};

const waitFor = async (read, description) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        if (await read()) {
            return;
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error(`Timed out waiting for ${description}`);
};

const openWebSocket = (path, cookie, referer) => new Promise((resolveOpen, rejectOpen) => {
    const url = new URL(path, relayURL);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, ['vite-hmr'], {
        headers: {
            cookie,
            ...(referer ? { referer } : {}),
        },
        origin: relayURL,
    });
    const timeout = setTimeout(() => {
        socket.terminate();
        rejectOpen(new Error(`WebSocket ${path} timed out`));
    }, 5_000);
    socket.once('open', () => {
        clearTimeout(timeout);
        resolveOpen(socket);
    });
    socket.once('error', (error) => {
        clearTimeout(timeout);
        rejectOpen(error);
    });
    socket.once('unexpected-response', (_request, response) => {
        clearTimeout(timeout);
        response.resume();
        rejectOpen(new Error(`WebSocket ${path} returned HTTP ${response.statusCode}`));
    });
});

const nextMessage = (socket) => new Promise((resolveMessage, rejectMessage) => {
    socket.once('message', (data) => resolveMessage(data.toString()));
    socket.once('error', rejectMessage);
});

const nextClose = (socket) => new Promise((resolveClose, rejectClose) => {
    socket.once('close', (code, reason) => resolveClose({ code, reason: reason.toString() }));
    socket.once('error', rejectClose);
});

const previewServer = createServer((incoming, outgoing) => {
    if (incoming.url === '/http') {
        outgoing.setHeader('content-type', 'application/json');
        outgoing.end(JSON.stringify({
            host: incoming.headers.host,
            origin: incoming.headers.origin,
            path: incoming.url,
        }));
        return;
    }
    if (incoming.url === '/sse') {
        outgoing.writeHead(200, {
            'cache-control': 'no-cache',
            'content-type': 'text/event-stream',
        });
        outgoing.write('data: first\n\n');
        setTimeout(() => outgoing.end('data: second\n\n'), 800);
        return;
    }
    outgoing.writeHead(404).end();
});

const previewWebSockets = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => protocols.has('vite-hmr') ? 'vite-hmr' : false,
});
previewServer.on('upgrade', (requestUpgrade, socket, head) => {
    previewWebSockets.handleUpgrade(requestUpgrade, socket, head, (webSocket) => {
        previewWebSockets.emit('connection', webSocket, requestUpgrade);
    });
});
previewWebSockets.on('connection', (socket, requestUpgrade) => {
    socket.on('message', (message) => {
        const text = message.toString();
        if (text === 'close-me') {
            socket.close(4001, 'local-close');
            return;
        }
        socket.send(`${requestUpgrade.url}:${text}`);
    });
});

await new Promise((resolveListen, rejectListen) => {
    previewServer.once('error', rejectListen);
    previewServer.listen(previewPort, '127.0.0.1', resolveListen);
});

let companion;
let hostSocket;
try {
    const ownerCookie = await signUp('Docker QA owner', `qa-owner-${suffix}@example.test`);
    const collaboratorCookie = await signUp('Docker QA collaborator', `qa-collaborator-${suffix}@example.test`);
    const outsiderCookie = await signUp('Docker QA outsider', `qa-outsider-${suffix}@example.test`);
    step('email login');
    const deviceResult = await request('/api/devices', {
        body: { name: 'Docker QA Companion' },
        cookie: ownerCookie,
        method: 'POST',
    });
    const deviceId = deviceResult.body.device.id;
    const deviceToken = deviceResult.body.token;
    assert.equal(typeof deviceId, 'string');
    assert.equal(typeof deviceToken, 'string');

    companion = spawn(process.execPath, [resolve('../companion/dist/cli.mjs'), 'serve'], {
        cwd: resolve('..'),
        env: {
            ...process.env,
            SHUTTLE_DATA_DIR: companionDirectory,
            SHUTTLE_DEVICE_TOKEN: deviceToken,
            SHUTTLE_RELAY_URL: relayURL,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    let companionError = '';
    companion.stderr.setEncoding('utf8');
    companion.stderr.on('data', (chunk) => { companionError += chunk; });
    await waitFor(async () => {
        if (companion.exitCode !== null) {
            throw new Error(`Companion exited early: ${companionError}`);
        }
        const devices = await request('/api/devices', { cookie: ownerCookie });
        return devices.body.devices.some((device) => device.online);
    }, 'the Docker Companion connection');
    step('device connection');

    const codexThreadId = `docker-probe-${suffix}`;
    const deliveredPrompts = [];
    let hostDeliveryCompleted = false;
    hostSocket = connect(resolve(companionDirectory, 'companion.sock'));
    await once(hostSocket, 'connect');
    const hostLines = createInterface({ input: hostSocket, crlfDelay: Infinity });
    const hostRegistration = new Promise((resolveRegistration, rejectRegistration) => {
        const timeout = setTimeout(() => rejectRegistration(new Error('Codex host registration timed out')), 5_000);
        hostLines.on('line', (line) => {
            const message = JSON.parse(line);
            if (message.method === 'host.readThread') {
                hostSocket.write(`${JSON.stringify({
                    id: message.id,
                    result: { turns: [{ role: 'user', text: 'Docker snapshot' }] },
                })}\n`);
                return;
            }
            if (message.method === 'host.sendMessage') {
                deliveredPrompts.push(message.params.prompt);
                setTimeout(() => {
                    hostDeliveryCompleted = true;
                    hostSocket.write(`${JSON.stringify({ id: message.id, result: { sent: true } })}\n`);
                }, 100);
                return;
            }
            if (message.id === 1 && message.result?.registered === true) {
                clearTimeout(timeout);
                resolveRegistration();
            }
        });
        hostSocket.once('error', rejectRegistration);
    });
    hostSocket.write(`${JSON.stringify({
        id: 1,
        method: 'host.register',
        params: { codexThreadId },
    })}\n`);
    await hostRegistration;
    step('Codex host registration');

    const shared = await request('/api/shared-threads', {
        body: { codexThreadId, title: 'Docker probe task' },
        deviceToken,
        method: 'POST',
    });
    const sharedThreadId = shared.body.thread.id;
    await request(`/api/shared-threads/${sharedThreadId}`, {
        cookie: outsiderCookie,
        expectedStatus: 404,
    });
    const threadInvitation = await request(`/api/shared-threads/${sharedThreadId}/invites`, {
        body: {
            canPreview: true,
            emails: [`qa-collaborator-${suffix}@example.test`],
            expiresInHours: 24,
            permission: 'message',
            singleUse: false,
        },
        deviceToken,
        method: 'POST',
    });
    const invitationAccess = await request('/api/invites/inspect', {
        body: { token: threadInvitation.body.token },
        cookie: collaboratorCookie,
        method: 'POST',
    });
    assert.equal(invitationAccess.body.invite.hasAccess, true);
    const read = await request(`/api/shared-threads/${sharedThreadId}`, {
        cookie: collaboratorCookie,
    });
    assert.deepEqual(read.body.thread.content, {
        turns: [{ role: 'user', text: 'Docker snapshot' }],
    });
    step('task sharing and live read');

    const prompt = `Review the Shuttle probe ${suffix}`;
    const delivered = await request(`/api/shared-threads/${sharedThreadId}/messages`, {
        body: { prompt },
        cookie: collaboratorCookie,
        method: 'POST',
    });
    assert.equal(delivered.body.delivered, true);
    assert.equal(hostDeliveryCompleted, true);
    assert.deepEqual(deliveredPrompts, [prompt]);
    step('synchronous Codex message delivery');

    const preview = await request('/api/preview-services', {
        body: {
            localURL: previewURL,
            name: 'Docker probe preview',
            sharedThreadId,
        },
        deviceToken,
        method: 'POST',
    });
    const previewServiceId = preview.body.service.id;
    const collaboratorThreads = await request('/api/shared-threads', {
        cookie: collaboratorCookie,
    });
    const collaboratorThread = collaboratorThreads.body.threads.find(
        (thread) => thread.id === sharedThreadId,
    );
    assert.equal(collaboratorThread.device, undefined);
    assert.equal(collaboratorThread.deviceId, undefined);
    assert.deepEqual(
        collaboratorThread.previewServices.map((service) => service.id),
        [previewServiceId],
    );
    const collaboratorServices = await request('/api/preview-services', {
        cookie: collaboratorCookie,
    });
    assert.equal(
        collaboratorServices.body.services.find((service) => service.id === previewServiceId).device,
        undefined,
    );
    await request(`/api/preview-services/${previewServiceId}/session`, {
        cookie: outsiderCookie,
        expectedStatus: 404,
        method: 'POST',
    });
    const previewSession = await request(`/api/preview-services/${previewServiceId}/session`, {
        cookie: collaboratorCookie,
        method: 'POST',
    });
    const previewCookie = previewSession.response.headers.getSetCookie()
        .find((value) => value.startsWith('shuttle_preview='))
        ?.split(';', 1)[0];
    assert.ok(previewCookie, 'Relay did not return a preview session cookie');
    const browserCookies = `${collaboratorCookie}; ${previewCookie}`;
    step('task-scoped preview access and session');

    const http = await fetch(`${relayURL}/preview/${previewServiceId}/http`, {
        headers: {
            cookie: browserCookies,
            origin: relayURL,
        },
    });
    assert.equal(http.status, 200, await http.clone().text());
    assert.deepEqual(await http.json(), {
        host: `127.0.0.1:${previewPort}`,
        origin: previewURL,
        path: '/http',
    });
    step('HTTP preview');

    const sseStartedAt = performance.now();
    const sse = await fetch(`${relayURL}/preview/${previewServiceId}/sse`, {
        headers: { cookie: browserCookies },
    });
    assert.equal(sse.headers.get('content-type'), 'text/event-stream');
    const sseReader = sse.body.getReader();
    const firstEvent = await sseReader.read();
    assert.equal(new TextDecoder().decode(firstEvent.value), 'data: first\n\n');
    assert.ok(performance.now() - sseStartedAt < 600, 'SSE first event was buffered');
    const secondEvent = await sseReader.read();
    assert.equal(new TextDecoder().decode(secondEvent.value), 'data: second\n\n');
    step('SSE preview');

    const explicitSocket = await openWebSocket(`/preview/${previewServiceId}/ws`, browserCookies);
    assert.equal(explicitSocket.protocol, 'vite-hmr');
    explicitSocket.send('hello');
    assert.equal(await nextMessage(explicitSocket), '/ws:hello');
    const explicitClose = nextClose(explicitSocket);
    explicitSocket.send('close-me');
    assert.deepEqual(await explicitClose, { code: 4001, reason: 'local-close' });
    step('WebSocket preview');

    const rootSocket = await openWebSocket(
        '/hmr',
        browserCookies,
        `${relayURL}/preview/${previewServiceId}/`,
    );
    assert.equal(rootSocket.protocol, 'vite-hmr');
    rootSocket.send('update');
    assert.equal(await nextMessage(rootSocket), '/hmr:update');
    rootSocket.close(1000, 'probe-complete');
    step('root HMR WebSocket');

    const revokedSocket = await openWebSocket(
        `/preview/${previewServiceId}/revoked`,
        browserCookies,
    );
    const revokedClose = nextClose(revokedSocket);
    const ownerThread = await request(`/api/shared-threads/${sharedThreadId}?includeContent=false`, {
        cookie: ownerCookie,
    });
    const collaboratorGrant = ownerThread.body.thread.grants.find(
        (grant) => grant.user.email === `qa-collaborator-${suffix}@example.test`,
    );
    assert.ok(collaboratorGrant, 'Owner could not resolve the collaborator task grant');
    await request(`/api/shared-threads/${sharedThreadId}/grants/${collaboratorGrant.user.id}`, {
        body: { canPreview: false, permission: 'message' },
        cookie: ownerCookie,
        method: 'PUT',
    });
    assert.deepEqual(await revokedClose, {
        code: 4003,
        reason: 'Preview access was revoked',
    });
    const revokedHTTP = await fetch(`${relayURL}/preview/${previewServiceId}/http`, {
        headers: { cookie: browserCookies },
    });
    assert.equal(revokedHTTP.status, 401);
    await request(`/api/shared-threads/${sharedThreadId}?includeContent=false`, {
        cookie: collaboratorCookie,
    });
    step('per-collaborator preview permission revocation');

    await request(`/api/shared-threads/${sharedThreadId}/grants/${collaboratorGrant.user.id}`, {
        cookie: ownerCookie,
        method: 'DELETE',
    });
    await request(`/api/shared-threads/${sharedThreadId}`, {
        cookie: collaboratorCookie,
        expectedStatus: 404,
    });
    await request(`/api/shared-threads/${sharedThreadId}/messages`, {
        body: { prompt: 'Revoked collaborators must not send messages' },
        cookie: collaboratorCookie,
        expectedStatus: 404,
        method: 'POST',
    });
    step('task ACL denial and revocation');

    hostSocket.end();
    hostSocket = undefined;
    companion.stdin.write(`${JSON.stringify({ id: 'probe-offline', method: 'shutdown' })}\n`);
    await waitFor(async () => {
        const devices = await request('/api/devices', { cookie: ownerCookie });
        return devices.body.devices.every((device) => !device.online);
    }, 'the Companion to disconnect');
    await request(`/api/shared-threads/${sharedThreadId}`, {
        cookie: ownerCookie,
        expectedStatus: 503,
    });
    await request(`/api/shared-threads/${sharedThreadId}/messages`, {
        body: { prompt: 'This must not be queued' },
        cookie: ownerCookie,
        expectedStatus: 503,
        method: 'POST',
    });
    step('offline live read and message rejection');

    await request(`/api/devices/${deviceId}`, {
        cookie: ownerCookie,
        method: 'DELETE',
    });
    const revokedDevices = await request('/api/devices', { cookie: ownerCookie });
    const revokedDevice = revokedDevices.body.devices.find((device) => device.id === deviceId);
    assert.ok(revokedDevice?.revokedAt, 'The Relay did not mark the device as revoked');
    assert.equal(revokedDevice.online, false);
    await request(`/api/shared-threads/${sharedThreadId}/messages`, {
        body: { prompt: 'Revoked devices must hide their tasks' },
        cookie: ownerCookie,
        expectedStatus: 404,
        method: 'POST',
    });
    step('device revocation');

    process.stdout.write(`${JSON.stringify({
        checks: [
            'login',
            'device',
            'task',
            'live-read',
            'task-acl',
            'message',
            'offline-message',
            'offline-read',
            'device-revocation',
            'http',
            'sse',
            'websocket',
            'hmr',
            'preview-acl',
        ],
        runtime,
        status: 'ok',
    })}\n`);
} finally {
    hostSocket?.destroy();
    if (companion && companion.exitCode === null) {
        companion.stdin.write(`${JSON.stringify({ id: 'probe-stop', method: 'shutdown' })}\n`);
        await Promise.race([
            new Promise((resolveExit) => companion.once('exit', resolveExit)),
            new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
        ]);
        if (companion.exitCode === null) {
            companion.kill();
        }
    }
    for (const client of previewWebSockets.clients) {
        client.terminate();
    }
    previewWebSockets.close();
    await new Promise((resolveClose) => previewServer.close(resolveClose));
    await rm(companionDirectory, { force: true, recursive: true });
}
