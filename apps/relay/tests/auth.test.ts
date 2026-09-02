import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
    isEmailAllowed,
    parseAdminEmails,
    parseAllowedDomains,
    parseAuthProviders,
    parseOpenRegistration,
} from '../src/auth.js';

test('parses login providers from comma-separated configuration', () => {
    assert.deepEqual(
        parseAuthProviders('email-password, github, email-password'),
        ['email-password', 'github'],
    );
});

test('parses admin emails from JSON or comma-separated configuration', () => {
    assert.deepEqual(
        parseAdminEmails('["Admin@Example.com", "ops@example.com"]'),
        ['admin@example.com', 'ops@example.com'],
    );
    assert.deepEqual(
        parseAdminEmails('Admin@Example.com, admin@example.com'),
        ['admin@example.com'],
    );
});

test('rejects invalid admin email configuration', () => {
    assert.throws(() => parseAdminEmails('["not-an-email"]'));
});

test('parses registration and domain restrictions', () => {
    assert.equal(parseOpenRegistration(undefined), true);
    assert.equal(parseOpenRegistration('false'), false);
    assert.throws(() => parseOpenRegistration('yes'));
    assert.deepEqual(
        parseAllowedDomains('Example.com, @team.example.com, example.com'),
        ['example.com', 'team.example.com'],
    );
    assert.throws(() => parseAllowedDomains('https://example.com'));
    assert.equal(isEmailAllowed('member@example.com', ['example.com']), true);
    assert.equal(isEmailAllowed('member@other.example', ['example.com']), false);
    assert.equal(isEmailAllowed('member@other.example', []), true);
});
