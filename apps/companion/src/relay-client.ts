export interface RelayApi {
    createPreviewService(name: string, localURL: string, sharedThreadId: string): Promise<unknown>;
    createSharedThread(codexThreadId: string, title?: string): Promise<unknown>;
    createThreadInvite(
        sharedThreadId: string,
        email: string | undefined,
        expiresInHours: number,
        permission: 'message' | 'read',
        canPreview: boolean,
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
        email: string | undefined,
        expiresInHours: number,
        permission: 'message' | 'read',
        canPreview: boolean,
    ): Promise<unknown> {
        return this.request(`/api/shared-threads/${encodeURIComponent(sharedThreadId)}/invites`, {
            method: 'POST',
            body: JSON.stringify({ canPreview, email, expiresInHours, permission }),
        });
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
