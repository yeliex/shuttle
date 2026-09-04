#!/usr/bin/env node

import { CodexAppServer } from './codex-host.js';
import { serveDaemon } from './daemon.js';
import { getCompanionRuntime } from './index.js';
import { serveMcp } from './mcp.js';

const command = process.argv[2];

if (command === 'health') {
    process.stdout.write(`${JSON.stringify({
        status: 'ok',
        runtime: getCompanionRuntime(),
    })}\n`);
} else if (command === 'serve') {
    await serveDaemon();
} else if (command === 'mcp') {
    await serveMcp();
} else if (command === 'probe') {
    const sourceThreadId = process.env.CODEX_THREAD_ID ?? process.env.CODEX_SESSION_ID;

    if (!sourceThreadId) {
        throw new Error('CODEX_THREAD_ID or CODEX_SESSION_ID is required for the probe');
    }

    const session = new CodexAppServer();
    try {
        await session.readThread(sourceThreadId);
    } finally {
        await session.close();
    }
    process.stdout.write(`${JSON.stringify({ status: 'ok', tool: 'read_thread' })}\n`);
} else {
    process.stdout.write('Usage: shuttle-companion <health|serve|mcp|probe>\n');
}
