-- DropIndex
DROP INDEX "snapshot_chunks_sharedThreadId_position_key";

-- AlterTable
ALTER TABLE "users" ADD COLUMN "disabledAt" DATETIME;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "snapshot_chunks";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_shared_threads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "codexThreadId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "shared_threads_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "shared_threads_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_shared_threads" ("codexThreadId", "createdAt", "deviceId", "id", "ownerId", "title", "updatedAt") SELECT "codexThreadId", "createdAt", "deviceId", "id", "ownerId", "title", "updatedAt" FROM "shared_threads";
DROP TABLE "shared_threads";
ALTER TABLE "new_shared_threads" RENAME TO "shared_threads";
CREATE INDEX "shared_threads_ownerId_idx" ON "shared_threads"("ownerId");
CREATE INDEX "shared_threads_deviceId_idx" ON "shared_threads"("deviceId");
CREATE UNIQUE INDEX "shared_threads_ownerId_codexThreadId_key" ON "shared_threads"("ownerId", "codexThreadId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
