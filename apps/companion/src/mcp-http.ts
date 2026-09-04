import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';

import { createMcpSession, getSourceThreadId, tools } from './mcp.js';
import { getCompanionDirectory } from './paths.js';

export const MCP_HTTP_PORT = 19846;

// 独立的本机凭据，不复用 Relay token。跨 Companion 更新保留，Codex 无需重新配置。
export const getMcpAuthorization = async (): Promise<string> => {
    const directory = getCompanionDirectory();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, 'mcp-headers.json');
    try {
        await writeFile(path, JSON.stringify({ Authorization: `Bearer ${randomBytes(32).toString('base64url')}` }), { flag: 'wx', mode: 0o600 });
    } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    }
    const stat = await lstat(path);
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
        throw new Error('Shuttle MCP credentials must be an owner-only regular file');
    }
    const headers = JSON.parse(await readFile(path, 'utf8')) as { Authorization?: unknown };
    if (typeof headers.Authorization !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/u.test(headers.Authorization)) {
        throw new Error('Invalid Shuttle MCP credentials');
    }
    return headers.Authorization;
};

export const createMcpHttpServer = (authorization: string) => {
    const secret = Buffer.from(authorization);
    if (secret.length === 0) throw new Error('Shuttle MCP authentication is required');
    const sessions = new Map<string, ReturnType<typeof createMcpSession>>();
    const validator = new AjvJsonSchemaValidator();
    const validators = new Map(tools.map((tool) => [
        tool.name as string,
        validator.getValidator(structuredClone(tool.inputSchema)),
    ]));
    const server = createServer(async (request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        if (request.url !== '/mcp') { response.writeHead(404).end(); return; }
        // 仅供本机 Codex 使用，不对网页开放；Host 校验同时阻止 DNS rebinding。
        if (request.headers.origin !== undefined
            || request.headers.host !== `127.0.0.1:${request.socket.localPort}`) {
            response.writeHead(403).end(); return;
        }
        const provided = Buffer.from(request.headers.authorization ?? '');
        if (provided.length !== secret.length || !timingSafeEqual(provided, secret)) {
            response.writeHead(401).end(); return;
        }
        if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }).end(); return; }

        // 无状态 HTTP transport：重启后不需要恢复旧 MCP session，也不重放任何工具调用。
        const mcp = new Server({ name: 'shuttle', version: '1' }, { capabilities: { tools: {} } });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        response.once('close', () => { void mcp.close(); });
        mcp.setRequestHandler(ListToolsRequestSchema, () => ({ tools: structuredClone(tools) }));
        mcp.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
            const validate = validators.get(params.name);
            if (!validate) throw new Error('Unknown Shuttle tool');
            if (!validate(params.arguments ?? {}).valid) throw new Error('Invalid Shuttle tool arguments');
            const threadId = getSourceThreadId(params);
            let session = sessions.get(threadId);
            if (!session) {
                session = createMcpSession();
                sessions.set(threadId, session);
            }
            return session.call(params);
        });
        try {
            await mcp.connect(transport);
            await transport.handleRequest(request, response);
        } catch {
            if (!response.headersSent) response.writeHead(500).end();
            await mcp.close();
        }
    });
    server.on('close', () => {
        for (const session of sessions.values()) session.close();
        sessions.clear();
    });
    return server;
};
