-- CreateEnum
CREATE TYPE "BookingResourceKind" AS ENUM ('staff', 'place', 'equipment');

-- CreateEnum
CREATE TYPE "BookingAppointmentStatus" AS ENUM ('pending', 'confirmed', 'declined', 'arrived', 'done', 'cancelled', 'no_show');

-- CreateEnum
CREATE TYPE "BookingChangeKind" AS ENUM ('created', 'confirmed', 'declined', 'rescheduled', 'cancelled', 'arrived', 'done', 'no_show', 'details');

-- CreateEnum
CREATE TYPE "BookingChangeActor" AS ENUM ('staff', 'customer');

-- CreateEnum
CREATE TYPE "BookingReminderOutcome" AS ENUM ('sent', 'skipped_late', 'no_recipient');

-- CreateTable
CREATE TABLE "booking_service" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "bufferBeforeMinutes" INTEGER NOT NULL DEFAULT 0,
    "bufferAfterMinutes" INTEGER NOT NULL DEFAULT 0,
    "price" INTEGER,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_resource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "BookingResourceKind" NOT NULL,
    "userId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_service_resource" (
    "serviceId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "booking_service_resource_pkey" PRIMARY KEY ("serviceId","resourceId")
);

-- CreateTable
CREATE TABLE "booking_hours" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,

    CONSTRAINT "booking_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_exception" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "resourceId" TEXT,
    "day" DATE NOT NULL,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_exception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_appointment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "blockedFrom" TIMESTAMP(3) NOT NULL,
    "blockedUntil" TIMESTAMP(3) NOT NULL,
    "status" "BookingAppointmentStatus" NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "customerEmail" TEXT,
    "customerId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_change" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "BookingChangeKind" NOT NULL,
    "actorKind" "BookingChangeActor" NOT NULL,
    "actorId" TEXT,
    "fromStartsAt" TIMESTAMP(3),
    "toStartsAt" TIMESTAMP(3),
    "fromResourceId" TEXT,
    "toResourceId" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_reminder" (
    "appointmentId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "outcome" "BookingReminderOutcome" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_reminder_pkey" PRIMARY KEY ("appointmentId","startsAt")
);

-- CreateTable
CREATE TABLE "booking_settings" (
    "workspaceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slotMinutes" INTEGER NOT NULL DEFAULT 30,
    "reminderMinutes" INTEGER NOT NULL DEFAULT 15,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_settings_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateIndex
CREATE INDEX "booking_service_workspaceId_archivedAt_idx" ON "booking_service"("workspaceId", "archivedAt");

-- CreateIndex
CREATE INDEX "booking_service_organizationId_idx" ON "booking_service"("organizationId");

-- CreateIndex
CREATE INDEX "booking_resource_workspaceId_archivedAt_idx" ON "booking_resource"("workspaceId", "archivedAt");

-- CreateIndex
CREATE INDEX "booking_resource_organizationId_idx" ON "booking_resource"("organizationId");

-- CreateIndex
CREATE INDEX "booking_service_resource_resourceId_idx" ON "booking_service_resource"("resourceId");

-- CreateIndex
CREATE INDEX "booking_service_resource_organizationId_idx" ON "booking_service_resource"("organizationId");

-- CreateIndex
CREATE INDEX "booking_hours_resourceId_weekday_idx" ON "booking_hours"("resourceId", "weekday");

-- CreateIndex
CREATE INDEX "booking_hours_organizationId_idx" ON "booking_hours"("organizationId");

-- CreateIndex
CREATE INDEX "booking_exception_workspaceId_day_idx" ON "booking_exception"("workspaceId", "day");

-- CreateIndex
CREATE INDEX "booking_exception_organizationId_idx" ON "booking_exception"("organizationId");

-- CreateIndex
CREATE INDEX "booking_appointment_workspaceId_startsAt_idx" ON "booking_appointment"("workspaceId", "startsAt");

-- CreateIndex
CREATE INDEX "booking_appointment_resourceId_blockedFrom_idx" ON "booking_appointment"("resourceId", "blockedFrom");

-- CreateIndex
CREATE INDEX "booking_appointment_organizationId_idx" ON "booking_appointment"("organizationId");

-- CreateIndex
CREATE INDEX "booking_change_appointmentId_createdAt_idx" ON "booking_change"("appointmentId", "createdAt");

-- CreateIndex
CREATE INDEX "booking_change_organizationId_idx" ON "booking_change"("organizationId");

-- CreateIndex
CREATE INDEX "booking_reminder_organizationId_idx" ON "booking_reminder"("organizationId");

-- CreateIndex
CREATE INDEX "booking_settings_organizationId_idx" ON "booking_settings"("organizationId");

-- AddForeignKey
ALTER TABLE "booking_service_resource" ADD CONSTRAINT "booking_service_resource_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "booking_service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_service_resource" ADD CONSTRAINT "booking_service_resource_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "booking_resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_hours" ADD CONSTRAINT "booking_hours_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "booking_resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_exception" ADD CONSTRAINT "booking_exception_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "booking_resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_appointment" ADD CONSTRAINT "booking_appointment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "booking_service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_appointment" ADD CONSTRAINT "booking_appointment_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "booking_resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_change" ADD CONSTRAINT "booking_change_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "booking_appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_reminder" ADD CONSTRAINT "booking_reminder_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "booking_appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ⚠ NO DOUBLE BOOKING, kept by the database (docs/BOOKING-PLAN.md §3).
--
-- Written by hand: Prisma cannot express an exclusion constraint, so this is
-- not in prisma/booking.prisma and `prisma migrate dev` will never generate it.
--
-- Two bookings of ONE resource may not both hold a slot while their blocked
-- ranges share any time. The service looks for a clash before it writes, which
-- gives the usual refusal its sentence — but under READ COMMITTED two writes at
-- the same moment both look, both see nothing, and both insert. This is what
-- refuses the second (SQLSTATE 23P01, which the module answers as "that time
-- has just been taken").
--
--   "resourceId" WITH =      the same resource (needs btree_gist for text)
--   tsrange(…, '[)') WITH && their blocked ranges overlap; half-open, so one
--                            may start as the other ends
--   WHERE status IN (…)      only while BOTH still hold a slot
--
-- ⚠ THE STATUS LIST IS `BOOKING_HOLDING_STATUSES`
-- (packages/module-booking/src/domain/slots.ts). Changing that list needs a
-- new migration that drops and re-adds this constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "booking_appointment"
  ADD CONSTRAINT "booking_appointment_no_overlap"
  EXCLUDE USING gist (
    "resourceId" WITH =,
    tsrange("blockedFrom", "blockedUntil", '[)') WITH &&
  )
  WHERE ("status" IN ('pending', 'confirmed', 'arrived', 'done'));

-- A booking ends after it starts, and its blocked range contains it: the
-- constraint above reads the blocked range and nothing else, so a row whose
-- range was written backwards would block nothing.
ALTER TABLE "booking_appointment"
  ADD CONSTRAINT "booking_appointment_times_in_order"
  CHECK ("startsAt" < "endsAt" AND "blockedFrom" <= "startsAt" AND "endsAt" <= "blockedUntil");
