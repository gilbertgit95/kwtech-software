-- CreateEnum
CREATE TYPE "StockItemKind" AS ENUM ('for_sale', 'material');

-- CreateEnum
CREATE TYPE "StockUnit" AS ENUM ('piece', 'sheet', 'pack', 'ml', 'l', 'g', 'kg', 'm');

-- CreateEnum
CREATE TYPE "StockMoveKind" AS ENUM ('opening', 'received', 'used', 'returned', 'adjustment', 'wasted', 'count');

-- CreateEnum
CREATE TYPE "StockSource" AS ENUM ('pos');

-- CreateEnum
CREATE TYPE "StockUseRefKind" AS ENUM ('item', 'variant');

-- CreateEnum
CREATE TYPE "StockTakeStatus" AS ENUM ('open', 'confirmed', 'abandoned');

-- CreateTable
CREATE TABLE "stock_category" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_item" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "categoryId" TEXT,
    "kind" "StockItemKind" NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "unit" "StockUnit" NOT NULL,
    "unitCost" INTEGER,
    "lowStockAt" INTEGER,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_use" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "source" "StockSource" NOT NULL,
    "refKind" "StockUseRefKind" NOT NULL,
    "refId" TEXT NOT NULL,
    "refItemId" TEXT NOT NULL,
    "refLabel" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "quantityPerUnit" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_use_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_move" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "kind" "StockMoveKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" INTEGER,
    "sourceKey" TEXT,
    "sourceLineId" TEXT,
    "takeId" TEXT,
    "wasteRefId" TEXT,
    "wasteRefLabel" TEXT,
    "reason" TEXT,
    "note" TEXT,
    "supplier" TEXT,
    "reference" TEXT,
    "clientId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_move_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_take" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" "StockTakeStatus" NOT NULL DEFAULT 'open',
    "categoryIds" TEXT[],
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_take_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_take_line" (
    "takeId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "counted" INTEGER,
    "onHandAtConfirm" INTEGER,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_take_line_pkey" PRIMARY KEY ("takeId","stockItemId")
);

-- CreateTable
CREATE TABLE "stock_feed_cursor" (
    "workspaceId" TEXT NOT NULL,
    "source" "StockSource" NOT NULL,
    "organizationId" TEXT NOT NULL,
    "through" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_feed_cursor_pkey" PRIMARY KEY ("workspaceId","source")
);

-- CreateIndex
CREATE INDEX "stock_category_workspaceId_archivedAt_idx" ON "stock_category"("workspaceId", "archivedAt");

-- CreateIndex
CREATE INDEX "stock_category_organizationId_idx" ON "stock_category"("organizationId");

-- CreateIndex
CREATE INDEX "stock_item_workspaceId_archivedAt_idx" ON "stock_item"("workspaceId", "archivedAt");

-- CreateIndex
CREATE INDEX "stock_item_categoryId_idx" ON "stock_item"("categoryId");

-- CreateIndex
CREATE INDEX "stock_item_organizationId_idx" ON "stock_item"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_item_workspaceId_code_key" ON "stock_item"("workspaceId", "code");

-- CreateIndex
CREATE INDEX "stock_use_workspaceId_source_refItemId_idx" ON "stock_use"("workspaceId", "source", "refItemId");

-- CreateIndex
CREATE INDEX "stock_use_stockItemId_idx" ON "stock_use"("stockItemId");

-- CreateIndex
CREATE INDEX "stock_use_organizationId_idx" ON "stock_use"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_use_workspaceId_source_refId_stockItemId_key" ON "stock_use"("workspaceId", "source", "refId", "stockItemId");

-- CreateIndex
CREATE INDEX "stock_move_workspaceId_stockItemId_createdAt_idx" ON "stock_move"("workspaceId", "stockItemId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_move_workspaceId_createdAt_idx" ON "stock_move"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_move_workspaceId_sourceLineId_idx" ON "stock_move"("workspaceId", "sourceLineId");

-- CreateIndex
CREATE INDEX "stock_move_takeId_idx" ON "stock_move"("takeId");

-- CreateIndex
CREATE INDEX "stock_move_organizationId_idx" ON "stock_move"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_move_workspaceId_sourceKey_stockItemId_key" ON "stock_move"("workspaceId", "sourceKey", "stockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_move_workspaceId_clientId_stockItemId_key" ON "stock_move"("workspaceId", "clientId", "stockItemId");

-- CreateIndex
CREATE INDEX "stock_take_workspaceId_status_createdAt_idx" ON "stock_take"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "stock_take_organizationId_idx" ON "stock_take"("organizationId");

-- CreateIndex
CREATE INDEX "stock_take_line_stockItemId_idx" ON "stock_take_line"("stockItemId");

-- CreateIndex
CREATE INDEX "stock_feed_cursor_organizationId_idx" ON "stock_feed_cursor"("organizationId");

-- AddForeignKey
ALTER TABLE "stock_item" ADD CONSTRAINT "stock_item_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "stock_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_use" ADD CONSTRAINT "stock_use_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_move" ADD CONSTRAINT "stock_move_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_move" ADD CONSTRAINT "stock_move_takeId_fkey" FOREIGN KEY ("takeId") REFERENCES "stock_take"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_take_line" ADD CONSTRAINT "stock_take_line_takeId_fkey" FOREIGN KEY ("takeId") REFERENCES "stock_take"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_take_line" ADD CONSTRAINT "stock_take_line_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
