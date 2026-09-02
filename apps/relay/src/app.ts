import { Hono, type MiddlewareHandler } from 'hono';

import { requirePrincipal } from './authentication.js';
import { devices } from './routes/devices.js';
import { admin } from './routes/admin.js';
import { account, publicAccount } from './routes/account.js';
import { invites, threads } from './routes/threads.js';
import { previewServices } from './routes/preview-services.js';
import { proxyPreviewRequest } from './preview-proxy.js';
import { publicAgentGuide } from './public-agent-guide.js';
import type { RelayBindings } from './env.js';
import type { RelayHonoEnvironment, RelayRuntime } from './runtime.js';

export type CreateRelayRuntime = (
    bindings: RelayBindings,
) => Promise<RelayRuntime> | RelayRuntime;

export const createRelay = (createRuntime: CreateRelayRuntime) => {
    const relay = new Hono<RelayHonoEnvironment>();

    relay.get('/Agents.md', (context) => {
        context.header('Cache-Control', 'public, max-age=300');
        context.header('Content-Type', 'text/plain; charset=UTF-8');
        return context.body(publicAgentGuide);
    });

    relay.get('/api/health', (context) => context.json({
        service: 'shuttle-relay',
        status: 'ok',
    }));

    const loadRuntime: MiddlewareHandler<RelayHonoEnvironment> = async (context, next) => {
        const runtime = await createRuntime(context.env);
        context.set('runtime', runtime);

        try {
            await next();
        } finally {
            await runtime.dispose?.();
        }
    };
    relay.use('/api/*', loadRuntime);
    relay.use('/preview/*', loadRuntime);

    relay.all('/preview/:previewServiceId', proxyPreviewRequest);
    relay.all('/preview/:previewServiceId/*', proxyPreviewRequest);

    relay.all('/api/auth/*', (context) => context.var.runtime.auth.handler(context.req.raw));
    relay.route('/api/account', publicAccount);
    relay.get('/api/config', (context) => context.json({
        allowedDomains: context.var.runtime.allowedDomains,
        authProviders: context.var.runtime.authProviders,
        openRegistration: context.var.runtime.openRegistration,
        smtpConfigured: Boolean(context.var.runtime.sendEmail),
    }));
    relay.use('/api/*', requirePrincipal);

    relay.get('/api/me', async (context) => {
        const user = await context.var.runtime.database.user.findUnique({
            where: { id: context.var.principal.userId },
            select: {
                accounts: { select: { password: true, providerId: true } },
                email: true,
                emailVerified: true,
                id: true,
                image: true,
                name: true,
            },
        });
        if (!user) {
            return context.json({ error: 'User not found' }, 404);
        }
        const { accounts, ...profile } = user;
        return context.json({
            githubConnected: accounts.some((entry) => entry.providerId === 'github'),
            hasPassword: accounts.some((entry) => (
                entry.providerId === 'credential' && entry.password !== null
            )),
            isAdmin: context.var.runtime.adminEmails.includes(user.email.toLowerCase()),
            user: profile,
        });
    });
    relay.get('/api/users', async (context) => {
        const query = context.req.query('query')?.trim();
        if (!query || query.length < 2 || query.length > 100) {
            return context.json({ error: 'query must contain between 2 and 100 characters' }, 400);
        }

        const users = await context.var.runtime.database.user.findMany({
            where: {
                id: { not: context.var.principal.userId },
                OR: [
                    { email: { contains: query } },
                    { name: { contains: query } },
                ],
            },
            orderBy: { name: 'asc' },
            select: { id: true, email: true, image: true, name: true },
            take: 20,
        });
        return context.json({ users });
    });

    relay.route('/api/devices', devices);
    relay.route('/api/account', account);
    relay.route('/api/admin', admin);
    relay.route('/api/shared-threads', threads);
    relay.route('/api/invites', invites);
    relay.route('/api/preview-services', previewServices);
    return relay;
};
