-- CreateEnum
CREATE TYPE "PermInvitationStatus" AS ENUM ('pending', 'accepted', 'revoked');

-- CreateTable
CREATE TABLE "perm_invitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "roleId" TEXT,
    "invitedByUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "PermInvitationStatus" NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "perm_invitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "perm_invitation_tokenHash_key" ON "perm_invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "perm_invitation_organizationId_status_idx" ON "perm_invitation"("organizationId", "status");

-- CreateIndex
CREATE INDEX "perm_invitation_email_idx" ON "perm_invitation"("email");

-- AddForeignKey
ALTER TABLE "perm_invitation" ADD CONSTRAINT "perm_invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "perm_organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perm_invitation" ADD CONSTRAINT "perm_invitation_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "perm_role"("id") ON DELETE SET NULL ON UPDATE CASCADE;
