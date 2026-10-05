-- AlterEnum
ALTER TYPE "BookingChangeActor" ADD VALUE 'system';

-- AlterTable
ALTER TABLE "booking_appointment" ADD COLUMN     "manageTokenHash" TEXT,
ADD COLUMN     "pendingSince" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "booking_settings" ADD COLUMN     "cutoffMinutes" INTEGER NOT NULL DEFAULT 120,
ADD COLUMN     "horizonDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "lapseHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "leadMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "publicEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicLinkId" TEXT,
ADD COLUMN     "publicNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "publicTitle" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "booking_appointment_manageTokenHash_key" ON "booking_appointment"("manageTokenHash");

-- CreateIndex
CREATE INDEX "booking_appointment_workspaceId_status_startsAt_idx" ON "booking_appointment"("workspaceId", "status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "booking_settings_publicLinkId_key" ON "booking_settings"("publicLinkId");

