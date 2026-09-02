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
    CodexAppToolsSession,
    discoverCodexHost,
    readCompleteCodexThread,
    readCodexThread,
    sendCodexMessage,
} from './codex-host.js';
export { CompanionService, type CodexThreadHost } from './companion-service.js';
export { JsonLinePeer } from './json-line-peer.js';
export { RelayClient, type RelayApi } from './relay-client.js';
