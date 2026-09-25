-- AlterEnum
ALTER TYPE "AuthMfaFactorType" ADD VALUE 'email';

-- CreateTable
CREATE TABLE "auth_mfa_email_code" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "auth_mfa_email_code_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_mfa_email_code_sessionId_consumedAt_idx" ON "auth_mfa_email_code"("sessionId", "consumedAt");

-- CreateIndex
CREATE INDEX "auth_mfa_email_code_userId_idx" ON "auth_mfa_email_code"("userId");

-- AddForeignKey
ALTER TABLE "auth_mfa_email_code" ADD CONSTRAINT "auth_mfa_email_code_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_mfa_email_code" ADD CONSTRAINT "auth_mfa_email_code_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "auth_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
