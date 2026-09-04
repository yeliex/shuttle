import type { RelayDatabase } from './database.js';
import type { Prisma } from './generated/prisma-node/client.js';

// 授权有效期属于整个分享；读取、消息和服务均使用相同边界。
export const activeShare = (now = new Date()): Prisma.SharedThreadWhereInput => ({
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
});

// 邮箱授权不要求领取，也不预先创建账户；只有已验证邮箱才能匹配。
export const grantAudience = async (
    database: RelayDatabase,
    userId: string,
): Promise<Prisma.ShareGrantWhereInput> => {
    const user = await database.user.findUnique({
        where: { id: userId },
        select: { email: true, emailVerified: true },
    });
    return user?.emailVerified
        ? { OR: [{ userId }, { email: user.email.toLowerCase() }] }
        : { userId };
};
