export class HttpError extends Error {
    readonly response: Response;
    readonly status: number;

    constructor(response: Response, message?: string) {
        const statusText = response.statusText || 'Request failed';
        super(message || `${response.status} ${statusText}`);
        this.name = 'HttpError';
        this.response = response;
        this.status = response.status;
    }
}

export async function requestJson<Data>(
    input: RequestInfo | URL,
    init?: RequestInit,
): Promise<Data> {
    const headers = new Headers(init?.headers);
    if (!headers.has('accept')) {
        headers.set('accept', 'application/json');
    }

    const response = await fetch(input, { ...init, headers });
    await assertResponse(response);

    return response.json();
}

export async function requestVoid(
    input: RequestInfo | URL,
    init?: RequestInit,
): Promise<void> {
    const response = await fetch(input, init);
    await assertResponse(response);
}

export function jsonRequest(body: unknown, init?: RequestInit): RequestInit {
    const headers = new Headers(init?.headers);
    headers.set('content-type', 'application/json');
    return { ...init, body: JSON.stringify(body), headers };
}

async function assertResponse(response: Response): Promise<void> {
    if (response.ok) {
        return;
    }

    let message: string | undefined;
    try {
        const body = await response.clone().json() as { error?: unknown; message?: unknown };
        if (typeof body.error === 'string') {
            message = body.error;
        } else if (typeof body.message === 'string') {
            message = body.message;
        }
    } catch {
        // The status remains useful when an upstream sends a non-JSON error page.
    }

    throw new HttpError(response, message);
}
