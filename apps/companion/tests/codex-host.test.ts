import { strict as assert } from 'node:assert';
import { chmod, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { CodexAppServer, discoverCodexExecutable } from '../src/codex-host.js';

const fixture = async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shuttle-app-server-'));
    const executable = join(directory, 'codex.mjs');
    const log = join(directory, 'calls.jsonl');
    const install = async (version: string) => {
        const staged = `${executable}.new`;
        await writeFile(staged, `#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const version = ${JSON.stringify(version)};
const log = value => appendFileSync(${JSON.stringify(log)}, JSON.stringify(value) + '\\n');
log({ event: 'start', pid: process.pid, version, args: process.argv.slice(2) });
const write = (id, result) => process.stdout.write(JSON.stringify({ id, result }) + '\\n');
createInterface({ input: process.stdin }).on('line', line => {
    const request = JSON.parse(line);
    log({ event: 'request', method: request.method, threadId: request.params?.threadId });
    if (request.method === 'initialize') {
        if (request.params.capabilities.experimentalApi !== true) process.exit(1);
        write(request.id, version === 'incompatible' ? {} : { userAgent: version, codexHome: '/test' });
    } else if (request.method === 'thread/read') {
        if (request.params.includeTurns !== false) process.exit(2);
        if (request.params.threadId === 'missing') {
            process.stdout.write(JSON.stringify({ id: request.id, error: { code: -32600, message: 'PRIVATE_ERROR_SENTINEL' } }) + '\\n');
        } else write(request.id, { thread: { id: request.params.threadId, pid: process.pid, version } });
    } else if (request.method === 'thread/turns/list') {
        const p = request.params;
        if (p.itemsView !== 'full' || p.sortDirection !== 'asc') process.exit(3);
        write(request.id, { data: [{ id: p.cursor ? 'second' : 'first', items: [{ output: 'complete' }] }], nextCursor: p.threadId === 'loop' || !p.cursor ? 'page-2' : null });
    } else if (request.method === 'thread/queue/add') {
        if (version === 'read-only') {
            process.stdout.write(JSON.stringify({ id: request.id, error: { code: -32601, message: 'Unknown method' } }) + '\\n');
            return;
        }
        log({ event: 'enqueued' });
        const text = request.params.input[0].text;
        if (text === 'drop') { process.stderr.write('PRIVATE_ERROR_SENTINEL'); process.exit(0); }
        if (text === 'timeout') return;
        setTimeout(() => write(request.id, { queuedSubmission: { id: 'queued-' + version } }), text === 'slow' ? 150 : 0);
    } else if (request.method !== 'initialized') process.exit(4);
});
`);
        await chmod(staged, 0o700);
        await rename(staged, executable);
    };
    await install('v1');
    const calls = async () => (await readFile(log, 'utf8')).trim().split('\n').map((line) => (
        JSON.parse(line) as { event: string; pid: number; version: string; args: string[]; method: string; threadId?: string }
    ));
    return { directory, executable, install, calls };
};

test('并发请求复用 stdio 连接，完整分页只读取指定任务，发送仅入队', async () => {
    const fake = await fixture();
    const server = new CodexAppServer({ executable: async () => fake.executable, checkIntervalMilliseconds: 0 });
    try {
        const results = await Promise.all([server.readThread('one'), server.readThread('two')]);
        assert.equal(results[0]?.thread.pid, results[1]?.thread.pid);
        const history = await server.readCompleteThread('one') as { turns: unknown[] };
        assert.deepEqual(history.turns, [
            { id: 'first', items: [{ output: 'complete' }] },
            { id: 'second', items: [{ output: 'complete' }] },
        ]);
        assert.deepEqual(await server.sendMessage('two', 'hello'), {
            status: 'queued', threadId: 'two', queuedSubmissionId: 'queued-v1',
        });
        const calls = await fake.calls();
        assert.equal(calls.filter((call) => call.event === 'start').length, 1);
        assert.deepEqual(calls[0]?.args, ['app-server', '--listen', 'stdio://']);
        assert.ok(calls.every((call) => !['thread/resume', 'turn/start', 'thread/list'].includes(call.method)));
        assert.ok(calls.filter((call) => call.method === 'thread/turns/list').every((call) => call.threadId === 'one'));
        await assert.rejects(server.readThread('missing'), /history is unavailable/u);
        await assert.rejects(server.readCompleteThread('loop'), /history is unavailable/u);
    } finally { await server.close(); await rm(fake.directory, { recursive: true, force: true }); }
});

