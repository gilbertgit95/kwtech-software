-- A trial row names the founder account it was given for (unique: one trial per account, D2),
-- and an archive credit names the subscription row it is for (once per row, D12b).

-- AlterTable
ALTER TABLE "perm_subscription" ADD COLUMN     "trialUserId" TEXT;

-- AlterTable
ALTER TABLE "platform_billing_credit" ADD COLUMN     "subscriptionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "perm_subscription_trialUserId_key" ON "perm_subscription"("trialUserId");

-- CreateIndex
CREATE INDEX "platform_billing_credit_subscriptionId_idx" ON "platform_billing_credit"("subscriptionId");

