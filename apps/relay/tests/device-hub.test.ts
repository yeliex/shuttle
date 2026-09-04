import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { WSContext } from 'hono/ws';

import { DeviceHub } from '../src/device-hub.js';

test('resolves delivery only after the online Companion responds', async () => {
    const hub = new DeviceHub();
    const sent: string[] = [];
    const socket = new WSContext({
        close: () => undefined,
        readyState: 1,
        send: (value) => sent.push(String(value)),
    });
    hub.connect('device-1', socket);

    const delivery = hub.deliver('device-1', 'codex-1', 'hello');
    assert.equal(sent.length, 1);
    const request = JSON.parse(sent[0]!) as { id: string };
    hub.handleMessage('device-1', JSON.stringify({ id: request.id, result: { sent: true } }));

    await delivery;
});

test('rejects instead of storing a message when the owner is offline', async () => {
    const hub = new DeviceHub();
    await assert.rejects(
        hub.deliver('offline-device', 'codex-1', 'hello'),
        /owner is offline/,
    );
});

test('ignores a delayed close event from a replaced device connection', async () => {
    const hub = new DeviceHub();
    const oldSocket = new WSContext({
        close: () => undefined,
        readyState: 1,
        send: () => undefined,
    });
    const sent: string[] = [];
    const newSocket = new WSContext({
        close: () => undefined,
        readyState: 1,
        send: (value) => sent.push(String(value)),
    });
    hub.connect('device-1', oldSocket);
    hub.connect('device-1', newSocket);
    hub.disconnect('device-1', oldSocket);

    const delivery = hub.deliver('device-1', 'codex-1', 'hello');
    const request = JSON.parse(sent[0]!) as { id: string };
    hub.handleMessage('device-1', JSON.stringify({ id: request.id, result: { sent: true } }));

    await delivery;
});

test('streams preview response chunks from the online Companion', async () => {
    const hub = new DeviceHub();
    const sent: string[] = [];
    const socket = new WSContext({
        close: () => undefined,
        readyState: 1,
        send: (value) => sent.push(String(value)),
    });
    hub.connect('device-1', socket);

    const responsePromise = hub.proxyPreviewRequest(
        'device-1',
        'preview-1',
        'http://localhost:5173/events',
        { headers: [], method: 'GET' },
    );
    const request = JSON.parse(sent[0]!) as { id: string };
    hub.handleMessage('device-1', JSON.stringify({
        event: 'previewHttpHead',
        headers: [['content-type', 'text/event-stream']],
        id: request.id,
        status: 200,
    }));
    const response = await responsePromise;
    const content = response.text();
    hub.handleMessage('device-1', JSON.stringify({
        data: btoa('data: ready\n\n'),
        event: 'previewHttpData',
        id: request.id,
    }));
    hub.handleMessage('device-1', JSON.stringify({
        event: 'previewHttpEnd',
        id: request.id,
    }));

    assert.equal(response.status, 200);
    assert.equal(await content, 'data: ready\n\n');
});

test('closes active preview sockets when preview access is revoked', () => {
    const hub = new DeviceHub();
    const deviceMessages: string[] = [];
    const device = new WSContext({
        close: () => undefined,
        readyState: 1,
        send: (value) => deviceMessages.push(String(value)),
    });
    const browserCloses: Array<[number | undefined, string | undefined]> = [];
    const browser = new WSContext({
        close: (code, reason) => browserCloses.push([code, reason]),
        readyState: 1,
        send: () => undefined,
    });
    hub.connect('device-1', device);
    hub.openPreviewWebSocket(
        'device-1',
        'preview-1',
        'ws://localhost:5173/',
        [],
        [],
        browser,
    );

    hub.closePreviewConnections('device-1', 'preview-1');

    assert.deepEqual(browserCloses, [[4003, 'Preview access was revoked']]);
    assert.match(deviceMessages.at(-1) ?? '', /previewWebSocketClose/u);
});

test('forwards a WebSocket close without an invalid reserved status code', () => {
    const hub = new DeviceHub();
    const device = new WSContext({
        close: () => undefined,
        readyState: 1,
        send: () => undefined,
    });
    const browserCloses: Array<[number | undefined, string | undefined]> = [];
    const browser = new WSContext({
        close: (code, reason) => browserCloses.push([code, reason]),
        readyState: 1,
        send: () => undefined,
    });
    hub.connect('device-1', device);
    const previewId = hub.openPreviewWebSocket(
        'device-1',
        'preview-1',
        'ws://localhost:5173/',
        [],
        [],
        browser,
    );

    hub.handleMessage('device-1', JSON.stringify({
        code: 1005,
        event: 'previewWebSocketClose',
        id: previewId,
        reason: '',
    }));

    assert.deepEqual(browserCloses, [[undefined, undefined]]);
});

test('disconnects an online Companion when its device is revoked', () => {
    const hub = new DeviceHub();
    const closes: Array<[number | undefined, string | undefined]> = [];
    const device = new WSContext({
        close: (code, reason) => closes.push([code, reason]),
        readyState: 1,
        send: () => undefined,
    });
    hub.connect('device-1', device);

    hub.disconnectDevice('device-1');

    assert.equal(hub.isConnected('device-1'), false);
    assert.deepEqual(closes, [[1008, 'This Shuttle device was revoked']]);
});

test('blocks both directions of an existing preview WebSocket after authorization expires', async (context) => {
    context.mock.timers.enable({ apis: ['Date'], now: 1_000 });
    for (const direction of ['browser', 'device']) {
        const hub = new DeviceHub();
        const deviceMessages: string[] = [];
        const browserMessages: string[] = [];
        const browserCloses: Array<[number | undefined, string | undefined]> = [];
        hub.connect('device-1', new WSContext({
            close: () => undefined,
            readyState: 1,
            send: (value) => deviceMessages.push(String(value)),
        }));
        const id = hub.openPreviewWebSocket('device-1', 'preview-1', 'ws://localhost:5173/', [], [], new WSContext({
            close: (code, reason) => browserCloses.push([code, reason]),
            readyState: 1,
            send: (value) => browserMessages.push(String(value)),
        }), 2_000);
        await hub.forwardPreviewWebSocketData(id, 'before expiry');
        assert.match(deviceMessages.at(-1)!, /before expiry/u);

        context.mock.timers.setTime(2_000);
        if (direction === 'browser') {
            await hub.forwardPreviewWebSocketData(id, 'after expiry');
        } else {
            hub.handleMessage('device-1', JSON.stringify({
                event: 'previewWebSocketData', id, data: 'after expiry', binary: false,
            }));
        }
        assert.deepEqual(browserMessages, []);
        assert.deepEqual(browserCloses, [[4003, 'Share authorization expired']]);
        assert.equal(deviceMessages.some((message) => message.includes('after expiry')), false);
        context.mock.timers.setTime(1_000);
    }
});
