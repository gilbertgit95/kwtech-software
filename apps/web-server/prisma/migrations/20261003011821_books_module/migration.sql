-- CreateEnum
CREATE TYPE "BooksEntryKind" AS ENUM ('capital', 'sales', 'loan_repayment', 'adjustment_in', 'expense', 'purchase', 'refund', 'loan_out', 'payout', 'capital_return', 'adjustment_out', 'transfer', 'profit_share', 'reinvest');

-- CreateEnum
CREATE TYPE "BooksPlace" AS ENUM ('cash', 'ewallet', 'bank');

-- CreateEnum
CREATE TYPE "BooksShareMode" AS ENUM ('capital', 'agreed');

-- CreateTable
CREATE TABLE "books_investor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "contact" TEXT,
    "note" TEXT,
    "agreedShare" INTEGER,
    "formerAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "books_investor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books_loan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "borrowerName" TEXT NOT NULL,
    "contact" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "books_loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books_entry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "BooksEntryKind" NOT NULL,
    "amount" BIGINT NOT NULL,
    "place" "BooksPlace",
    "toPlace" "BooksPlace",
    "day" DATE NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "reference" TEXT,
    "investorId" TEXT,
    "loanId" TEXT,
    "importId" TEXT,
    "shareId" TEXT,
    "advance" BOOLEAN NOT NULL DEFAULT false,
    "clientId" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "books_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books_sales_import" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fromDay" DATE NOT NULL,
    "toDay" DATE NOT NULL,
    "cash" BIGINT NOT NULL,
    "ewallet" BIGINT NOT NULL,
    "bank" BIGINT NOT NULL,
    "costOfGoods" BIGINT NOT NULL,
    "costCoverage" INTEGER NOT NULL,
    "orders" INTEGER NOT NULL,
    "clientId" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "books_sales_import_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books_profit_share" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fromDay" DATE NOT NULL,
    "toDay" DATE NOT NULL,
    "sales" BIGINT NOT NULL,
    "refunds" BIGINT NOT NULL,
    "costOfGoods" BIGINT NOT NULL,
    "expenses" BIGINT NOT NULL,
    "profit" BIGINT NOT NULL,
    "kept" BIGINT NOT NULL,
    "shared" BIGINT NOT NULL,
    "mode" "BooksShareMode" NOT NULL,
    "clientId" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "books_profit_share_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books_settings" (
    "workspaceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shareMode" "BooksShareMode" NOT NULL DEFAULT 'capital',
    "posImportFrom" DATE,
    "posRecordedThrough" DATE,
    "sharedThrough" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "books_settings_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateIndex
CREATE INDEX "books_investor_organizationId_idx" ON "books_investor"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "books_investor_workspaceId_nameKey_key" ON "books_investor"("workspaceId", "nameKey");

-- CreateIndex
CREATE INDEX "books_loan_workspaceId_createdAt_idx" ON "books_loan"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "books_loan_organizationId_idx" ON "books_loan"("organizationId");

-- CreateIndex
CREATE INDEX "books_entry_workspaceId_day_createdAt_idx" ON "books_entry"("workspaceId", "day", "createdAt");

-- CreateIndex
CREATE INDEX "books_entry_workspaceId_voidedAt_idx" ON "books_entry"("workspaceId", "voidedAt");

-- CreateIndex
CREATE INDEX "books_entry_investorId_idx" ON "books_entry"("investorId");

-- CreateIndex
CREATE INDEX "books_entry_loanId_idx" ON "books_entry"("loanId");

-- CreateIndex
CREATE INDEX "books_entry_importId_idx" ON "books_entry"("importId");

-- CreateIndex
CREATE INDEX "books_entry_shareId_idx" ON "books_entry"("shareId");

-- CreateIndex
CREATE INDEX "books_entry_organizationId_idx" ON "books_entry"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "books_entry_workspaceId_clientId_key" ON "books_entry"("workspaceId", "clientId");

-- CreateIndex
CREATE INDEX "books_sales_import_workspaceId_toDay_idx" ON "books_sales_import"("workspaceId", "toDay");

-- CreateIndex
CREATE INDEX "books_sales_import_organizationId_idx" ON "books_sales_import"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "books_sales_import_workspaceId_clientId_key" ON "books_sales_import"("workspaceId", "clientId");

-- CreateIndex
CREATE INDEX "books_profit_share_workspaceId_toDay_idx" ON "books_profit_share"("workspaceId", "toDay");

-- CreateIndex
CREATE INDEX "books_profit_share_organizationId_idx" ON "books_profit_share"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "books_profit_share_workspaceId_clientId_key" ON "books_profit_share"("workspaceId", "clientId");

-- CreateIndex
CREATE INDEX "books_settings_organizationId_idx" ON "books_settings"("organizationId");

-- AddForeignKey
ALTER TABLE "books_entry" ADD CONSTRAINT "books_entry_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "books_investor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books_entry" ADD CONSTRAINT "books_entry_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "books_loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books_entry" ADD CONSTRAINT "books_entry_importId_fkey" FOREIGN KEY ("importId") REFERENCES "books_sales_import"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books_entry" ADD CONSTRAINT "books_entry_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "books_profit_share"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
