-- AlterTable
ALTER TABLE "platform_billing_request" ADD COLUMN     "restoredSubscriptionId" TEXT;

-- CreateTable
CREATE TABLE "platform_billing_lock" (
    "organizationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "platform_billing_lock_pkey" PRIMARY KEY ("organizationId")
);
