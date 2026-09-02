import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { CompanionService } from '../src/companion-service.js';
import type { RelayApi } from '../src/relay-client.js';

class FakeRelay implements RelayApi {
    readonly calls: Array<{ name: string; values: unknown[] }> = [];

    async createPreviewService(
        name: string,
        localURL: string,
        sharedThreadId: string,
    ): Promise<unknown> {
        this.calls.push({ name: 'createPreview', values: [name, localURL, sharedThreadId] });
        return { service: { id: 'preview-1' } };
    }

    async createThreadInvite(
        sharedThreadId: string,
        email: string | undefined,
        expiresInHours: number,
        permission: 'message' | 'read',
        canPreview: boolean,
    ): Promise<unknown> {
        this.calls.push({
            name: 'createThreadInvite',
            values: [sharedThreadId, email, expiresInHours, permission, canPreview],
        });
        return { inviteURL: 'https://shuttle.example/app/invite#token' };
    }

    async createSharedThread(codexThreadId: string, title?: string): Promise<unknown> {
        this.calls.push({ name: 'create', values: [codexThreadId, title] });
        return { thread: { id: 'shared-1' } };
    }

    async deleteSharedThread(sharedThreadId: string): Promise<void> {
        this.calls.push({ name: 'delete', values: [sharedThreadId] });
    }

    async deletePreviewService(previewServiceId: string): Promise<void> {
        this.calls.push({ name: 'deletePreview', values: [previewServiceId] });
    }

    async listSharedThreads(): Promise<unknown> {
        return { threads: [] };
    }

    async readSharedThread(sharedThreadId: string): Promise<unknown> {
        return { thread: { id: sharedThreadId } };
    }

    async sendSharedMessage(sharedThreadId: string, prompt: string): Promise<unknown> {
        this.calls.push({ name: 'send', values: [sharedThreadId, prompt] });
        return { delivered: true };
    }
}

test('shares only metadata for a locally registered Codex task', async () => {
    const relay = new FakeRelay();
    const service = new CompanionService(relay);
    service.registerHost('codex-1', {
        readThread: async () => ({ turns: [{ role: 'user', text: 'hello' }] }),
        sendMessage: async () => ({ sent: true }),
    });

    const result = await service.shareThread('codex-1', 'Planning');

    assert.deepEqual(result, { thread: { id: 'shared-1' } });
    assert.deepEqual(relay.calls, [{ name: 'create', values: ['codex-1', 'Planning'] }]);
    await assert.rejects(
        service.shareThread('missing'),
        /not registered with the local Companion/,
    );
});

test('creates one task invitation with local service access', async () => {
    const relay = new FakeRelay();
    const service = new CompanionService(relay);

    await service.createThreadInvite('shared-1', 'guest@example.com', 24, 'read', true);

    assert.deepEqual(relay.calls, [{
        name: 'createThreadInvite',
        values: ['shared-1', 'guest@example.com', 24, 'read', true],
    }]);
});

test('delivers a Relay request directly to the registered Codex host', async () => {
    const service = new CompanionService(new FakeRelay());
    const prompts: string[] = [];
    const unregister = service.registerHost('codex-1', {
        readThread: async () => ({}),
        sendMessage: async (prompt) => {
            prompts.push(prompt);
            return { sent: true };
        },
    });

    await service.deliverToCodex('codex-1', 'Please review this');
    assert.deepEqual(prompts, ['Please review this']);

    unregister();
    await assert.rejects(
        service.deliverToCodex('codex-1', 'retry'),
        /not registered with the local Companion/,
    );
});

test('shares and stops a local service through the Relay', async () => {
    const relay = new FakeRelay();
    const service = new CompanionService(relay);

    await service.shareLocalService('Local app', 'http://localhost:5173', 'shared-1');
    await service.stopSharingLocalService('preview-1');

    assert.deepEqual(relay.calls, [
        {
            name: 'createPreview',
            values: ['Local app', 'http://localhost:5173', 'shared-1'],
        },
        { name: 'deletePreview', values: ['preview-1'] },
    ]);
});
