import type { RelayApi, ThreadInviteOptions } from './relay-client.js';
import type { CodexHost } from './codex-host.js';

export class CompanionService {
    constructor(private readonly relay: RelayApi, private readonly host: CodexHost) {}

    async shareThread(codexThreadId: string, title?: string): Promise<unknown> {
        await this.host.readThread(codexThreadId);
        return this.relay.createSharedThread(codexThreadId, title);
    }

    async unshareThread(sharedThreadId: string): Promise<{ deleted: true }> {
        await this.relay.deleteSharedThread(sharedThreadId);
        return { deleted: true };
    }

    shareLocalService(
        name: string,
        localURL: string,
        sharedThreadId: string,
    ): Promise<unknown> {
        return this.relay.createPreviewService(name, localURL, sharedThreadId);
    }

    createThreadInvite(
        sharedThreadId: string,
        options: ThreadInviteOptions,
    ): Promise<unknown> {
        return this.relay.createThreadInvite(
            sharedThreadId,
            options,
        );
    }

    async stopSharingLocalService(previewServiceId: string): Promise<{ deleted: true }> {
        await this.relay.deletePreviewService(previewServiceId);
        return { deleted: true };
    }

    listSharedThreads(): Promise<unknown> {
        return this.relay.listSharedThreads();
    }

    acceptInvite(inviteURL: string): Promise<unknown> {
        return this.relay.acceptInvite(inviteURL);
    }

    readSharedThread(sharedThreadId: string): Promise<unknown> {
        return this.relay.readSharedThread(sharedThreadId);
    }

    async sendSharedMessage(sharedThreadId: string, prompt: string): Promise<unknown> {
        await this.relay.sendSharedMessage(sharedThreadId, prompt);
        return { queued: true };
    }

    async deliverToCodex(codexThreadId: string, prompt: string): Promise<unknown> {
        return this.host.sendMessage(codexThreadId, prompt);
    }

    async readFromCodex(codexThreadId: string): Promise<unknown> {
        return this.host.readCompleteThread(codexThreadId);
    }
}
