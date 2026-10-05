-- CreateTable
CREATE TABLE "studio_settings" (
    "workspaceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "keymap" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_settings_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateIndex
CREATE INDEX "studio_settings_organizationId_idx" ON "studio_settings"("organizationId");
