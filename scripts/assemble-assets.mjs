import { access, cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteOutput = path.join(repositoryRoot, 'apps', 'site', 'out');
const webOutput = path.join(repositoryRoot, 'apps', 'web', 'dist');
const relayAssets = path.join(repositoryRoot, 'apps', 'relay', '.assets');
const webAssets = path.join(relayAssets, 'app');

await Promise.all([access(siteOutput), access(webOutput)]);
await rm(relayAssets, { recursive: true, force: true });
await mkdir(webAssets, { recursive: true });
await cp(siteOutput, relayAssets, { recursive: true });
await cp(webOutput, webAssets, { recursive: true });

process.stdout.write(`Assembled Relay assets at ${relayAssets}\n`);
