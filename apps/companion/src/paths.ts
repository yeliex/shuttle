import { homedir } from 'node:os';
import { join } from 'node:path';

export const getCompanionDirectory = (): string => (
    process.env.SHUTTLE_DATA_DIR
    ?? join(homedir(), 'Library', 'Application Support', 'Shuttle')
);

export const getCompanionSocketPath = (): string => (
    process.env.SHUTTLE_SOCKET_PATH ?? join(getCompanionDirectory(), 'companion.sock')
);
