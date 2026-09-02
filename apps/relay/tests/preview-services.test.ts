import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { normalizeLocalPreviewURL } from '../src/routes/preview-services.js';

test('normalizes supported local preview URLs', () => {
    assert.equal(normalizeLocalPreviewURL('http://localhost:5173'), 'http://localhost:5173/');
    assert.equal(normalizeLocalPreviewURL('https://127.0.0.1:3000/app'), 'https://127.0.0.1:3000/app/');
    assert.equal(normalizeLocalPreviewURL('http://[::1]:8080'), 'http://[::1]:8080/');
});

test('rejects non-local or ambiguous preview URLs', () => {
    for (const value of [
        'https://example.com',
        'file:///tmp/index.html',
        'http://user:pass@localhost:3000',
        'http://localhost:3000/?token=secret',
    ]) {
        assert.throws(() => normalizeLocalPreviewURL(value));
    }
});
