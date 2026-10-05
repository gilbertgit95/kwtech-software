-- CreateEnum
CREATE TYPE "StudioVisibility" AS ENUM ('private', 'workspace');

-- CreateEnum
CREATE TYPE "StudioLogAction" AS ENUM ('downloaded', 'sent_to_print');

-- CreateEnum
CREATE TYPE "StudioLogKind" AS ENUM ('layout', 'pages');

-- CreateTable
CREATE TABLE "studio_layout" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visibility" "StudioVisibility" NOT NULL DEFAULT 'private',
    "spec" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_layout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_calibration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scaleX" INTEGER NOT NULL DEFAULT 10000,
    "scaleY" INTEGER NOT NULL DEFAULT 10000,
    "offsetX" INTEGER NOT NULL DEFAULT 0,
    "offsetY" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_calibration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_log" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "StudioLogAction" NOT NULL,
    "kind" "StudioLogKind" NOT NULL,
    "layoutId" TEXT,
    "layoutName" TEXT,
    "paperLabel" TEXT NOT NULL,
    "paperWidth" INTEGER NOT NULL,
    "paperHeight" INTEGER NOT NULL,
    "pages" INTEGER NOT NULL,
    "copies" INTEGER NOT NULL,
    "fileNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "studio_layout_workspaceId_ownerId_idx" ON "studio_layout"("workspaceId", "ownerId");

-- CreateIndex
CREATE INDEX "studio_layout_workspaceId_visibility_idx" ON "studio_layout"("workspaceId", "visibility");

-- CreateIndex
CREATE INDEX "studio_layout_organizationId_idx" ON "studio_layout"("organizationId");

-- CreateIndex
CREATE INDEX "studio_calibration_organizationId_idx" ON "studio_calibration"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "studio_calibration_workspaceId_ownerId_name_key" ON "studio_calibration"("workspaceId", "ownerId", "name");

-- CreateIndex
CREATE INDEX "studio_log_workspaceId_createdAt_idx" ON "studio_log"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "studio_log_workspaceId_userId_createdAt_idx" ON "studio_log"("workspaceId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "studio_log_organizationId_idx" ON "studio_log"("organizationId");
