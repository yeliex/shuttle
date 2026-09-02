import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { createPreviewToken, verifyPreviewToken } from '../src/preview-token.js';

test('round-trips a valid preview token', async () => {
    const payload = {
        expiresAt: Date.now() + 60_000,
        previewServiceId: 'service-id',
        userId: 'user-id',
    };

    const token = await createPreviewToken('test-secret', payload);

    assert.deepEqual(await verifyPreviewToken('test-secret', token), payload);
});

test('rejects tampered and expired preview tokens', async () => {
    const token = await createPreviewToken('test-secret', {
        expiresAt: Date.now() + 60_000,
        previewServiceId: 'service-id',
        userId: 'user-id',
    });
    const [body, signature] = token.split('.');

    assert.equal(await verifyPreviewToken('test-secret', `${body}x.${signature}`), undefined);

    const expired = await createPreviewToken('test-secret', {
        expiresAt: Date.now() - 1,
        previewServiceId: 'service-id',
        userId: 'user-id',
    });
    assert.equal(await verifyPreviewToken('test-secret', expired), undefined);
});
