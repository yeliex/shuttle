import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

import { PrismaClient } from './generated/prisma-node/client.js';

export const createNodeDatabase = (url: string): PrismaClient => new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url }),
});
