import type { SharePermission } from '@shuttle/contracts';

import { jsonRequest, requestJson, requestVoid } from './fetch.ts';

export interface User {
    email: string;
    id: string;
    image: string | null;
    name: string;
}

export interface MeResponse {
    githubConnected: boolean;
    hasPassword: boolean;
    isAdmin: boolean;
    user: User & { emailVerified: boolean };
}

export interface AdminOverview {
    metrics: {
        activeDevices: number;
        previewServices: number;
        sharedThreads: number;
        users: number;
    };
    users: Array<User & {
        createdAt: string;
        disabledAt: string | null;
        isAdmin: boolean;
        _count: {
            devices: number;
            ownedPreviewServices: number;
            ownedThreads: number;
        };
    }>;
}

export interface ConfigResponse {
    allowedDomains: string[];
    authProviders: Array<'email-password' | 'github'>;
    openRegistration: boolean;
    smtpConfigured: boolean;
}

export interface Device {
    createdAt: string;
    id: string;
    lastSeenAt: string;
    name: string;
    online: boolean;
    revokedAt: string | null;
}

export interface SharedThreadSummary {
    canPreview: boolean;
    grantCount?: number;
    createdAt: string;
    device?: { name: string };
    deviceId?: string;
    id: string;
    owner: Pick<User, 'image' | 'name'>;
    ownerId: string;
    permission: SharePermission | 'owner';
    previewServices: ThreadPreviewService[];
    title: string | null;
    updatedAt: string;
}

export interface ThreadPreviewService {
    id: string;
    name: string;
    port: number;
    updatedAt: string;
}

export interface ShareGrant {
    id: string;
    email: string;
    canPreview: boolean;
    permission: SharePermission;
    updatedAt: string;
    user: User | null;
}

export interface ShareInvite {
    acceptedAt: string | null;
    createdAt: string;
    expiresAt: string | null;
    id: string;
    inviteURL: string | null;
    canPreview: boolean;
    permission: SharePermission;
    restricted: boolean;
    singleUse: boolean;
}

export interface SharedThreadDetail extends SharedThreadSummary {
    expiresAt: string | null;
    grants?: ShareGrant[];
    invites?: ShareInvite[];
    owner: User;
    content?: unknown;
}

export interface CreateInviteResult {
    emailDelivery: 'failed' | 'not-configured' | 'not-requested' | 'sent';
    error?: string;
    failedEmails?: string[];
    invite: Pick<ShareInvite, 'canPreview' | 'expiresAt' | 'id' | 'permission'>;
    inviteURL: string;
    token: string;
}

export interface InspectInviteResult {
    invite: {
        canPreview: boolean;
        expiresAt: string | null;
        permission: SharePermission;
        recipientEmailBound: boolean;
        hasAccess: boolean;
        singleUse: boolean;
        sharedThread: {
            id: string;
            owner: Pick<User, 'image' | 'name'>;
            title: string | null;
        };
    };
}

export const searchRecipients = (query: string) => requestJson<{ users: Pick<User, 'email' | 'name'>[] }>(
    `/api/shared-threads/recipients?q=${encodeURIComponent(query)}`,
);

export interface PreviewServiceSummary {
    createdAt: string;
    device?: { name: string; revokedAt: string | null };
    id: string;
    name: string;
    owner: Pick<User, 'image' | 'name'>;
    ownerId: string;
    permission: 'owner' | 'view';
    port: number;
    sharedThread: { title: string | null };
    sharedThreadId: string;
    updatedAt: string;
}

export const createInvite = (
    sharedThreadId: string,
    body: { canPreview: boolean; emails: string[]; expiresInHours?: number | null; permission: SharePermission; singleUse: boolean },
) => requestJson<CreateInviteResult>(
    `/api/shared-threads/${encodeURIComponent(sharedThreadId)}/invites`,
    jsonRequest(body, { method: 'POST' }),
);

export const inspectInvite = (token: string) => requestJson<InspectInviteResult>(
    '/api/invites/inspect',
    jsonRequest({ token }, { method: 'POST' }),
);

export const acceptInvite = (token: string) => requestJson<{ sharedThreadId: string }>(
    '/api/invites/accept',
    jsonRequest({ token }, { method: 'POST' }),
);

export const updateGrant = (
    sharedThreadId: string,
    grantId: string,
    body: { canPreview: boolean; permission: SharePermission },
) => requestJson<{ grant: { canPreview: boolean; permission: SharePermission; id: string } }>(
    `/api/shared-threads/${encodeURIComponent(sharedThreadId)}/grants/${encodeURIComponent(grantId)}`,
    jsonRequest(body, { method: 'PUT' }),
);

export const revokeGrant = (sharedThreadId: string, grantId: string) => requestVoid(
    `/api/shared-threads/${encodeURIComponent(sharedThreadId)}/grants/${encodeURIComponent(grantId)}`,
    { method: 'DELETE' },
);

export const deleteSharedThread = (sharedThreadId: string) => requestVoid(
    `/api/shared-threads/${encodeURIComponent(sharedThreadId)}`,
    { method: 'DELETE' },
);

export const leaveSharedThread = (sharedThreadId: string) => requestVoid(
    `/api/shared-threads/${encodeURIComponent(sharedThreadId)}/grants/me`,
    { method: 'DELETE' },
);

export const setUserDisabled = (userId: string, disabled: boolean) => requestJson<{
    user: { disabledAt: string | null; id: string };
}>(
    `/api/admin/users/${encodeURIComponent(userId)}`,
    jsonRequest({ disabled }, { method: 'PATCH' }),
);

export const createAdminUser = (body: {
    email: string;
    name: string;
}) => requestJson<{ user: User & { createdAt: string; disabledAt: string | null } }>(
    '/api/admin/users',
    jsonRequest(body, { method: 'POST' }),
);

export const identifyAccount = (email: string) => requestJson<{
    next: 'magic-link' | 'password' | 'unavailable';
}>(
    '/api/account/identify',
    jsonRequest({ email }, { method: 'POST' }),
);

export const setInitialPassword = (newPassword: string) => requestJson<{
    passwordSet: true;
}>(
    '/api/account/password',
    jsonRequest({ newPassword }, { method: 'POST' }),
);

export const revokeInvite = (sharedThreadId: string, inviteId: string) => requestVoid(
    `/api/shared-threads/${encodeURIComponent(sharedThreadId)}/invites/${encodeURIComponent(inviteId)}`,
    { method: 'DELETE' },
);

export const revokeDevice = (deviceId: string) => requestVoid(
    `/api/devices/${encodeURIComponent(deviceId)}`,
    { method: 'DELETE' },
);

export const createDevice = (name: string) => requestJson<{
    device: Pick<Device, 'createdAt' | 'id' | 'name'>;
    token: string;
}>(
    '/api/devices',
    jsonRequest({ name }, { method: 'POST' }),
);

export const openPreviewSession = (previewServiceId: string) => requestJson<{
    expiresAt: string;
    previewURL: string;
}>(
    `/api/preview-services/${encodeURIComponent(previewServiceId)}/session`,
    { method: 'POST' },
);

export const deletePreviewService = (previewServiceId: string) => requestVoid(
    `/api/preview-services/${encodeURIComponent(previewServiceId)}`,
    { method: 'DELETE' },
);
