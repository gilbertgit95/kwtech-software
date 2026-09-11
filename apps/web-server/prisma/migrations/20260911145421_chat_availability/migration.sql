-- CreateEnum
CREATE TYPE "ChatAvailabilityKind" AS ENUM ('available', 'busy', 'dnd', 'away', 'invisible');

-- CreateTable
CREATE TABLE "chat_availability" (
    "userId" TEXT NOT NULL,
    "availability" "ChatAvailabilityKind" NOT NULL DEFAULT 'available',
    "clearAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_availability_pkey" PRIMARY KEY ("userId")
);
