-- AlterTable
ALTER TABLE "pos_order" ADD COLUMN     "orderTypeId" TEXT,
ADD COLUMN     "orderTypeName" TEXT;

-- AlterTable
ALTER TABLE "pos_settings" ADD COLUMN     "defaultReference" TEXT;

-- CreateTable
CREATE TABLE "pos_order_type" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_order_type_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pos_order_type_organizationId_idx" ON "pos_order_type"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "pos_order_type_workspaceId_nameKey_key" ON "pos_order_type"("workspaceId", "nameKey");
