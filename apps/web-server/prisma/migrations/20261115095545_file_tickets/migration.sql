-- CreateEnum
CREATE TYPE "FileTicketKind" AS ENUM ('upload', 'download');

-- CreateTable
CREATE TABLE "file_ticket" (
    "tokenHash" TEXT NOT NULL,
    "kind" "FileTicketKind" NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "fileId" TEXT,
    "name" TEXT,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "visibility" "FileVisibility",
    "sharedWith" TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_ticket_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateIndex
CREATE INDEX "file_ticket_expiresAt_idx" ON "file_ticket"("expiresAt");

-- CreateIndex
CREATE INDEX "file_ticket_actorId_expiresAt_idx" ON "file_ticket"("actorId", "expiresAt");

-- CreateIndex
CREATE INDEX "file_ticket_organizationId_idx" ON "file_ticket"("organizationId");
