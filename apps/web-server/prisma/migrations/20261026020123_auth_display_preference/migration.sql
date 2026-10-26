-- CreateEnum
CREATE TYPE "AuthTextSize" AS ENUM ('small', 'normal', 'large', 'larger', 'largest');

-- CreateEnum
CREATE TYPE "AuthSpacing" AS ENUM ('compact', 'comfortable', 'roomy');

-- CreateTable
CREATE TABLE "auth_display_preference" (
    "userId" TEXT NOT NULL,
    "textSize" "AuthTextSize" NOT NULL DEFAULT 'normal',
    "spacing" "AuthSpacing" NOT NULL DEFAULT 'comfortable',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_display_preference_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "auth_display_preference" ADD CONSTRAINT "auth_display_preference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
