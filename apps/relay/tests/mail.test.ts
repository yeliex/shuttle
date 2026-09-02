import { strict as assert } from 'node:assert';
import { createServer } from 'node:net';
import { test } from 'node:test';

import { createNodeMailer } from '../src/mail-node.js';
import {
    createInviteEmailContent,
    createMagicLinkEmailContent,
    createVerificationEmailContent,
    parseSmtpConfiguration,
} from '../src/mail.js';

test('does not enable SMTP without SMTP settings', () => {
    assert.equal(parseSmtpConfiguration({}), undefined);
});

test('validates partial SMTP settings', () => {
    assert.throws(
        () => parseSmtpConfiguration({ SMTP_HOST: 'smtp.example.com' }),
        /SMTP_HOST and SMTP_FROM/,
    );
    assert.throws(
        () => parseSmtpConfiguration({
            SMTP_FROM: 'shuttle@example.com',
            SMTP_HOST: 'smtp.example.com',
            SMTP_USERNAME: 'shuttle',
        }),
        /SMTP_USERNAME and SMTP_PASSWORD/,
    );
});

test('escapes user-controlled values in invitation HTML', () => {
    const content = createInviteEmailContent({
        canPreview: false,
        expiresAt: new Date('2026-09-02T00:00:00.000Z'),
        inviteURL: 'https://shuttle.example/app/invite/token',
        ownerName: '<Owner>',
        permission: 'read',
        recipient: 'guest@example.com',
        resourceTitle: '<Task>',
    });

    assert.match(content.html, /&lt;Owner&gt;/);
    assert.match(content.html, /&lt;Task&gt;/);
    assert.doesNotMatch(content.html, /<Owner>/);
});

test('renders a task invitation with local service access', () => {
    const content = createInviteEmailContent({
        canPreview: true,
        expiresAt: new Date('2026-09-02T00:00:00.000Z'),
        inviteURL: 'https://shuttle.example/app/invite#token',
        ownerName: 'Owner',
        permission: 'read',
        recipient: 'guest@example.com',
        resourceTitle: 'Shared task',
    });

    assert.equal(content.subject, 'Owner invited you to a Shuttle task');
    assert.match(content.text, /open its shared local services/);
});

test('renders account authentication emails', () => {
    const magicLink = createMagicLinkEmailContent('https://shuttle.example/api/auth/magic-link/verify?token=test');
    const verification = createVerificationEmailContent('https://shuttle.example/api/auth/verify-email?token=test');

    assert.equal(magicLink.subject, 'Sign in to Shuttle');
    assert.match(magicLink.text, /expires in 15 minutes/);
    assert.equal(verification.subject, 'Verify your Shuttle email');
    assert.match(verification.text, /expires in one hour/);
});

test('sends an invitation through a configured SMTP server', async () => {
    const messages: string[] = [];
    const server = createServer((socket) => {
        socket.setEncoding('utf8');
        socket.write('220 localhost ESMTP\r\n');

        let buffer = '';
        let data = '';
        let receivingData = false;
        socket.on('data', (chunk) => {
            buffer += chunk;
            let lineEnd = buffer.indexOf('\n');
            while (lineEnd !== -1) {
                const line = buffer.slice(0, lineEnd + 1);
                buffer = buffer.slice(lineEnd + 1);

                if (receivingData) {
                    if (line === '.\r\n' || line === '.\n') {
                        messages.push(data);
                        socket.end('250 queued\r\n');
                        receivingData = false;
                    } else {
                        data += line;
                    }
                } else if (/^EHLO /i.test(line)) {
                    socket.write('250-localhost\r\n250 PIPELINING\r\n');
                } else if (/^(MAIL FROM|RCPT TO):/i.test(line)) {
                    socket.write('250 ok\r\n');
                } else if (/^DATA/i.test(line)) {
                    receivingData = true;
                    socket.write('354 end with dot\r\n');
                }

                lineEnd = buffer.indexOf('\n');
            }
        });
    });
    server.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));

    try {
        const address = server.address();
        assert(address && typeof address !== 'string');
        const mailer = createNodeMailer({
            from: { email: 'shuttle@example.com', name: 'Shuttle' },
            host: '127.0.0.1',
            port: address.port,
            security: 'none',
        });
        assert(mailer);

        const content = createInviteEmailContent({
            canPreview: false,
            expiresAt: new Date('2026-09-02T00:00:00.000Z'),
            inviteURL: 'https://shuttle.example/app/invite/test-token',
            ownerName: 'Owner',
            permission: 'message',
            recipient: 'guest@example.com',
            resourceTitle: 'Shared task',
        });
        await mailer({ ...content, recipient: 'guest@example.com' });
    } finally {
        server.close();
        await new Promise<void>((resolve) => server.once('close', resolve));
    }

    assert.equal(messages.length, 1);
    const message = messages[0]!.replaceAll('=\r\n', '');
    assert.match(message, /Subject: Owner invited you to a Shuttle task/);
    assert.match(message, /https:\/\/shuttle\.example\/app\/invite\/test-token/);
});
