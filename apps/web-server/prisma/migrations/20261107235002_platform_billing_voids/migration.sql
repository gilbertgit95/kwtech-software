-- AlterTable
ALTER TABLE "platform_billing_request" ADD COLUMN     "applied" TEXT,
ADD COLUMN     "subscriptionBefore" JSONB,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedById" TEXT;

-- CreateIndex
CREATE INDEX "platform_billing_credit_receiptId_idx" ON "platform_billing_credit"("receiptId");

-- CreateIndex
CREATE INDEX "platform_billing_request_organizationId_state_decidedAt_idx" ON "platform_billing_request"("organizationId", "state", "decidedAt");
