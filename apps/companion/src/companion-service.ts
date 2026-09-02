import type { RelayApi } from './relay-client.js';

export interface CodexThreadHost {
    readThread(): Promise<unknown>;
    sendMessage(prompt: string): Promise<unknown>;
}

export class CompanionService {
    private readonly hosts = new Map<string, CodexThreadHost>();

    constructor(private readonly relay: RelayApi) {}

    registerHost(codexThreadId: string, host: CodexThreadHost): () => void {
        this.hosts.set(codexThreadId, host);
        return () => {
            if (this.hosts.get(codexThreadId) === host) {
                this.hosts.delete(codexThreadId);
            }
        };
    }

    async shareThread(codexThreadId: string, title?: string): Promise<unknown> {
        this.getHost(codexThreadId);
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
        email: string | undefined,
        expiresInHours: number,
        permission: 'message' | 'read',
        canPreview: boolean,
    ): Promise<unknown> {
        return this.relay.createThreadInvite(
            sharedThreadId,
            email,
            expiresInHours,
            permission,
            canPreview,
        );
    }

    async stopSharingLocalService(previewServiceId: string): Promise<{ deleted: true }> {
        await this.relay.deletePreviewService(previewServiceId);
        return { deleted: true };
    }

    listSharedThreads(): Promise<unknown> {
        return this.relay.listSharedThreads();
    }

    readSharedThread(sharedThreadId: string): Promise<unknown> {
        return this.relay.readSharedThread(sharedThreadId);
    }

    sendSharedMessage(sharedThreadId: string, prompt: string): Promise<unknown> {
        return this.relay.sendSharedMessage(sharedThreadId, prompt);
    }

    async deliverToCodex(codexThreadId: string, prompt: string): Promise<unknown> {
        return this.getHost(codexThreadId).sendMessage(prompt);
    }

    async readFromCodex(codexThreadId: string): Promise<unknown> {
        return this.getHost(codexThreadId).readThread();
    }

    private getHost(codexThreadId: string): CodexThreadHost {
        const host = this.hosts.get(codexThreadId);
        if (!host) {
            throw new Error('This Codex task is not registered with the local Companion');
        }
        return host;
    }
}
