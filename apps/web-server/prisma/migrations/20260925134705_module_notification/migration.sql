-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('info', 'success', 'warning', 'alert');

-- CreateTable
CREATE TABLE "notification_item" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'info',
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(2000),
    "source" VARCHAR(64) NOT NULL,
    "organizationId" TEXT,
    "workspaceId" TEXT,
    "contextLabel" VARCHAR(160),
    "actions" JSONB NOT NULL DEFAULT '[]',
    "dedupeKey" VARCHAR(200),
    "batchId" TEXT NOT NULL,
    "groupKey" VARCHAR(128),
    "groupCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "recalledAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "notification_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_batch" (
    "id" TEXT NOT NULL,
    "senderId" TEXT,
    "source" VARCHAR(64) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "recipientCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recalledAt" TIMESTAMP(3),
    "recalledById" TEXT,

    CONSTRAINT "notification_batch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_item_recipientId_archivedAt_readAt_occurredAt__idx" ON "notification_item"("recipientId", "archivedAt", "readAt", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "notification_item_recipientId_organizationId_occurredAt_idx" ON "notification_item"("recipientId", "organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "notification_item_recipientId_groupKey_readAt_idx" ON "notification_item"("recipientId", "groupKey", "readAt");

-- CreateIndex
CREATE INDEX "notification_item_recipientId_source_createdAt_idx" ON "notification_item"("recipientId", "source", "createdAt");

-- CreateIndex
CREATE INDEX "notification_item_batchId_idx" ON "notification_item"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_item_recipientId_dedupeKey_key" ON "notification_item"("recipientId", "dedupeKey");

-- CreateIndex
CREATE INDEX "notification_batch_createdAt_id_idx" ON "notification_batch"("createdAt", "id");

-- CreateIndex
CREATE INDEX "notification_batch_senderId_createdAt_idx" ON "notification_batch"("senderId", "createdAt");

-- AddForeignKey
ALTER TABLE "notification_item" ADD CONSTRAINT "notification_item_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "notification_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
