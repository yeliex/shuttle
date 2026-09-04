import { spawn } from 'node:child_process';
import {
    chmod,
    copyFile,
    cp,
    mkdir,
    readFile,
    rm,
    writeFile,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clientRoot = resolve(root, 'apps/client');
const authorizationPreview = process.argv.includes('--authorization-preview');
const outputRoot = resolve(root, authorizationPreview ? 'artifacts/authorization-preview' : 'artifacts/macos');

const readOption = (name, fallback) => {
    const index = process.argv.indexOf(name);
    return index === -1 ? fallback : process.argv[index + 1];
};
const version = readOption('--version', '0.1.0');
const buildNumber = readOption('--build', '1');
if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error('--version must be a semantic version');
}
if (!buildNumber || !/^[1-9]\d*$/u.test(buildNumber)) {
    throw new Error('--build must be a positive integer');
}

const run = (command, args, cwd = root, captureOutput = false) => new Promise((resolveRun, rejectRun) => {
    const output = [];
    const child = spawn(command, args, {
        cwd,
        env: process.env,
        stdio: captureOutput ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    });
    if (captureOutput) {
        child.stdout.on('data', (chunk) => output.push(chunk));
    }
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
        if (code === 0) {
            resolveRun(Buffer.concat(output).toString('utf8'));
        } else {
            rejectRun(new Error(`${command} exited with code ${String(code)} and signal ${String(signal)}`));
        }
    });
});

const verifyAppLaunch = (executablePath) => new Promise((resolveLaunch, rejectLaunch) => {
    let terminating = false;
    const child = spawn(executablePath, [], {
        cwd: dirname(executablePath),
        env: { ...process.env, SHUTTLE_LAUNCH_CHECK: '1' },
        stdio: 'ignore',
    });
    const timer = setTimeout(() => {
        terminating = true;
        child.kill('SIGTERM');
    }, 2_000);
    child.once('error', (error) => {
        clearTimeout(timer);
        rejectLaunch(error);
    });
    child.once('exit', (code, signal) => {
        clearTimeout(timer);
        if (terminating && signal === 'SIGTERM') {
            resolveLaunch();
        } else {
            rejectLaunch(new Error(
                `Packaged app exited during launch with code ${String(code)} and signal ${String(signal)}`,
            ));
        }
    });
});

if (!authorizationPreview) await run('pnpm', ['build:companion-runtime']);
await run('swift', ['build', '-c', 'release'], clientRoot);
const swiftBuildPath = (await run(
    'swift',
    ['build', '-c', 'release', '--show-bin-path'],
    clientRoot,
    true,
)).trim();

const appPath = resolve(outputRoot, authorizationPreview ? 'Shuttle Preview.app' : 'Shuttle.app');
const contentsPath = resolve(appPath, 'Contents');
const frameworksPath = resolve(contentsPath, 'Frameworks');
const macOSPath = resolve(contentsPath, 'MacOS');
const resourcesPath = resolve(contentsPath, 'Resources');
await rm(outputRoot, { force: true, recursive: true });
await Promise.all([
    mkdir(frameworksPath, { recursive: true }),
    mkdir(macOSPath, { recursive: true }),
    mkdir(resolve(resourcesPath, 'companion'), { recursive: true }),
]);

await copyFile(resolve(swiftBuildPath, 'Shuttle'), resolve(macOSPath, 'Shuttle'));
await cp(
    resolve(swiftBuildPath, 'Sparkle.framework'),
    resolve(frameworksPath, 'Sparkle.framework'),
    { recursive: true, verbatimSymlinks: true },
);
await cp(
    resolve(swiftBuildPath, 'Shuttle_Shuttle.bundle'),
    resolve(resourcesPath, 'Shuttle_Shuttle.bundle'),
    { recursive: true },
);
if (!authorizationPreview) {
    await cp(resolve(root, 'apps/companion/dist/runtime'), resolve(resourcesPath, 'companion'), { recursive: true });
    await chmod(resolve(resourcesPath, 'companion/cli.mjs'), 0o755);
}
await chmod(resolve(macOSPath, 'Shuttle'), 0o755);
await run('install_name_tool', [
    '-add_rpath',
    '@executable_path/../Frameworks',
    resolve(macOSPath, 'Shuttle'),
]);

const plistTemplate = await readFile(resolve(clientRoot, 'Packaging/Info.plist'), 'utf8');
await writeFile(
    resolve(contentsPath, 'Info.plist'),
    plistTemplate
        .replaceAll('__SHUTTLE_VERSION__', version)
        .replaceAll('__SHUTTLE_BUILD__', buildNumber),
);
await writeFile(resolve(contentsPath, 'PkgInfo'), 'APPL????');
if (authorizationPreview) {
    const plistPath = resolve(contentsPath, 'Info.plist');
    await run('plutil', ['-replace', 'CFBundleIdentifier', '-string', 'com.yeliex.shuttle.authorization-preview', plistPath]);
    await run('plutil', ['-replace', 'CFBundleName', '-string', 'Shuttle Preview', plistPath]);
    await run('plutil', ['-replace', 'CFBundleDisplayName', '-string', 'Shuttle Preview', plistPath]);
    await run('plutil', ['-insert', 'ShuttleAuthorizationPreview', '-bool', 'YES', plistPath]);
    await run('plutil', ['-remove', 'CFBundleURLTypes', plistPath]);
    await run('plutil', ['-remove', 'SUFeedURL', plistPath]);
}

const iconsetPath = resolve(outputRoot, 'Shuttle.iconset');
const iconSource = resolve(clientRoot, 'Sources/Shuttle/Resources/ShuttleAppIcon.svg');
const baseIcon = resolve(outputRoot, 'Shuttle-1024.png');
await mkdir(iconsetPath);
await run('sips', [
    '-s', 'format', 'png', '-z', '1024', '1024', iconSource, '--out', baseIcon,
]);
const iconSizes = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
];
for (const [name, size] of iconSizes) {
    await run('sips', [
        '-z', String(size), String(size), baseIcon, '--out', resolve(iconsetPath, name),
    ]);
}
await run('iconutil', [
    '-c', 'icns', '-o', resolve(resourcesPath, 'Shuttle.icns'), iconsetPath,
]);
await rm(iconsetPath, { recursive: true });
await rm(baseIcon);

const signNested = async (path) => run('codesign', [
    '--force',
    '--sign', '-',
    '--preserve-metadata=identifier,entitlements,requirements,flags,runtime',
    path,
]);
const sparklePath = resolve(frameworksPath, 'Sparkle.framework/Versions/B');
for (const path of [
    resolve(sparklePath, 'XPCServices/Downloader.xpc'),
    resolve(sparklePath, 'XPCServices/Installer.xpc'),
    resolve(sparklePath, 'Updater.app'),
    resolve(sparklePath, 'Autoupdate'),
    resolve(frameworksPath, 'Sparkle.framework'),
]) {
    await signNested(path);
}
await run('codesign', [
    '--force',
    '--sign', '-',
    appPath,
]);
await run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
await verifyAppLaunch(resolve(macOSPath, 'Shuttle'));

const archivePath = resolve(outputRoot, `Shuttle-${version}.zip`);
await run('ditto', [
    '-c', '-k', '--sequesterRsrc', '--keepParent', appPath, archivePath,
]);
process.stdout.write(`${JSON.stringify({
    appPath,
    architecture: process.arch,
    archivePath,
    buildNumber,
    signingIdentity: 'ad-hoc',
    version,
}, null, 2)}\n`);
