-- CreateEnum
CREATE TYPE "AuthMfaFactorType" AS ENUM ('totp', 'webauthn');

-- AlterTable
ALTER TABLE "auth_session" ADD COLUMN     "mfaSatisfiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "auth_user" ADD COLUMN     "mfaRequiredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "auth_mfa_factor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AuthMfaFactorType" NOT NULL,
    "label" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedStep" BIGINT,

    CONSTRAINT "auth_mfa_factor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_recovery_code" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "auth_recovery_code_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_mfa_factor_userId_confirmedAt_idx" ON "auth_mfa_factor"("userId", "confirmedAt");

-- CreateIndex
CREATE UNIQUE INDEX "auth_mfa_factor_userId_label_key" ON "auth_mfa_factor"("userId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "auth_recovery_code_codeHash_key" ON "auth_recovery_code"("codeHash");

-- CreateIndex
CREATE INDEX "auth_recovery_code_userId_usedAt_idx" ON "auth_recovery_code"("userId", "usedAt");

-- AddForeignKey
ALTER TABLE "auth_mfa_factor" ADD CONSTRAINT "auth_mfa_factor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_recovery_code" ADD CONSTRAINT "auth_recovery_code_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
