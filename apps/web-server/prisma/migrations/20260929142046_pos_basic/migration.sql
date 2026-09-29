-- CreateEnum
CREATE TYPE "PosItemKind" AS ENUM ('product', 'service');

-- CreateEnum
CREATE TYPE "PosOrderStatus" AS ENUM ('open', 'unpaid', 'paid', 'cancelled', 'voided');

-- CreateEnum
CREATE TYPE "PosPaymentMethod" AS ENUM ('cash', 'ewallet', 'card');

-- CreateEnum
CREATE TYPE "PosDiscountKind" AS ENUM ('amount', 'percent');

-- CreateEnum
CREATE TYPE "PosChangeSettlement" AS ENUM ('given', 'tip');

-- CreateTable
CREATE TABLE "pos_category" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_item" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "categoryId" TEXT,
    "kind" "PosItemKind" NOT NULL DEFAULT 'product',
    "name" TEXT NOT NULL,
    "code" TEXT,
    "price" INTEGER NOT NULL,
    "cost" INTEGER,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_item_variant" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "price" INTEGER NOT NULL,
    "cost" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_item_variant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_customer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "note" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_order" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" "PosOrderStatus" NOT NULL DEFAULT 'open',
    "version" INTEGER NOT NULL DEFAULT 1,
    "number" INTEGER,
    "label" TEXT,
    "customerId" TEXT,
    "customerName" TEXT,
    "customerContact" TEXT,
    "gross" INTEGER NOT NULL DEFAULT 0,
    "lineDiscounts" INTEGER NOT NULL DEFAULT 0,
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "orderDiscount" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "discountKind" "PosDiscountKind",
    "discountValue" INTEGER,
    "discountReason" TEXT,
    "discountById" TEXT,
    "discountAt" TIMESTAMP(3),
    "paymentMethod" "PosPaymentMethod",
    "received" INTEGER,
    "change" INTEGER,
    "tip" INTEGER NOT NULL DEFAULT 0,
    "paymentReference" TEXT,
    "paymentClientId" TEXT,
    "changeOwed" INTEGER NOT NULL DEFAULT 0,
    "changeSettlement" "PosChangeSettlement",
    "changeSettledAt" TIMESTAMP(3),
    "changeSettledById" TEXT,
    "createdById" TEXT NOT NULL,
    "finalisedAt" TIMESTAMP(3),
    "finalisedById" TEXT,
    "releasedUnpaid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_order_line" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantId" TEXT,
    "name" TEXT NOT NULL,
    "kind" "PosItemKind" NOT NULL,
    "variantName" TEXT,
    "code" TEXT,
    "categoryName" TEXT,
    "unitPrice" INTEGER NOT NULL,
    "unitCost" INTEGER,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "discountKind" "PosDiscountKind",
    "discountValue" INTEGER,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "discountReason" TEXT,
    "discountById" TEXT,
    "discountAt" TIMESTAMP(3),
    "gross" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "net" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_order_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_refund" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "PosPaymentMethod" NOT NULL,
    "reason" TEXT NOT NULL,
    "refundedById" TEXT NOT NULL,
    "refundedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT NOT NULL,

    CONSTRAINT "pos_refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_refund_line" (
    "id" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "pos_refund_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_counter" (
    "workspaceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pos_counter_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "pos_settings" (
    "workspaceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'Asia/Manila',
    "keymap" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_settings_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateIndex
CREATE INDEX "pos_category_organizationId_idx" ON "pos_category"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "pos_category_workspaceId_nameKey_key" ON "pos_category"("workspaceId", "nameKey");

-- CreateIndex
CREATE INDEX "pos_item_workspaceId_archivedAt_idx" ON "pos_item"("workspaceId", "archivedAt");

-- CreateIndex
CREATE INDEX "pos_item_categoryId_idx" ON "pos_item"("categoryId");

-- CreateIndex
CREATE INDEX "pos_item_organizationId_idx" ON "pos_item"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "pos_item_workspaceId_code_key" ON "pos_item"("workspaceId", "code");

-- CreateIndex
CREATE INDEX "pos_item_variant_itemId_sortOrder_idx" ON "pos_item_variant"("itemId", "sortOrder");

-- CreateIndex
CREATE INDEX "pos_item_variant_workspaceId_archivedAt_idx" ON "pos_item_variant"("workspaceId", "archivedAt");

-- CreateIndex
CREATE INDEX "pos_item_variant_organizationId_idx" ON "pos_item_variant"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "pos_item_variant_workspaceId_code_key" ON "pos_item_variant"("workspaceId", "code");

-- CreateIndex
CREATE INDEX "pos_customer_workspaceId_archivedAt_idx" ON "pos_customer"("workspaceId", "archivedAt");

-- CreateIndex
CREATE INDEX "pos_customer_organizationId_idx" ON "pos_customer"("organizationId");

-- CreateIndex
CREATE INDEX "pos_order_workspaceId_status_idx" ON "pos_order"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "pos_order_workspaceId_paidAt_idx" ON "pos_order"("workspaceId", "paidAt");

-- CreateIndex
CREATE INDEX "pos_order_workspaceId_finalisedAt_idx" ON "pos_order"("workspaceId", "finalisedAt");

-- CreateIndex
CREATE INDEX "pos_order_customerId_idx" ON "pos_order"("customerId");

-- CreateIndex
CREATE INDEX "pos_order_organizationId_idx" ON "pos_order"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "pos_order_workspaceId_number_key" ON "pos_order"("workspaceId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "pos_order_workspaceId_paymentClientId_key" ON "pos_order"("workspaceId", "paymentClientId");

-- CreateIndex
CREATE INDEX "pos_order_line_orderId_position_idx" ON "pos_order_line"("orderId", "position");

-- CreateIndex
CREATE INDEX "pos_order_line_itemId_idx" ON "pos_order_line"("itemId");

-- CreateIndex
CREATE INDEX "pos_order_line_variantId_idx" ON "pos_order_line"("variantId");

-- CreateIndex
CREATE INDEX "pos_order_line_organizationId_idx" ON "pos_order_line"("organizationId");

-- CreateIndex
CREATE INDEX "pos_refund_orderId_idx" ON "pos_refund"("orderId");

-- CreateIndex
CREATE INDEX "pos_refund_workspaceId_refundedAt_idx" ON "pos_refund"("workspaceId", "refundedAt");

-- CreateIndex
CREATE INDEX "pos_refund_organizationId_idx" ON "pos_refund"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "pos_refund_workspaceId_clientId_key" ON "pos_refund"("workspaceId", "clientId");

-- CreateIndex
CREATE INDEX "pos_refund_line_refundId_idx" ON "pos_refund_line"("refundId");

-- CreateIndex
CREATE INDEX "pos_refund_line_orderLineId_idx" ON "pos_refund_line"("orderLineId");

-- CreateIndex
CREATE INDEX "pos_refund_line_organizationId_idx" ON "pos_refund_line"("organizationId");

-- CreateIndex
CREATE INDEX "pos_counter_organizationId_idx" ON "pos_counter"("organizationId");

-- CreateIndex
CREATE INDEX "pos_settings_organizationId_idx" ON "pos_settings"("organizationId");

-- AddForeignKey
ALTER TABLE "pos_item" ADD CONSTRAINT "pos_item_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "pos_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_item_variant" ADD CONSTRAINT "pos_item_variant_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "pos_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_order" ADD CONSTRAINT "pos_order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "pos_customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_order_line" ADD CONSTRAINT "pos_order_line_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "pos_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_order_line" ADD CONSTRAINT "pos_order_line_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "pos_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_order_line" ADD CONSTRAINT "pos_order_line_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "pos_item_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_refund" ADD CONSTRAINT "pos_refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "pos_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_refund_line" ADD CONSTRAINT "pos_refund_line_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "pos_refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_refund_line" ADD CONSTRAINT "pos_refund_line_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "pos_order_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
