import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { createRelay } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import { createNodeDatabase } from '../src/database-node.js';
import type { OutboundEmail } from '../src/mail.js';
import type { RelayRuntime } from '../src/runtime.js';

const baseURL = 'http://localhost';
const password = 'Shuttle-test-password';
const secret = 'shuttle-test-secret-that-is-at-least-32-characters';

const sessionCookie = (response: Response): string => {
    const cookie = response.headers.getSetCookie()
        .find((value) => /^(?:__Secure-)?shuttle\.session_token=/u.test(value));
    assert.ok(cookie, 'Better Auth did not return a Shuttle session cookie');
    return cookie.split(';', 1)[0]!;
};

test('supports managed passwordless accounts, initial passwords, and account disabling', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'shuttle-auth-test-'));
    const databasePath = resolve(directory, 'shuttle.db');
    const sqlite = new DatabaseSync(databasePath);
    try {
        for (const migration of [
            '0001_init',
            '0002_preview',
            '0003_live_reads_account_status',
            '0004_thread_preview_access',
            '0005_public_invite_token',
            '0006_share_authorization',
        ]) {
            sqlite.exec(await readFile(
                resolve('prisma/migrations', migration, 'migration.sql'),
                'utf8',
            ));
        }
    } finally {
        sqlite.close();
    }

    const database = createNodeDatabase(`file:${databasePath}`);
    const outbox: OutboundEmail[] = [];
    const createRuntime = (openRegistration: boolean): RelayRuntime => {
        const allowedDomains = ['example.com'];
        const sendEmail = async (email: OutboundEmail) => {
            outbox.push(email);
        };
        return {
            adminEmails: ['admin@example.com'],
            allowedDomains,
            auth: createAuth(database, {
                allowedDomains,
                baseURL,
                openRegistration,
                providers: ['email-password'],
                secret,
                sendEmail,
            }),
            authProviders: ['email-password'],
            baseURL,
            database,
            openRegistration,
            previewTokenSecret: secret,
            sendEmail,
        };
    };

    const request = (
        app: ReturnType<typeof createRelay>,
        path: string,
        init: RequestInit = {},
    ) => app.request(path, {
        ...init,
        headers: {
            origin: baseURL,
            ...init.headers,
        },
    });

    const signInWithMagicLink = async (
        app: ReturnType<typeof createRelay>,
        email: string,
    ): Promise<string> => {
        outbox.length = 0;
        const sent = await request(app, '/api/auth/sign-in/magic-link', {
            body: JSON.stringify({
                callbackURL: '/',
                email,
                name: email.split('@', 1)[0],
            }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        });
        assert.equal(sent.status, 200, await sent.clone().text());
        assert.equal(outbox.length, 1);
        const loginURL = outbox[0]!.text.split('\n').find((line) => line.startsWith('http'));
        assert.ok(loginURL);
        const url = new URL(loginURL);
        const verified = await request(app, `${url.pathname}${url.search}`, {
            redirect: 'manual',
        });
        assert.equal(verified.status, 302, await verified.clone().text());
        return sessionCookie(verified);
    };

    try {
        await database.user.create({
            data: {
                email: 'admin@example.com',
                emailVerified: false,
                id: crypto.randomUUID(),
                name: 'Admin',
            },
        });

        const relay = createRelay(() => createRuntime(false));
        const adminIdentify = await request(relay, '/api/account/identify', {
            body: JSON.stringify({ email: 'admin@example.com' }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        });
        assert.deepEqual(await adminIdentify.json(), { next: 'magic-link' });
        const adminCookie = await signInWithMagicLink(relay, 'admin@example.com');

        const directSignUp = await request(relay, '/api/auth/sign-up/email', {
            body: JSON.stringify({
                email: 'blocked@example.com',
                name: 'Blocked',
                password,
            }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        });
        assert.equal(directSignUp.status, 400);

        const wrongDomain = await request(relay, '/api/admin/users', {
            body: JSON.stringify({
                email: 'outside@other.example',
                name: 'Outside',
            }),
            headers: {
                'content-type': 'application/json',
                cookie: adminCookie,
            },
            method: 'POST',
        });
        assert.equal(wrongDomain.status, 403);

        const created = await request(relay, '/api/admin/users', {
            body: JSON.stringify({
                email: 'member@example.com',
                name: 'Member',
            }),
            headers: {
                'content-type': 'application/json',
                cookie: adminCookie,
            },
            method: 'POST',
        });
        assert.equal(created.status, 201, await created.clone().text());
        const createdBody = await created.json() as { user: { id: string } };
        const storedMember = await database.user.findUnique({
            where: { id: createdBody.user.id },
            select: { accounts: true, emailVerified: true },
        });
        assert.deepEqual(storedMember, { accounts: [], emailVerified: false });

        const memberIdentify = await request(relay, '/api/account/identify', {
            body: JSON.stringify({ email: 'member@example.com' }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        });
        assert.deepEqual(await memberIdentify.json(), { next: 'magic-link' });
        const memberCookie = await signInWithMagicLink(relay, 'member@example.com');

        const profileBeforePassword = await request(relay, '/api/me', {
            headers: { cookie: memberCookie },
        });
        assert.equal(profileBeforePassword.status, 200);
        assert.deepEqual(await profileBeforePassword.json(), {
            githubConnected: false,
            hasPassword: false,
            isAdmin: false,
            user: {
                email: 'member@example.com',
                emailVerified: true,
                id: createdBody.user.id,
                image: null,
                name: 'Member',
            },
        });

        const passwordSet = await request(relay, '/api/account/password', {
            body: JSON.stringify({ newPassword: password }),
            headers: {
                'content-type': 'application/json',
                cookie: memberCookie,
            },
            method: 'POST',
        });
        assert.equal(passwordSet.status, 200, await passwordSet.clone().text());

        const passwordIdentify = await request(relay, '/api/account/identify', {
            body: JSON.stringify({ email: 'member@example.com' }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        });
        assert.deepEqual(await passwordIdentify.json(), { next: 'password' });
        const signIn = await request(relay, '/api/auth/sign-in/email', {
            body: JSON.stringify({
                email: 'member@example.com',
                password,
                rememberMe: true,
            }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        });
        assert.equal(signIn.status, 200, await signIn.clone().text());
        const passwordCookie = sessionCookie(signIn);

        const device = await request(relay, '/api/devices', {
            body: JSON.stringify({ name: 'Member device' }),
            headers: {
                'content-type': 'application/json',
                cookie: passwordCookie,
            },
            method: 'POST',
        });
        assert.equal(device.status, 201);
        const deviceBody = await device.json() as { token: string };

        const adminRejected = await request(relay, '/api/admin/overview', {
            headers: { cookie: passwordCookie },
        });
        assert.equal(adminRejected.status, 403);

        const disabled = await request(relay, `/api/admin/users/${createdBody.user.id}`, {
            body: JSON.stringify({ disabled: true }),
            headers: {
                'content-type': 'application/json',
                cookie: adminCookie,
            },
            method: 'PATCH',
        });
        assert.equal(disabled.status, 200);

        const browserRejected = await request(relay, '/api/me', {
            headers: { cookie: passwordCookie },
        });
        assert.equal(browserRejected.status, 401);
        const deviceRejected = await request(relay, '/api/devices', {
            headers: { authorization: `Bearer ${deviceBody.token}` },
        });
        assert.equal(deviceRejected.status, 401);

        const disabledIdentify = await request(relay, '/api/account/identify', {
            body: JSON.stringify({ email: 'member@example.com' }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        });
        assert.deepEqual(await disabledIdentify.json(), { next: 'unavailable' });

        const openRelay = createRelay(() => createRuntime(true));
        const newIdentify = await request(openRelay, '/api/account/identify', {
            body: JSON.stringify({ email: 'new@example.com' }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        });
        assert.deepEqual(await newIdentify.json(), { next: 'magic-link' });
        await signInWithMagicLink(openRelay, 'new@example.com');
        assert.ok(await database.user.findUnique({ where: { email: 'new@example.com' } }));

        const disallowedIdentify = await request(openRelay, '/api/account/identify', {
            body: JSON.stringify({ email: 'outside@other.example' }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        });
        assert.deepEqual(await disallowedIdentify.json(), { next: 'unavailable' });
    } finally {
        await database.$disconnect();
        await rm(directory, { force: true, recursive: true });
    }
});
