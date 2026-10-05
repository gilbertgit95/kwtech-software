-- CreateEnum
CREATE TYPE "JobControlAction" AS ENUM ('paused', 'resumed', 'forced', 'rescheduled', 'reset_schedule');

-- CreateTable
CREATE TABLE "job_control" (
    "id" TEXT NOT NULL,
    "processKey" TEXT NOT NULL,
    "action" "JobControlAction" NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT,
    "scheduleFrom" JSONB,
    "scheduleTo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_control_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_control_processKey_createdAt_idx" ON "job_control"("processKey", "createdAt");

-- AddForeignKey
ALTER TABLE "job_control" ADD CONSTRAINT "job_control_processKey_fkey" FOREIGN KEY ("processKey") REFERENCES "job_process"("key") ON DELETE CASCADE ON UPDATE CASCADE;
