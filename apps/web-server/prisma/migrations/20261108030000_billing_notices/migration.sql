-- The daily check writes each notice once, before sending it (#95).

-- CreateTable
CREATE TABLE "platform_billing_notice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "platform_billing_notice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_billing_notice_sentAt_idx" ON "platform_billing_notice"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "platform_billing_notice_organizationId_kind_periodKey_day_key" ON "platform_billing_notice"("organizationId", "kind", "periodKey", "day");

