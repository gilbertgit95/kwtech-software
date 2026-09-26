-- CreateTable
CREATE TABLE "app_hub_workspace_layout" (
    "workspaceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "layout" JSONB NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_hub_workspace_layout_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "app_hub_user_layout" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "layout" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_hub_user_layout_pkey" PRIMARY KEY ("workspaceId","userId")
);

-- CreateIndex
CREATE INDEX "app_hub_workspace_layout_organizationId_idx" ON "app_hub_workspace_layout"("organizationId");

-- CreateIndex
CREATE INDEX "app_hub_user_layout_organizationId_idx" ON "app_hub_user_layout"("organizationId");
