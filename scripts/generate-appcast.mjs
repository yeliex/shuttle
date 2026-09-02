import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readOption = (name, fallback) => {
    const index = process.argv.indexOf(name);
    return index === -1 ? fallback : process.argv[index + 1];
};
const version = readOption('--version', '0.1.0');
const account = readOption('--account', 'shuttle');
const releaseNotesOption = readOption(
    '--release-notes',
    `artifacts/macos/Shuttle-${version}.md`,
);
const privateKey = process.env.SHUTTLE_SPARKLE_PRIVATE_KEY?.trim();
if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error('--version must be a semantic version');
}
if (!account) {
    throw new Error('--account must name the Sparkle signing key account');
}
if (!releaseNotesOption) {
    throw new Error('--release-notes must point to a Markdown file');
}
const sourceArchive = resolve(root, `artifacts/macos/Shuttle-${version}.zip`);
const sourceReleaseNotes = resolve(root, releaseNotesOption);
const releaseDirectory = resolve(root, 'artifacts/release');
const archivePath = resolve(releaseDirectory, `Shuttle-${version}.zip`);
const releaseNotesPath = resolve(releaseDirectory, `Shuttle-${version}.md`);
const generateAppcast = resolve(
    root,
    'apps/client/.build/artifacts/sparkle/Sparkle/bin/generate_appcast',
);

const releaseNotes = await readFile(sourceReleaseNotes, 'utf8');
if (!releaseNotes.trim()) {
    throw new Error('--release-notes must point to a non-empty Markdown file');
}

const run = (command, args, input) => new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
        cwd: root,
        stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    });
    if (input !== undefined) {
        child.stdin.end(`${input}\n`);
    }
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => code === 0
        ? resolveRun()
        : rejectRun(new Error(`${command} exited with code ${String(code)} and signal ${String(signal)}`)));
});

await rm(releaseDirectory, { force: true, recursive: true });
await mkdir(releaseDirectory, { recursive: true });
await copyFile(sourceArchive, archivePath);
await copyFile(sourceReleaseNotes, releaseNotesPath);
await run(generateAppcast, [
    ...(privateKey
        ? ['--ed-key-file', '-']
        : ['--account', account]),
    '--download-url-prefix', `https://github.com/yeliex/shuttle/releases/download/v${version}/`,
    '--link', 'https://github.com/yeliex/shuttle',
    '--embed-release-notes',
    releaseDirectory,
], privateKey);

const appcastPath = resolve(releaseDirectory, 'appcast.xml');
const appcast = await readFile(appcastPath, 'utf8');
if (!appcast.includes('sparkle:edSignature=')) {
    throw new Error('Sparkle did not sign the generated appcast');
}
if (!appcast.includes('<description sparkle:format="markdown">')) {
    throw new Error('Sparkle did not embed the Markdown release notes');
}
process.stdout.write(`${JSON.stringify({
    appcastPath,
    archivePath,
    releaseNotesPath,
    version,
}, null, 2)}\n`);
