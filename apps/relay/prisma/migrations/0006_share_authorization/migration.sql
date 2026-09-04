ALTER TABLE "shared_threads" ADD COLUMN "expiresAt" DATETIME;

CREATE TABLE "new_share_grants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sharedThreadId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "canPreview" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("sharedThreadId") REFERENCES "shared_threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_share_grants"
SELECT g."id", g."sharedThreadId", g."userId", lower(u."email"), g."permission", g."canPreview", g."createdAt", g."updatedAt"
FROM "share_grants" g JOIN "users" u ON u."id" = g."userId";
DROP TABLE "share_grants";
ALTER TABLE "new_share_grants" RENAME TO "share_grants";
CREATE UNIQUE INDEX "share_grants_sharedThreadId_userId_key" ON "share_grants"("sharedThreadId", "userId");
CREATE UNIQUE INDEX "share_grants_sharedThreadId_email_key" ON "share_grants"("sharedThreadId", "email");
CREATE INDEX "share_grants_userId_idx" ON "share_grants"("userId");

CREATE TABLE "new_share_invites" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sharedThreadId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "token" TEXT,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "singleUse" BOOLEAN NOT NULL DEFAULT false,
    "permission" TEXT NOT NULL,
    "canPreview" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" DATETIME,
    "acceptedAt" DATETIME,
    "acceptedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("sharedThreadId") REFERENCES "shared_threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("acceptedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_share_invites"
SELECT "id", "sharedThreadId", "tokenHash", "token", "recipientEmail" IS NOT NULL, true,
       "permission", "canPreview", "expiresAt", "acceptedAt", "acceptedById", "createdAt"
FROM "share_invites";
DROP TABLE "share_invites";
ALTER TABLE "new_share_invites" RENAME TO "share_invites";
CREATE UNIQUE INDEX "share_invites_tokenHash_key" ON "share_invites"("tokenHash");
CREATE INDEX "share_invites_sharedThreadId_idx" ON "share_invites"("sharedThreadId");
