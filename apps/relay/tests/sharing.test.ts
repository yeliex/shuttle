import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { Hono } from 'hono';

import { createAuth } from '../src/auth.js';
import { createRelay } from '../src/app.js';
import { hashSecret } from '../src/request.js';
import { createNodeDatabase } from '../src/database-node.js';
import { threads, invites } from '../src/routes/threads.js';
import { getPreviewAccess, previewServices } from '../src/routes/preview-services.js';
import { proxyPreviewRequest } from '../src/preview-proxy.js';
import type { OutboundEmail } from '../src/mail.js';
import type { RelayHonoEnvironment, RelayRuntime } from '../src/runtime.js';

test('unified sharing: email access, expiry, multiple recipients and single-use claims', async (context) => {
    const directory = await mkdtemp(resolve(tmpdir(), 'shuttle-sharing-'));
    const path = resolve(directory, 'test.db');
    const sqlite = new DatabaseSync(path);
    for (const name of (await readdir('prisma/migrations')).filter((name) => /^\d/u.test(name)).sort()) {
        sqlite.exec(await readFile(resolve('prisma/migrations', name, 'migration.sql'), 'utf8'));
    }
    sqlite.close();
    const database = createNodeDatabase(`file:${path}`);
    const outbox: OutboundEmail[] = [];
    const hostCalls: { operation: string; deviceId: string; threadId: string }[] = [];
    const secret = 'test-sharing-secret-with-at-least-32-characters';
    const runtime: RelayRuntime = {
        adminEmails: [], allowedDomains: [], authProviders: [], openRegistration: true,
        auth: createAuth(database, { baseURL: 'http://localhost', secret, providers: [], allowedDomains: [], openRegistration: true }),
        baseURL: 'http://localhost', database, previewTokenSecret: secret,
        readThread: async (deviceId, threadId) => {
            hostCalls.push({ operation: 'read', deviceId, threadId });
            return { turns: [] };
        },
        deliverMessage: async (deviceId, threadId) => { hostCalls.push({ operation: 'queue', deviceId, threadId }); },
        sendEmail: async (email) => { outbox.push(email); },
    };
    const app = new Hono<RelayHonoEnvironment>();
    app.use('*', async (context, next) => {
        const userId = context.req.header('x-test-user') ?? 'owner';
        context.set('runtime', runtime);
        context.set('principal', userId === 'owner'
            ? { kind: 'device', userId, deviceId: 'device' } : { kind: 'session', userId });
        await next();
    });
    app.route('/threads', threads);
    app.route('/invites', invites);
    app.route('/services', previewServices);
    app.get('/preview/:previewServiceId/*', proxyPreviewRequest);
    const authenticatedApp = createRelay(() => runtime);
    const acceptFromCompanion = (token: string, deviceToken = 'test-alex-device') => authenticatedApp.request('/api/invites/accept', {
        method: 'POST', headers: { authorization: `Bearer ${deviceToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
    });
    const request = (path: string, user = 'owner', method = 'GET', body?: object) => app.request(path, {
        method, headers: { 'content-type': 'application/json', 'x-test-user': user },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    try {
        for (const id of ['owner', 'alex', 'maya', 'other', 'pending']) {
            await database.user.create({ data: { id, name: id, email: `${id}@example.com`, emailVerified: id !== 'pending' } });
        }
        await database.device.create({ data: { id: 'device', userId: 'owner', name: 'Test Mac', tokenHash: 'test-only' } });
        await database.device.create({ data: { id: 'alex-device', userId: 'alex', name: 'Alex Mac', tokenHash: await hashSecret('test-alex-device') } });
        await database.device.create({ data: { id: 'other-device', userId: 'other', name: 'Other Mac', tokenHash: await hashSecret('test-other-device') } });
        const created = await request('/threads', 'owner', 'POST', { codexThreadId: 'local-task', title: 'Test share' });
        assert.equal(created.status, 201);
        const { thread } = await created.json() as { thread: { id: string } };
        const id = thread.id;
        assert.equal((await request(`/threads/${id}/invites`, 'owner', 'POST', {
            emails: [], singleUse: false, permission: 'read', canPreview: false,
        })).status, 400);
        const configure = (emails: string[], expiresInHours: number | null = 24, singleUse = false) => request(`/threads/${id}/invites`, 'owner', 'POST', {
            emails, expiresInHours, singleUse, permission: 'message', canPreview: true,
        });
        const configured = await configure(['alex@example.com', 'maya@example.com', 'pending@example.com']);
        assert.equal(configured.status, 201);
        const { token, inviteURL } = await configured.json() as { token: string; inviteURL: string };
        assert.equal(outbox.length, 3);
        assert.ok(outbox.every((email) => email.text.includes(inviteURL)));
        const originalDeadline = (await database.sharedThread.findUniqueOrThrow({ where: { id } })).expiresAt;
        const keepExpiry = await request(`/threads/${id}/invites`, 'owner', 'POST', {
            emails: ['alex@example.com', 'maya@example.com', 'pending@example.com'],
            singleUse: false, permission: 'message', canPreview: true,
        });
        assert.equal(keepExpiry.status, 201);
        assert.equal((await keepExpiry.json() as { inviteURL: string }).inviteURL, inviteURL);
        assert.deepEqual((await database.sharedThread.findUniqueOrThrow({ where: { id } })).expiresAt, originalDeadline);
        const listing = await (await request('/threads')).json() as { threads: { grantCount: number }[] };
        assert.equal(listing.threads[0]?.grantCount, 3);
        assert.equal((await acceptFromCompanion(token)).status, 200);
        assert.equal((await acceptFromCompanion(token, 'invalid-device')).status, 401);
        assert.equal((await acceptFromCompanion(token, 'test-other-device')).status, 403);
        for (const user of ['alex', 'maya']) {
            assert.equal((await request(`/threads/${id}`, user)).status, 200);
            const sent = await request(`/threads/${id}/messages`, user, 'POST', { prompt: 'test' });
            assert.equal(sent.status, 200);
            assert.deepEqual(await sent.json(), { queued: true });
            const inspected = await (await request('/invites/inspect', user, 'POST', { token })).json() as { invite: { hasAccess: boolean } };
            assert.equal(inspected.invite.hasAccess, true);
        }
        assert.deepEqual(hostCalls, ['read', 'queue', 'read', 'queue'].map((operation) => ({
            operation, deviceId: 'device', threadId: 'local-task',
        })));
        hostCalls.length = 0;
        // 未授权、未验证邮箱或不存在的分享，必须在调用本地宿主之前拒绝。
        for (const [target, user] of [[id, 'other'], [id, 'pending'], ['missing', 'alex']]) {
            assert.equal((await request(`/threads/${target}`, user)).status, 404);
            assert.equal((await request(`/threads/${target}/messages`, user, 'POST', { prompt: 'test' })).status, 404);
        }
        assert.deepEqual(hostCalls, []);
        await database.shareGrant.updateMany({ where: { sharedThreadId: id, email: 'alex@example.com' }, data: { permission: 'read' } });
        assert.equal((await request(`/threads/${id}`, 'alex')).status, 200);
        assert.equal((await request(`/threads/${id}/messages`, 'alex', 'POST', { prompt: 'test' })).status, 404);
        assert.deepEqual(hostCalls, [{ operation: 'read', deviceId: 'device', threadId: 'local-task' }]);
        await database.shareGrant.updateMany({ where: { sharedThreadId: id, email: 'alex@example.com' }, data: { permission: 'message' } });
        assert.equal((await request(`/threads/${id}`, 'pending')).status, 404);
        assert.equal((await request('/invites/accept', 'other', 'POST', { token })).status, 403);
        await database.user.update({ where: { id: 'pending' }, data: { emailVerified: true } });
        assert.equal((await request(`/threads/${id}`, 'pending')).status, 200);
        assert.equal((await request(`/threads/${id}/grants/me`, 'pending', 'DELETE')).status, 204);
        assert.equal((await request(`/threads/${id}`, 'pending')).status, 404);
        await database.previewService.create({ data: { id: 'service', ownerId: 'owner', deviceId: 'device', sharedThreadId: id, localUrl: 'http://localhost:3000/', name: 'Web' } });
        assert.equal((await getPreviewAccess(database, 'service', 'alex'))?.granted, true);

        // 已建立的 SSE 也必须在授权截止时阻断，不能只检查连接建立时的权限。
        const now = Date.now();
        context.mock.timers.enable({ apis: ['Date'], now });
        await database.sharedThread.update({ where: { id }, data: { expiresAt: new Date(now + 10_000) } });
        const session = await request('/services/service/session', 'alex', 'POST');
        assert.equal(session.status, 200);
        const cookie = session.headers.get('set-cookie')!.split(';')[0]!;
        assert.equal((await session.json() as { expiresAt: string }).expiresAt, new Date(now + 10_000).toISOString());
        const stream = new TransformStream<Uint8Array, Uint8Array>();
        const writer = stream.writable.getWriter();
        runtime.proxyPreviewRequest = async () => new Response(stream.readable, { headers: { 'content-type': 'text/event-stream' } });
        const sse = await app.request('/preview/service/events', { headers: { cookie, 'x-test-user': 'alex' } });
        const reader = sse.body!.getReader();
        const firstChunk = reader.read();
        await writer.write(new TextEncoder().encode('data: before\n\n'));
        assert.equal(new TextDecoder().decode((await firstChunk).value), 'data: before\n\n');
        context.mock.timers.setTime(now + 10_000);
        const blockedChunk = assert.rejects(reader.read(), /authorization expired/u);
        await writer.write(new TextEncoder().encode('data: after\n\n')).catch(() => undefined);
        await blockedChunk;
        assert.equal((await app.request('/preview/service/events', { headers: { cookie, 'x-test-user': 'alex' } })).status, 401);
        context.mock.timers.reset();
        await database.sharedThread.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1) } });
        hostCalls.length = 0;
        assert.equal((await request(`/threads/${id}`, 'alex')).status, 404);
        assert.equal((await acceptFromCompanion(token)).status, 404);
        assert.equal((await request(`/threads/${id}/messages`, 'alex', 'POST', { prompt: 'test' })).status, 404);
        assert.deepEqual(hostCalls, []);
        assert.equal((await getPreviewAccess(database, 'service', 'alex'))?.granted, false);
        assert.deepEqual((await (await request('/threads', 'alex')).json() as { threads: unknown[] }).threads, []);

        const permanent = await configure([], null);
        assert.equal(permanent.status, 201);
        assert.equal((await permanent.json() as { inviteURL: string }).inviteURL, inviteURL);
        assert.equal((await database.sharedThread.findUniqueOrThrow({ where: { id } })).expiresAt, null);
        assert.equal((await acceptFromCompanion(token, 'test-other-device')).status, 200);
        assert.equal((await request('/invites/accept', 'pending', 'POST', { token })).status, 200);

        // 清空领取者以验证同一链接的并发单次领取，而非已有权限的幂等访问。
        await database.shareGrant.deleteMany({ where: { sharedThreadId: id } });
        assert.equal((await configure([], 168, true)).status, 201);
        for (const user of ['alex', 'maya']) assert.equal((await request('/invites/inspect', user, 'POST', { token })).status, 200);
        assert.equal((await database.shareInvite.findUniqueOrThrow({ where: { id } })).acceptedById, null);
        const attempts = await Promise.all(['alex', 'maya'].map((user) => request('/invites/accept', user, 'POST', { token })));
        assert.deepEqual(attempts.map((response) => response.status).sort(), [200, 409]);
        const winner = attempts[0]!.status === 200 ? 'alex' : 'maya';
        assert.equal((await request('/invites/accept', winner, 'POST', { token })).status, 200);
        const winningGrant = await database.shareGrant.findFirstOrThrow({ where: { sharedThreadId: id } });
        assert.equal((await request(`/threads/${id}/grants/${winningGrant.id}`, 'owner', 'DELETE')).status, 204);
        assert.equal((await request('/invites/accept', winner, 'POST', { token })).status, 409);

        const candidates = await (await request('/threads/recipients?q=alex')).json() as { users: { email: string }[] };
        assert.deepEqual(candidates.users.map((user) => user.email), ['alex@example.com']);
        await database.user.update({ where: { id: 'other' }, data: { name: 'Taylor Designer' } });
        await database.user.update({ where: { id: 'owner' }, data: { name: 'Taylor Owner' } });
        await database.user.update({ where: { id: 'pending' }, data: { name: 'Taylor Pending', emailVerified: false } });
        const byName = await (await request('/threads/recipients?q=taylor')).json() as { users: { email: string }[] };
        assert.deepEqual(byName.users.map((user) => user.email), ['other@example.com']);
        await database.user.update({ where: { id: 'other' }, data: { disabledAt: new Date() } });
        assert.deepEqual((await (await request('/threads/recipients?q=taylor')).json() as { users: unknown[] }).users, []);
        await database.user.delete({ where: { id: winner } });
        assert.equal((await request('/invites/accept', 'other', 'POST', { token })).status, 409);
        assert.equal((await configure([], -1)).status, 400);
        assert.equal((await configure(['bad-address'])).status, 400);
    } finally {
        await database.$disconnect();
        await rm(directory, { recursive: true, force: true });
    }
});