test('更新安装包等待在途发送结束，重新握手且旧进程已退出', async () => {
    const fake = await fixture();
    const server = new CodexAppServer({ executable: async () => fake.executable, checkIntervalMilliseconds: 0 });
    try {
        const first = await server.readThread('one');
        const send = server.sendMessage('one', 'slow');
        // 观察到请求已写入后才模拟安装替换，避免用调度时间猜测竞态。
        while (!(await fake.calls()).some((call) => call.event === 'enqueued')) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        await fake.install('v2');
        const next = server.readThread('one');
        assert.deepEqual(await send, { status: 'queued', threadId: 'one', queuedSubmissionId: 'queued-v1' });
        const second = await next;
        assert.equal(second.thread.version, 'v2');
        assert.notEqual(first.thread.pid, second.thread.pid);
        assert.throws(() => process.kill(Number(first.thread.pid), 0));
        assert.equal((await fake.calls()).filter((call) => call.event === 'enqueued').length, 1);
    } finally { await server.close(); await rm(fake.directory, { recursive: true, force: true }); }
});

test('发送后连接退出不重放消息，后续读取恢复且错误不含正文', async () => {
    const fake = await fixture();
    const server = new CodexAppServer({ executable: async () => fake.executable, checkIntervalMilliseconds: 0 });
    try {
        await assert.rejects(server.sendMessage('one', 'drop'), (error: Error) => {
            assert.match(error.message, /result is unknown/u);
            assert.doesNotMatch(error.message, /PRIVATE_ERROR_SENTINEL/u);
            return true;
        });
        const result = await server.readThread('one');
        assert.equal(result.thread.id, 'one');
        const calls = await fake.calls();
        assert.equal(calls.filter((call) => call.event === 'enqueued').length, 1);
        assert.equal(calls.filter((call) => call.event === 'start').length, 2);
    } finally { await server.close(); await rm(fake.directory, { recursive: true, force: true }); }
});

test('入队响应超时不自动重发，关闭后不能重新启动', async () => {
    const fake = await fixture();
    const server = new CodexAppServer({ executable: async () => fake.executable, timeoutMilliseconds: 1_500, checkIntervalMilliseconds: 0 });
    try {
        await assert.rejects(server.sendMessage('one', 'timeout'), /result is unknown/u);
        assert.equal((await server.readThread('one')).thread.id, 'one');
        assert.equal((await fake.calls()).filter((call) => call.event === 'enqueued').length, 1);
        await server.close();
        await assert.rejects(server.readThread('one'), /stopped/u);
    } finally { await server.close(); await rm(fake.directory, { recursive: true, force: true }); }
});

test('安装暂时缺失时明确失败，路径变化后不重启 Companion 即可恢复', async () => {
    const fake = await fixture();
    let path = join(fake.directory, 'missing');
    const server = new CodexAppServer({ executable: async () => path, checkIntervalMilliseconds: 0 });
    try {
        await assert.rejects(discoverCodexExecutable({ SHUTTLE_CODEX_PATH: path }), /unavailable/u);
        await assert.rejects(server.start(), /unavailable/u);
        path = fake.executable;
        assert.equal(await discoverCodexExecutable({ SHUTTLE_CODEX_PATH: path }), path);
        assert.equal((await server.readThread('one')).thread.version, 'v1');
        const moved = join(fake.directory, 'moved.mjs');
        await rename(path, moved);
        await assert.rejects(server.readThread('one'), /unavailable/u);
        path = moved;
        assert.equal((await server.readThread('one')).thread.id, 'one');
    } finally { await server.close(); await rm(fake.directory, { recursive: true, force: true }); }
});

test('后台自动恢复退出的子进程，不需要先调用工具；关闭时清理子进程', { timeout: 10_000 }, async () => {
    const fake = await fixture();
    const server = new CodexAppServer({ executable: async () => fake.executable, checkIntervalMilliseconds: 25 });
    try {
        await server.start();
        const original = (await fake.calls()).find((call) => call.event === 'start')!;
        process.kill(original.pid, 'SIGTERM');
        while ((await fake.calls()).filter((call) => call.event === 'start').length < 2) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        const restarted = (await fake.calls()).filter((call) => call.event === 'start')[1]!;
        assert.notEqual(original.pid, restarted.pid);
        assert.throws(() => process.kill(original.pid, 0));
        await server.close();
        assert.throws(() => process.kill(restarted.pid, 0));
    } finally { await server.close(); await rm(fake.directory, { recursive: true, force: true }); }
});

test('握手或入队 API 不兼容时明确失败，不回退到执行任务的 API', async () => {
    const fake = await fixture();
    const server = new CodexAppServer({ executable: async () => fake.executable, checkIntervalMilliseconds: 0 });
    try {
        await fake.install('incompatible');
        await assert.rejects(server.start(), /initialization failed/u);
        await fake.install('read-only');
        await assert.rejects(server.sendMessage('one', 'hello'), /was not retried/u);
        assert.equal((await server.readThread('one')).thread.id, 'one');
        const calls = await fake.calls();
        assert.equal(calls.filter((call) => call.method === 'thread/queue/add').length, 1);
        assert.ok(calls.every((call) => !['thread/resume', 'turn/start', 'thread/queue/start'].includes(call.method)));
    } finally { await server.close(); await rm(fake.directory, { recursive: true, force: true }); }
});
