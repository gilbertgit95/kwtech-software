-- AlterTable
ALTER TABLE "pos_refund_line" ADD COLUMN     "restock" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "pos_order_workspaceId_voidedAt_idx" ON "pos_order"("workspaceId", "voidedAt");
