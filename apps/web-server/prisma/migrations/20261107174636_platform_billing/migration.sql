-- CreateEnum
CREATE TYPE "PlatformBillingRequestKind" AS ENUM ('subscribe', 'renew', 'change_plan', 'replace', 'cancel');

-- CreateEnum
CREATE TYPE "PlatformBillingRequestState" AS ENUM ('pending', 'approved', 'rejected', 'withdrawn', 'voided', 'closed_as_credit');

-- CreateEnum
CREATE TYPE "PlatformBillingPaymentMethod" AS ENUM ('cash', 'e_wallet', 'bank_transfer');

-- CreateEnum
CREATE TYPE "PlatformBillingBillStatus" AS ENUM ('unpaid', 'submitted', 'paid', 'cancelled');

-- CreateTable
CREATE TABLE "platform_billing_request" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "PlatformBillingRequestKind" NOT NULL,
    "state" "PlatformBillingRequestState" NOT NULL DEFAULT 'pending',
    "planKey" TEXT NOT NULL,
    "fromPlanKey" TEXT,
    "pendingOrganizationId" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pricedOn" DATE NOT NULL,
    "pricedForPeriodEnd" DATE,
    "detailsVersion" INTEGER NOT NULL DEFAULT 0,
    "coveredOn" DATE,
    "holdDays" INTEGER NOT NULL DEFAULT 0,
    "holdReason" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "selfApproved" BOOLEAN NOT NULL DEFAULT false,
    "approverIsMember" BOOLEAN NOT NULL DEFAULT false,
    "periodStart" DATE,
    "periodEnd" DATE,
    "billingDay" INTEGER,
    "accessUntil" TIMESTAMP(3),
    "subscriptionId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_billing_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_billing_payment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "method" "PlatformBillingPaymentMethod" NOT NULL,
    "amount" INTEGER NOT NULL,
    "paidOn" DATE NOT NULL,
    "reference" TEXT,
    "referenceNormalised" TEXT,
    "sender" TEXT,
    "note" TEXT,
    "source" TEXT NOT NULL,
    "enteredById" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_billing_payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_billing_bill" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "PlatformBillingBillStatus" NOT NULL DEFAULT 'unpaid',
    "total" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,

    CONSTRAINT "platform_billing_bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_billing_receipt" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "billId" TEXT,
    "organizationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "method" "PlatformBillingPaymentMethod" NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'payment',
    "snapshot" JSONB NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "platform_billing_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_billing_credit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "requestId" TEXT,
    "billId" TEXT,
    "receiptId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_billing_credit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_billing_price" (
    "id" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "monthly" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "setById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_billing_price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_billing_settings" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "timeZone" TEXT NOT NULL DEFAULT 'Asia/Manila',
    "graceDays" INTEGER NOT NULL DEFAULT 7,
    "issuerName" TEXT NOT NULL DEFAULT '',
    "issuerDetails" TEXT NOT NULL DEFAULT '',
    "paymentAccounts" JSONB NOT NULL DEFAULT '[]',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_billing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_billing_counter" (
    "sequence" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "platform_billing_counter_pkey" PRIMARY KEY ("sequence")
);

-- CreateTable
CREATE TABLE "platform_billing_event" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "step" TEXT NOT NULL,
    "reason" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "platform_billing_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_billing_request_pendingOrganizationId_key" ON "platform_billing_request"("pendingOrganizationId");

-- CreateIndex
CREATE INDEX "platform_billing_request_organizationId_requestedAt_idx" ON "platform_billing_request"("organizationId", "requestedAt");

-- CreateIndex
CREATE INDEX "platform_billing_request_state_requestedAt_idx" ON "platform_billing_request"("state", "requestedAt");

-- CreateIndex
CREATE INDEX "platform_billing_payment_referenceNormalised_idx" ON "platform_billing_payment"("referenceNormalised");

-- CreateIndex
CREATE UNIQUE INDEX "platform_billing_payment_requestId_version_key" ON "platform_billing_payment"("requestId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "platform_billing_bill_number_key" ON "platform_billing_bill"("number");

-- CreateIndex
CREATE INDEX "platform_billing_bill_organizationId_issuedAt_idx" ON "platform_billing_bill"("organizationId", "issuedAt");

-- CreateIndex
CREATE INDEX "platform_billing_bill_requestId_idx" ON "platform_billing_bill"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_billing_receipt_number_key" ON "platform_billing_receipt"("number");

-- CreateIndex
CREATE INDEX "platform_billing_receipt_organizationId_issuedAt_idx" ON "platform_billing_receipt"("organizationId", "issuedAt");

-- CreateIndex
CREATE INDEX "platform_billing_credit_organizationId_createdAt_idx" ON "platform_billing_credit"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "platform_billing_price_planKey_effectiveFrom_key" ON "platform_billing_price"("planKey", "effectiveFrom");

-- CreateIndex
CREATE INDEX "platform_billing_event_requestId_at_idx" ON "platform_billing_event"("requestId", "at");

-- CreateIndex
CREATE INDEX "platform_billing_event_organizationId_at_idx" ON "platform_billing_event"("organizationId", "at");

-- AddForeignKey
ALTER TABLE "platform_billing_payment" ADD CONSTRAINT "platform_billing_payment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "platform_billing_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_billing_bill" ADD CONSTRAINT "platform_billing_bill_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "platform_billing_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_billing_receipt" ADD CONSTRAINT "platform_billing_receipt_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "platform_billing_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_billing_receipt" ADD CONSTRAINT "platform_billing_receipt_billId_fkey" FOREIGN KEY ("billId") REFERENCES "platform_billing_bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_billing_event" ADD CONSTRAINT "platform_billing_event_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "platform_billing_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The two numbering sequences (bills, receipts), so the first issue updates a
-- row that exists. The service upserts them as well; ON CONFLICT keeps this
-- safe to run against a database that already has them.
INSERT INTO "platform_billing_counter" ("sequence", "value") VALUES ('bill', 0), ('receipt', 0)
ON CONFLICT ("sequence") DO NOTHING;
