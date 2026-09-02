import type { AuthProvider, ShuttleAuth } from './auth.js';
import type { RelayDatabase } from './database.js';
import type { RelayBindings } from './env.js';
import type { SendEmail } from './mail.js';

export type Principal = {
    deviceId: string;
    kind: 'device';
    userId: string;
} | {
    kind: 'session';
    userId: string;
};

export interface RelayRuntime {
    adminEmails: string[];
    allowedDomains: string[];
    auth: ShuttleAuth;
    authProviders: AuthProvider[];
    baseURL: string;
    database: RelayDatabase;
    deliverMessage?: (
        deviceId: string,
        codexThreadId: string,
        prompt: string,
    ) => Promise<void>;
    readThread?: (deviceId: string, codexThreadId: string) => Promise<unknown>;
    isDeviceOnline?: (deviceId: string) => Promise<boolean>;
    openRegistration: boolean;
    previewTokenSecret: string;
    disconnectDevice?: (deviceId: string) => Promise<void>;
    closePreviewConnections?: (
        deviceId: string,
        previewServiceId: string,
    ) => Promise<void>;
    proxyPreviewRequest?: (
        deviceId: string,
        previewServiceId: string,
        targetURL: string,
        request: {
            bodyBase64?: string;
            headers: [string, string][];
            method: string;
        },
    ) => Promise<Response>;
    dispose?: () => Promise<void>;
    sendEmail?: SendEmail;
}

export interface RelayHonoEnvironment {
    Bindings: RelayBindings;
    Variables: {
        principal: Principal;
        runtime: RelayRuntime;
    };
}
