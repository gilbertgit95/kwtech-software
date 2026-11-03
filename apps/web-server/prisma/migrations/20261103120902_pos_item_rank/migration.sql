-- CreateEnum
CREATE TYPE "PosRankingOutcome" AS ENUM ('ranked', 'skipped_late');

-- CreateTable
CREATE TABLE "pos_item_rank" (
    "workspaceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "orders" INTEGER NOT NULL,

    CONSTRAINT "pos_item_rank_pkey" PRIMARY KEY ("workspaceId","itemId")
);

-- CreateTable
CREATE TABLE "pos_variant_rank" (
    "workspaceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "orders" INTEGER NOT NULL,

    CONSTRAINT "pos_variant_rank_pkey" PRIMARY KEY ("workspaceId","variantId")
);

-- CreateTable
CREATE TABLE "pos_ranking" (
    "workspaceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rankedFor" DATE NOT NULL,
    "outcome" "PosRankingOutcome" NOT NULL,
    "rankedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_ranking_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateIndex
CREATE INDEX "pos_item_rank_organizationId_idx" ON "pos_item_rank"("organizationId");

-- CreateIndex
CREATE INDEX "pos_variant_rank_organizationId_idx" ON "pos_variant_rank"("organizationId");

-- CreateIndex
CREATE INDEX "pos_ranking_organizationId_idx" ON "pos_ranking"("organizationId");
