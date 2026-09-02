import type { PrismaClient as NodePrismaClient } from './generated/prisma-node/client.js';

export type RelayDatabase = Pick<
    NodePrismaClient,
    | '$disconnect'
    | 'account'
    | 'device'
    | 'previewService'
    | 'session'
    | 'shareGrant'
    | 'shareInvite'
    | 'sharedThread'
    | 'user'
>;
