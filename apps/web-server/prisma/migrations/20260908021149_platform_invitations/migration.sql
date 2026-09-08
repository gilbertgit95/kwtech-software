-- AlterTable
ALTER TABLE "perm_invitation" ADD COLUMN     "appRoleId" TEXT,
ALTER COLUMN "organizationId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "perm_invitation_status_email_idx" ON "perm_invitation"("status", "email");

-- AddForeignKey
ALTER TABLE "perm_invitation" ADD CONSTRAINT "perm_invitation_appRoleId_fkey" FOREIGN KEY ("appRoleId") REFERENCES "perm_role"("id") ON DELETE SET NULL ON UPDATE CASCADE;
