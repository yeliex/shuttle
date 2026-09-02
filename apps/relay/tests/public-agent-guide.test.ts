import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { createRelay } from '../src/app.js';

test('serves the public agent setup guide without creating a relay runtime', async () => {
    const relay = createRelay(() => {
        throw new Error('The public guide must not initialize a relay runtime');
    });

    const response = await relay.request('/Agents.md');
    const guide = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/plain;/u);
    assert.match(guide, /codex plugin add shuttle@shuttle/u);
    assert.match(guide, /shuttle:\/\/shared\//u);
    assert.match(guide, /shuttle:\/\/service\//u);
    assert.match(guide, /start a new Codex task/u);
});
