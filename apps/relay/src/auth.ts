import { prismaAdapter } from '@better-auth/prisma-adapter';
import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins';

import type { RelayDatabase } from './database.js';
import {
    createMagicLinkEmailContent,
    createVerificationEmailContent,
    type SendEmail,
} from './mail.js';

export const AUTH_PROVIDER_EMAIL_PASSWORD = 'email-password';
export const AUTH_PROVIDER_GITHUB = 'github';

export type AuthProvider =
    | typeof AUTH_PROVIDER_EMAIL_PASSWORD
    | typeof AUTH_PROVIDER_GITHUB;

export interface AuthConfiguration {
    allowedDomains: string[];
    baseURL: string;
    githubClientId?: string;
    githubClientSecret?: string;
    ipAddressHeaders?: string[];
    openRegistration: boolean;
    providers: AuthProvider[];
    secret: string;
    sendEmail?: SendEmail;
}

export interface ShuttleAuth {
    api: {
        getSession: (input: { headers: Headers }) => Promise<{
            user: { id: string };
        } | null>;
        setPassword: (input: {
            body: { newPassword: string };
            headers: Headers;
        }) => Promise<unknown>;
    };
    handler: (request: Request) => Promise<Response>;
}

export const parseAuthProviders = (value: string | undefined): AuthProvider[] => {
    if (!value) {
        return [AUTH_PROVIDER_EMAIL_PASSWORD];
    }

    const parsed: unknown = value.trim().startsWith('[')
        ? JSON.parse(value)
        : value.split(',').map((provider) => provider.trim()).filter(Boolean);

    if (!Array.isArray(parsed)
        || parsed.some((provider) => (
            provider !== AUTH_PROVIDER_EMAIL_PASSWORD && provider !== AUTH_PROVIDER_GITHUB
        ))) {
        throw new Error('AUTH_PROVIDERS must contain only "email-password" or "github"');
    }

    if (parsed.length === 0) {
        throw new Error('AUTH_PROVIDERS must enable at least one login method');
    }

    return [...new Set(parsed)] as AuthProvider[];
};

export const parseAdminEmails = (value: string | undefined): string[] => {
    if (!value) {
        return [];
    }
    const parsed: unknown = value.trim().startsWith('[')
        ? JSON.parse(value)
        : value.split(',').map((email) => email.trim()).filter(Boolean);
    if (!Array.isArray(parsed)
        || parsed.some((email) => typeof email !== 'string' || !email.includes('@'))) {
        throw new Error('ADMIN_EMAILS must contain email addresses');
    }
    return [...new Set(parsed.map((email) => email.toLowerCase()))];
};

export const parseAllowedDomains = (value: string | undefined): string[] => {
    if (!value) {
        return [];
    }
    const domains = value.split(',')
        .map((domain) => domain.trim().toLowerCase().replace(/^@/u, ''))
        .filter(Boolean);
    if (domains.some((domain) => !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(domain))) {
        throw new Error('AUTH_PROVIDER_ALLOWED_DOMAINS must contain comma-separated domains');
    }
    return [...new Set(domains)];
};

export const parseOpenRegistration = (value: string | undefined): boolean => {
    if (value === undefined || value === '') {
        return true;
    }
    if (value === 'true') {
        return true;
    }
    if (value === 'false') {
        return false;
    }
    throw new Error('OPEN_REGISTRATION must be "true" or "false"');
};

export const isEmailAllowed = (email: string, allowedDomains: string[]): boolean => {
    if (allowedDomains.length === 0) {
        return true;
    }
    const separator = email.lastIndexOf('@');
    return separator > 0
        && allowedDomains.includes(email.slice(separator + 1).toLowerCase());
};

export const createAuth = (
    database: RelayDatabase,
    configuration: AuthConfiguration,
): ShuttleAuth => {
    if (!configuration.baseURL || !configuration.secret) {
        throw new Error('AUTH_BASE_URL and AUTH_SECRET are required');
    }
    if (configuration.secret.length < 32) {
        throw new Error('AUTH_SECRET must contain at least 32 characters');
    }

    const githubEnabled = configuration.providers.includes(AUTH_PROVIDER_GITHUB);
    const emailPasswordEnabled = configuration.providers.includes(AUTH_PROVIDER_EMAIL_PASSWORD);
    if (githubEnabled && (!configuration.githubClientId || !configuration.githubClientSecret)) {
        throw new Error('GitHub OAuth is enabled but its client credentials are missing');
    }

    return betterAuth({
        appName: 'Shuttle',
        basePath: '/api/auth',
        baseURL: configuration.baseURL,
        secret: configuration.secret,
        database: prismaAdapter(database, {
            provider: 'sqlite',
            transaction: false,
        }),
        databaseHooks: {
            session: {
                create: {
                    before: async (session) => {
                        const user = await database.user.findUnique({
                            where: { id: session.userId },
                            select: { disabledAt: true, email: true },
                        });
                        if (!user
                            || user.disabledAt
                            || !isEmailAllowed(user.email, configuration.allowedDomains)) {
                            return false;
                        }
                        return undefined;
                    },
                },
            },
        },
        user: {
            validateUserInfo: ({ source, user }) => {
                const email = typeof user.email === 'string' ? user.email : undefined;
                if (!email || !isEmailAllowed(email, configuration.allowedDomains)) {
                    return {
                        error: 'email_domain_not_allowed',
                        errorDescription: 'This email domain is not allowed by this Shuttle Relay',
                    };
                }
                if (!configuration.openRegistration && source.action === 'create-user') {
                    return {
                        error: 'registration_closed',
                        errorDescription: 'Registration is managed by this Shuttle Relay administrator',
                    };
                }
                return undefined;
            },
        },
        emailAndPassword: {
            disableSignUp: true,
            enabled: emailPasswordEnabled,
        },
        emailVerification: configuration.sendEmail
            ? {
                expiresIn: 60 * 60,
                sendVerificationEmail: async ({ user, url }) => {
                    const content = createVerificationEmailContent(url);
                    await configuration.sendEmail?.({ ...content, recipient: user.email });
                },
            }
            : undefined,
        plugins: emailPasswordEnabled && configuration.sendEmail
            ? [magicLink({
                disableSignUp: !configuration.openRegistration,
                expiresIn: 15 * 60,
                sendMagicLink: async ({ email, url }) => {
                    const content = createMagicLinkEmailContent(url);
                    await configuration.sendEmail?.({ ...content, recipient: email });
                },
                storeToken: 'hashed',
            })]
            : [],
        socialProviders: githubEnabled
            ? {
                github: {
                    clientId: configuration.githubClientId!,
                    clientSecret: configuration.githubClientSecret!,
                },
            }
            : {},
        advanced: {
            cookiePrefix: 'shuttle',
            ipAddress: {
                ipAddressHeaders: configuration.ipAddressHeaders,
            },
        },
    });
};
