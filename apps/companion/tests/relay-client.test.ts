import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { RelayClient } from '../src/relay-client.js';

test('accepts a sharing link through the configured Relay and returns its exact task reference', async () => {
    const code = `shuttle_invite_${'a'.repeat(43)}`;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new RelayClient({
        baseURL: 'https://relay.example', deviceToken: 'test-device',
        fetch: async (url, init) => {
            calls.push({ url: String(url), ...(init ? { init } : {}) });
            return Response.json({ sharedThreadId: 'task-123' });
        },
    });
    assert.deepEqual(await client.acceptInvite(`https://relay.example/app/invite#${code}`), {
        sharedThreadId: 'task-123', deeplink: 'shuttle://shared/task-123',
    });
    assert.equal(calls[0]!.url, 'https://relay.example/api/invites/accept');
    assert.equal(calls[0]!.init?.body, JSON.stringify({ token: code }));
    assert.equal(new Headers(calls[0]!.init?.headers).get('Authorization'), 'Bearer test-device');
    for (const link of [
        `https://other.example/app/invite#${code}`, `https://relay.example.evil.test/app/invite#${code}`,
        `https://user@relay.example/app/invite#${code}`, `https://relay.example/other#${code}`,
        'https://relay.example/app/invite', 'not-a-link',
    ]) await assert.rejects(client.acceptInvite(link));
    assert.equal(calls.length, 1);
});
