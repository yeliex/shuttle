import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { CompanionService } from '../src/companion-service.js';
import type { CodexHost } from '../src/codex-host.js';
import type { RelayApi, ThreadInviteOptions } from '../src/relay-client.js';

class FakeRelay implements RelayApi {
    readonly calls: Array<{ name: string; values: unknown[] }> = [];

    async acceptInvite(inviteURL: string): Promise<unknown> {
        this.calls.push({ name: 'acceptInvite', values: [inviteURL] });
        return { sharedThreadId: 'shared-1', deeplink: 'shuttle://shared/shared-1' };
    }

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
        options: ThreadInviteOptions,
    ): Promise<unknown> {
        this.calls.push({
            name: 'createThreadInvite',
            values: [sharedThreadId, options],
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

const host: CodexHost = {
    readThread: async (threadId) => {
        if (threadId === 'missing') throw new Error('Codex task not found');
        return { thread: { id: threadId } };
    },
    readCompleteThread: async (threadId) => ({ thread: { id: threadId }, turns: [] }),
    sendMessage: async () => ({ status: 'queued' }),
};

test('创建分享前确认指定任务存在，仅向 Relay 提交元数据', async () => {
    const relay = new FakeRelay();
    const service = new CompanionService(relay, host);

    const result = await service.shareThread('codex-1', 'Planning');

    assert.deepEqual(result, { thread: { id: 'shared-1' } });
    assert.deepEqual(relay.calls, [{ name: 'create', values: ['codex-1', 'Planning'] }]);
    await assert.rejects(
        service.shareThread('missing'),
        /not found/u,
    );
});

test('creates one task invitation with local service access', async () => {
    const relay = new FakeRelay();
    const service = new CompanionService(relay, host);

    await service.createThreadInvite('shared-1', { emails: ['guest@example.com', 'another@example.com'], expiresInHours: null, permission: 'read', canPreview: true, singleUse: false });

    assert.deepEqual(relay.calls, [{
        name: 'createThreadInvite',
        values: ['shared-1', { emails: ['guest@example.com', 'another@example.com'], expiresInHours: null, permission: 'read', canPreview: true, singleUse: false }],
    }]);
});

test('已授权 Relay 请求在 Companion 重建后直接访问指定任务，不依赖 MCP 存活', async () => {
    const prompts: string[] = [];
    const service = new CompanionService(new FakeRelay(), {
        ...host,
        sendMessage: async (threadId, prompt) => {
            prompts.push(`${threadId}:${prompt}`);
            return { status: 'queued' };
        },
    });

    await service.deliverToCodex('codex-1', 'Please review this');
    assert.deepEqual(prompts, ['codex-1:Please review this']);
    assert.deepEqual(await new CompanionService(new FakeRelay(), host).readFromCodex('codex-1'), {
        thread: { id: 'codex-1' }, turns: [],
    });
});

test('shares and stops a local service through the Relay', async () => {
    const relay = new FakeRelay();
    const service = new CompanionService(relay, host);

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
