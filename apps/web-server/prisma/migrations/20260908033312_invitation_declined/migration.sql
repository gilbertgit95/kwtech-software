-- AlterEnum
ALTER TYPE "PermInvitationStatus" ADD VALUE 'declined';

-- AlterTable
ALTER TABLE "perm_invitation" ADD COLUMN     "declinedAt" TIMESTAMP(3);
