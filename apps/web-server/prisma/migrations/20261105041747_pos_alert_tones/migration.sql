-- AlterTable
ALTER TABLE "pos_settings" ADD COLUMN     "alertTones" JSONB;

-- CreateTable
CREATE TABLE "pos_user_settings" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "alertTones" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_user_settings_pkey" PRIMARY KEY ("workspaceId","userId")
);

-- CreateIndex
CREATE INDEX "pos_user_settings_organizationId_idx" ON "pos_user_settings"("organizationId");
