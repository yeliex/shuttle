import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { isPreviewReferer } from '../src/preview-proxy.js';

test('limits root preview proxying to the active preview page', () => {
    const requestURL = 'https://shuttle.example/assets/client.js';
    const previewServiceId = 'preview-1';

    assert.equal(isPreviewReferer(
        requestURL,
        'https://shuttle.example/preview/preview-1/',
        previewServiceId,
    ), true);
    assert.equal(isPreviewReferer(
        requestURL,
        'https://shuttle.example/preview/preview-1/nested/page',
        previewServiceId,
    ), true);
    for (const referer of [
        undefined,
        'not-a-url',
        'https://shuttle.example/',
        'https://shuttle.example/app/',
        'https://shuttle.example/preview/preview-10/',
        'https://another.example/preview/preview-1/',
    ]) {
        assert.equal(isPreviewReferer(requestURL, referer, previewServiceId), false);
    }
});
