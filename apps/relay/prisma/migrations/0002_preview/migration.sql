-- CreateTable
CREATE TABLE "preview_services" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "sharedThreadId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "localUrl" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "preview_services_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "preview_services_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "preview_services_sharedThreadId_fkey" FOREIGN KEY ("sharedThreadId") REFERENCES "shared_threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "preview_grants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "previewServiceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "preview_grants_previewServiceId_fkey" FOREIGN KEY ("previewServiceId") REFERENCES "preview_services" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "preview_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "preview_invites" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "previewServiceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "acceptedAt" DATETIME,
    "acceptedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "preview_invites_previewServiceId_fkey" FOREIGN KEY ("previewServiceId") REFERENCES "preview_services" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "preview_invites_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "preview_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "previewServiceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "preview_sessions_previewServiceId_fkey" FOREIGN KEY ("previewServiceId") REFERENCES "preview_services" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "preview_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "preview_services_ownerId_idx" ON "preview_services"("ownerId");

-- CreateIndex
CREATE INDEX "preview_services_deviceId_idx" ON "preview_services"("deviceId");

-- CreateIndex
CREATE INDEX "preview_services_sharedThreadId_idx" ON "preview_services"("sharedThreadId");

-- CreateIndex
CREATE UNIQUE INDEX "preview_services_ownerId_localUrl_key" ON "preview_services"("ownerId", "localUrl");

-- CreateIndex
CREATE INDEX "preview_grants_userId_idx" ON "preview_grants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "preview_grants_previewServiceId_userId_key" ON "preview_grants"("previewServiceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "preview_invites_tokenHash_key" ON "preview_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "preview_invites_previewServiceId_idx" ON "preview_invites"("previewServiceId");

-- CreateIndex
CREATE UNIQUE INDEX "preview_sessions_tokenHash_key" ON "preview_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "preview_sessions_previewServiceId_userId_idx" ON "preview_sessions"("previewServiceId", "userId");
