import { HTTPException } from 'hono/http-exception';

export const readJsonObject = async (request: Request): Promise<Record<string, unknown>> => {
    let value: unknown;

    try {
        value = await request.json();
    } catch {
        throw new HTTPException(400, { message: 'Request body must be valid JSON' });
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new HTTPException(400, { message: 'Request body must be a JSON object' });
    }

    return value as Record<string, unknown>;
};

export const readRequiredString = (
    object: Record<string, unknown>,
    name: string,
    maximumLength: number,
): string => {
    const value = object[name];
    if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) {
        throw new HTTPException(400, {
            message: `${name} must be a non-empty string of at most ${maximumLength} characters`,
        });
    }

    return value;
};

export const readOptionalString = (
    object: Record<string, unknown>,
    name: string,
    maximumLength: number,
): string | undefined => {
    const value = object[name];
    if (value === undefined || value === null) {
        return undefined;
    }

    return readRequiredString(object, name, maximumLength);
};

export const readOptionalEmail = (
    object: Record<string, unknown>,
    name: string,
): string | undefined => {
    const value = readOptionalString(object, name, 320);
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        throw new HTTPException(400, { message: `${name} must be an email address` });
    }

    return value;
};

export const readPermission = (object: Record<string, unknown>): 'message' | 'read' => {
    const permission = object.permission;
    if (permission !== 'read' && permission !== 'message') {
        throw new HTTPException(400, { message: 'permission must be "read" or "message"' });
    }

    return permission;
};

export const createSecret = (prefix: string): string => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const value = btoa(String.fromCharCode(...bytes))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
    return `${prefix}_${value}`;
};

export const hashSecret = async (secret: string): Promise<string> => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
    return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
};
