import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('plugin inherits the Codex Desktop host environment', async () => {
    const config = JSON.parse(await readFile(
        new URL('../../../plugins/shuttle/.mcp.json', import.meta.url),
        'utf8',
    )) as {
        mcpServers: {
            shuttle: { env_vars?: string[] };
        };
    };

    assert.deepEqual(config.mcpServers.shuttle.env_vars, [
        'CODEX_APP_TOOLS_PIPE_PATH',
        'CODEX_MCP_NODE_PATH',
    ]);
});

test('initializes and lists tools before Codex provides task metadata', async () => {
    const environment = { ...process.env };
    delete environment.CODEX_THREAD_ID;
    delete environment.CODEX_SESSION_ID;

    const child = spawn(
        process.execPath,
        ['--import', 'tsx', fileURLToPath(new URL('../src/cli.ts', import.meta.url)), 'mcp'],
        { env: environment },
    );
    const lines = createInterface({ input: child.stdout });
    const responses = lines[Symbol.asyncIterator]();
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
    });

    const request = async (message: object): Promise<Record<string, unknown>> => {
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
        const response = await responses.next();
        assert.equal(response.done, false, stderr);
        return JSON.parse(response.value) as Record<string, unknown>;
    };

    try {
        const initialize = await request({
            id: 1,
            method: 'initialize',
            params: {
                capabilities: {},
                clientInfo: { name: 'shuttle-test', version: '1' },
                protocolVersion: '2025-06-18',
            },
        });
        assert.equal(initialize.jsonrpc, '2.0');
        assert.equal(initialize.id, 1);

        const list = await request({ id: 2, method: 'tools/list', params: {} });
        const tools = (list.result as { tools: Array<{ name: string }> }).tools;
        assert.equal(tools[0]?.name, 'share_thread');

        const call = await request({
            id: 3,
            method: 'tools/call',
            params: { arguments: {}, name: 'list_shared_threads' },
        });
        assert.equal((call.result as { isError: boolean }).isError, true);
        assert.match(
            (call.result as { content: Array<{ text: string }> }).content[0]?.text ?? '',
            /task metadata/u,
        );
    } finally {
        child.stdin.end();
        await once(child, 'exit');
        lines.close();
    }
});
