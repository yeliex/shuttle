export interface PreviewTokenPayload {
    expiresAt: number;
    previewServiceId: string;
    userId: string;
}

const encodeBase64URL = (bytes: Uint8Array): string => {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary)
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
};

const decodeBase64URL = (value: string): Uint8Array => {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
    const padding = '='.repeat((4 - base64.length % 4) % 4);
    return Uint8Array.from(atob(`${base64}${padding}`), (character) => character.charCodeAt(0));
};

const importKey = (secret: string) => crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign', 'verify'],
);

export const createPreviewToken = async (
    secret: string,
    payload: PreviewTokenPayload,
): Promise<string> => {
    const body = encodeBase64URL(new TextEncoder().encode(JSON.stringify(payload)));
    const signature = await crypto.subtle.sign(
        'HMAC',
        await importKey(secret),
        new TextEncoder().encode(body),
    );
    return `${body}.${encodeBase64URL(new Uint8Array(signature))}`;
};

export const verifyPreviewToken = async (
    secret: string,
    token: string | undefined,
): Promise<PreviewTokenPayload | undefined> => {
    if (!token) {
        return undefined;
    }
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra !== undefined) {
        return undefined;
    }

    try {
        const valid = await crypto.subtle.verify(
            'HMAC',
            await importKey(secret),
            decodeBase64URL(signature),
            new TextEncoder().encode(body),
        );
        if (!valid) {
            return undefined;
        }
        const payload = JSON.parse(new TextDecoder().decode(decodeBase64URL(body))) as unknown;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return undefined;
        }
        const value = payload as Record<string, unknown>;
        if (typeof value.expiresAt !== 'number'
            || value.expiresAt <= Date.now()
            || typeof value.previewServiceId !== 'string'
            || typeof value.userId !== 'string') {
            return undefined;
        }
        return {
            expiresAt: value.expiresAt,
            previewServiceId: value.previewServiceId,
            userId: value.userId,
        };
    } catch {
        return undefined;
    }
};
