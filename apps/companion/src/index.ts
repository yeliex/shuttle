export interface CompanionRuntime {
    node: string;
    platform: NodeJS.Platform;
    architecture: string;
}

export const getCompanionRuntime = (): CompanionRuntime => ({
    node: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
});

export {
    CodexAppServer,
    discoverCodexExecutable,
    type CodexHost,
} from './codex-host.js';
export { CompanionService } from './companion-service.js';
export { JsonLinePeer } from './json-line-peer.js';
export { RelayClient, type RelayApi } from './relay-client.js';
