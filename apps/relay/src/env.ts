export interface RelayBindings {
    ADMIN_EMAILS?: string;
    ASSETS: Fetcher;
    AUTH_BASE_URL: string;
    AUTH_PROVIDER_ALLOWED_DOMAINS?: string;
    AUTH_PROVIDERS: string;
    AUTH_SECRET: string;
    DB: D1Database;
    GITHUB_CLIENT_ID?: string;
    GITHUB_CLIENT_SECRET?: string;
    OPEN_REGISTRATION?: string;
    PREVIEW_HUB: DurableObjectNamespace;
    SMTP_FROM?: string;
    SMTP_FROM_NAME?: string;
    SMTP_HOST?: string;
    SMTP_PASSWORD?: string;
    SMTP_PORT?: string;
    SMTP_SECURITY?: string;
    SMTP_USERNAME?: string;
    THREAD_HUB: DurableObjectNamespace;
}
