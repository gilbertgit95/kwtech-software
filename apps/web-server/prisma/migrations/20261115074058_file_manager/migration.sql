-- CreateEnum
CREATE TYPE "FileVisibility" AS ENUM ('private', 'workspace', 'people');

-- CreateTable
CREATE TABLE "file_entry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "visibility" "FileVisibility" NOT NULL DEFAULT 'private',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "file_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_share" (
    "fileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_share_pkey" PRIMARY KEY ("fileId","userId")
);

-- CreateTable
CREATE TABLE "file_settings" (
    "workspaceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "retentionHours" INTEGER NOT NULL,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "file_settings_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateIndex
CREATE UNIQUE INDEX "file_entry_storageKey_key" ON "file_entry"("storageKey");

-- CreateIndex
CREATE INDEX "file_entry_organizationId_idx" ON "file_entry"("organizationId");

-- CreateIndex
CREATE INDEX "file_entry_workspaceId_createdAt_idx" ON "file_entry"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "file_share_workspaceId_userId_idx" ON "file_share"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "file_share_organizationId_idx" ON "file_share"("organizationId");

-- CreateIndex
CREATE INDEX "file_settings_organizationId_idx" ON "file_settings"("organizationId");

-- AddForeignKey
ALTER TABLE "file_share" ADD CONSTRAINT "file_share_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "file_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
