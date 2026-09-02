import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';

import {
    getPreviewSession,
    getPreviewSessionAccess,
    type PreviewAccess,
} from './routes/preview-services.js';
import type { RelayHonoEnvironment } from './runtime.js';

const MAX_REQUEST_BODY_LENGTH = 16 * 1024 * 1024;
const REQUEST_HEADERS_TO_REMOVE = new Set([
    'authorization',
    'connection',
    'content-length',
    'cookie',
    'host',
    'proxy-connection',
    'upgrade',
]);

const encodeBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32_768) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
    }
    return btoa(binary);
};

export const getPreviewTargetURL = (
    localURL: string,
    previewServiceId: string | undefined,
    requestURL: string,
): string => {
    const incoming = new URL(requestURL);
    if (!previewServiceId) {
        return new URL(`${incoming.pathname}${incoming.search}`, new URL(localURL).origin).toString();
    }
    const prefix = `/preview/${previewServiceId}`;
    const relativePath = incoming.pathname.slice(prefix.length).replace(/^\//u, '');
    const target = new URL(relativePath, localURL);
    target.search = incoming.search;
    return target.toString();
};

export const isPreviewReferer = (
    requestURL: string,
    referer: string | undefined,
    previewServiceId: string,
): boolean => {
    if (!referer) {
        return false;
    }
    try {
        const request = new URL(requestURL);
        const refererURL = new URL(referer);
        const previewPath = `/preview/${previewServiceId}`;
        return refererURL.origin === request.origin
            && (refererURL.pathname === previewPath
                || refererURL.pathname.startsWith(`${previewPath}/`));
    } catch {
        return false;
    }
};

const forwardPreviewRequest = async (
    context: Context<RelayHonoEnvironment>,
    pathPreviewServiceId: string | undefined,
    previewServiceId: string,
    access: PreviewAccess,
): Promise<Response> => {
    const proxy = context.var.runtime.proxyPreviewRequest;
    if (!proxy) {
        return context.json({ error: 'Preview proxy is unavailable' }, 503);
    }

    const body = await context.req.raw.arrayBuffer();
    if (body.byteLength > MAX_REQUEST_BODY_LENGTH) {
        return context.json({ error: 'Preview request body exceeds 16 MB' }, 413);
    }
    const headers = [...context.req.raw.headers.entries()]
        .filter(([name]) => !REQUEST_HEADERS_TO_REMOVE.has(name.toLowerCase()));

    try {
        const targetURL = getPreviewTargetURL(access.localUrl, pathPreviewServiceId, context.req.url);
        const response = await proxy(
            access.deviceId,
            previewServiceId,
            targetURL,
            {
                bodyBase64: body.byteLength > 0
                    ? encodeBase64(new Uint8Array(body))
                    : undefined,
                headers,
                method: context.req.method,
            },
        );
        const location = response.headers.get('location');
        if (!pathPreviewServiceId || !location) {
            return response;
        }
        const redirect = new URL(location, targetURL);
        if (redirect.origin !== new URL(access.localUrl).origin) {
            return response;
        }
        const headersWithRedirect = new Headers(response.headers);
        headersWithRedirect.set(
            'location',
            `/preview/${pathPreviewServiceId}${redirect.pathname}${redirect.search}${redirect.hash}`,
        );
        return new Response(response.body, {
            headers: headersWithRedirect,
            status: response.status,
            statusText: response.statusText,
        });
    } catch (error) {
        return context.json({
            error: error instanceof Error ? error.message : 'Preview request failed',
        }, 503);
    }
};

export const proxyPreviewRequest = async (
    context: Context<RelayHonoEnvironment>,
): Promise<Response> => {
    const previewServiceId = context.req.param('previewServiceId');
    if (!previewServiceId) {
        return context.json({ error: 'Preview not found' }, 404);
    }
    const access = await getPreviewSessionAccess(
        context.var.runtime.database,
        context.var.runtime.previewTokenSecret,
        previewServiceId,
        getCookie(context, 'shuttle_preview'),
    );
    if (!access) {
        return context.json({ error: 'Preview access required' }, 401);
    }
    return forwardPreviewRequest(context, previewServiceId, previewServiceId, access);
};

export const proxyPreviewRootRequest = async (
    context: Context<RelayHonoEnvironment>,
): Promise<Response | undefined> => {
    const referer = context.req.header('referer');
    const token = getCookie(context, 'shuttle_preview');
    if (!referer || !token) {
        return undefined;
    }
    const session = await getPreviewSession(
        context.var.runtime.database,
        context.var.runtime.previewTokenSecret,
        token,
    );
    if (!session || !isPreviewReferer(
        context.req.url,
        referer,
        session.previewServiceId,
    )) {
        return undefined;
    }
    return forwardPreviewRequest(
        context,
        undefined,
        session.previewServiceId,
        session.access,
    );
};
