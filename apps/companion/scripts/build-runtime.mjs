import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const companionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDirectory = resolve(companionRoot, 'dist/runtime');

await mkdir(runtimeDirectory, { recursive: true });
await build({
    banner: {
        js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    },
    bundle: true,
    entryPoints: [resolve(companionRoot, 'src/cli.ts')],
    format: 'esm',
    legalComments: 'external',
    minify: true,
    outfile: resolve(runtimeDirectory, 'cli.mjs'),
    platform: 'node',
    target: 'node22',
});
await copyFile(
    resolve(companionRoot, 'node_modules/ws/LICENSE'),
    resolve(runtimeDirectory, 'ws-LICENSE'),
);
await copyFile(
    resolve(companionRoot, 'node_modules/@modelcontextprotocol/sdk/LICENSE'),
    resolve(runtimeDirectory, 'mcp-sdk-LICENSE'),
);
