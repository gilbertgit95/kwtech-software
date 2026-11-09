-- AlterEnum
ALTER TYPE "PlatformBillingPaymentMethod" ADD VALUE 'credit';

-- AlterTable
ALTER TABLE "platform_billing_request" ADD COLUMN     "automatic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "months" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "platform_billing_auto_renew" (
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "setById" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_billing_auto_renew_pkey" PRIMARY KEY ("organizationId")
);
