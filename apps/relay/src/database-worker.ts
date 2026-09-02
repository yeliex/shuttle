import { PrismaD1 } from '@prisma/adapter-d1';

import type { RelayDatabase } from './database.js';
import { PrismaClient } from './generated/prisma-worker/client.js';

export const createWorkerDatabase = (database: D1Database): RelayDatabase => {
    const client = new PrismaClient({ adapter: new PrismaD1(database) });

    // Both clients come from the same schema. Prisma brands their runtime-specific
    // promise types differently, so the shared business surface is bridged here.
    return client as unknown as RelayDatabase;
};
