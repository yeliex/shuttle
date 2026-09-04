export interface ThreadInviteOptions {
    emails: string[];
    expiresInHours: number | null;
    permission: 'message' | 'read';
    canPreview: boolean;
    singleUse: boolean;
}

export interface RelayApi {
    acceptInvite(inviteURL: string): Promise<unknown>;
    createPreviewService(name: string, localURL: string, sharedThreadId: string): Promise<unknown>;
    createSharedThread(codexThreadId: string, title?: string): Promise<unknown>;
    createThreadInvite(
        sharedThreadId: string,
        options: ThreadInviteOptions,
    ): Promise<unknown>;
    deleteSharedThread(sharedThreadId: string): Promise<void>;
    deletePreviewService(previewServiceId: string): Promise<void>;
    listSharedThreads(): Promise<unknown>;
    readSharedThread(sharedThreadId: string): Promise<unknown>;
    sendSharedMessage(sharedThreadId: string, prompt: string): Promise<unknown>;
}

interface RelayClientOptions {
    baseURL: string;
    deviceToken: string;
    fetch?: typeof fetch;
}

const readResponse = async (response: Response): Promise<unknown> => {
    if (response.ok) {
        return response.status === 204 ? undefined : response.json();
    }

    let message = `Relay request failed with ${response.status}`;
    try {
        const body = await response.json() as { error?: unknown };
        if (typeof body.error === 'string') {
            message = body.error;
        }
    } catch {
        // The status remains enough context when the Relay did not return JSON.
    }
    throw new Error(message);
};

export class RelayClient implements RelayApi {
    private readonly baseURL: string;
    private readonly deviceToken: string;
    private readonly fetchImplementation: typeof fetch;

    constructor(options: RelayClientOptions) {
        this.baseURL = options.baseURL.replace(/\/$/u, '');
        this.deviceToken = options.deviceToken;
        this.fetchImplementation = options.fetch ?? fetch;
    }

    async createSharedThread(codexThreadId: string, title?: string): Promise<unknown> {
        return this.request('/api/shared-threads', {
            method: 'POST',
            body: JSON.stringify({ codexThreadId, title }),
        });
    }

    async createPreviewService(
        name: string,
        localURL: string,
        sharedThreadId: string,
    ): Promise<unknown> {
        return this.request('/api/preview-services', {
            method: 'POST',
            body: JSON.stringify({ localURL, name, sharedThreadId }),
        });
    }

    async createThreadInvite(
        sharedThreadId: string,
        options: ThreadInviteOptions,
    ): Promise<unknown> {
        return this.request(`/api/shared-threads/${encodeURIComponent(sharedThreadId)}/invites`, {
            method: 'POST',
            body: JSON.stringify(options),
        });
    }

    searchRecipients(query: string): Promise<unknown> {
        return this.request(`/api/shared-threads/recipients?q=${encodeURIComponent(query)}`);
    }

    async acceptInvite(inviteURL: string): Promise<unknown> {
        let url: URL;
        try {
            url = new URL(inviteURL);
        } catch {
            throw new Error('Provide a complete Shuttle invitation link');
        }
        if (url.origin !== new URL(this.baseURL).origin) {
            throw new Error('This invitation belongs to another Relay. Select that Relay and sign in through Shuttle setup first.');
        }
        if (url.username || url.password || !/^\/app\/invite\/?$/u.test(url.pathname)
            || !/^#shuttle_invite_[A-Za-z0-9_-]{43}$/u.test(url.hash)) {
            throw new Error('The Shuttle invitation link is invalid or missing its code');
        }
        // 只向已配置的 Relay 发送 code，绝不跟随分享 URL 将设备凭据发往其他站点。
        const result = await this.request('/api/invites/accept', {
            method: 'POST', body: JSON.stringify({ token: url.hash.slice(1) }),
        });
        const sharedThreadId = result && typeof result === 'object' && 'sharedThreadId' in result
            ? result.sharedThreadId : undefined;
        if (typeof sharedThreadId !== 'string' || !sharedThreadId) throw new Error('Relay did not return a shared task ID');
        return { sharedThreadId, deeplink: `shuttle://shared/${sharedThreadId}` };
    }

    async deleteSharedThread(sharedThreadId: string): Promise<void> {
        await this.request(`/api/shared-threads/${encodeURIComponent(sharedThreadId)}`, {
            method: 'DELETE',
        });
    }

    async deletePreviewService(previewServiceId: string): Promise<void> {
        await this.request(`/api/preview-services/${encodeURIComponent(previewServiceId)}`, {
            method: 'DELETE',
        });
    }

    async listSharedThreads(): Promise<unknown> {
        return this.request('/api/shared-threads');
    }

    async readSharedThread(sharedThreadId: string): Promise<unknown> {
        return this.request(`/api/shared-threads/${encodeURIComponent(sharedThreadId)}`);
    }

    async sendSharedMessage(
        sharedThreadId: string,
        prompt: string,
    ): Promise<unknown> {
        return this.request(`/api/shared-threads/${encodeURIComponent(sharedThreadId)}/messages`, {
            method: 'POST',
            body: JSON.stringify({ prompt }),
        });
    }

    getDeviceConnection(): { protocols: string[]; url: string } {
        const url = new URL('/connect/device', this.baseURL);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        return {
            protocols: ['shuttle.v1', `shuttle-auth.${this.deviceToken}`],
            url: url.toString(),
        };
    }

    private async request(path: string, init: RequestInit = {}): Promise<unknown> {
        const headers = new Headers(init.headers);
        headers.set('Authorization', `Bearer ${this.deviceToken}`);
        if (init.body !== undefined) {
            headers.set('Content-Type', 'application/json');
        }
        const response = await this.fetchImplementation(`${this.baseURL}${path}`, {
            ...init,
            headers,
        });
        return readResponse(response);
    }
}
