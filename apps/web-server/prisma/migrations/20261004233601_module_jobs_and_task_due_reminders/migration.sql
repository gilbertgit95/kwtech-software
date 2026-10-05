-- CreateEnum
CREATE TYPE "JobRunState" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'skipped', 'interrupted');

-- CreateEnum
CREATE TYPE "JobRunTrigger" AS ENUM ('scheduled', 'forced');

-- CreateEnum
CREATE TYPE "TaskDueReminderOutcome" AS ENUM ('sent', 'skipped_late', 'no_recipient');

-- CreateTable
CREATE TABLE "job_process" (
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "serves" TEXT,
    "defaultSchedule" JSONB NOT NULL,
    "scheduleLimits" JSONB NOT NULL,
    "maxRunSeconds" INTEGER NOT NULL,
    "maxItemsPerRun" INTEGER NOT NULL,
    "tooLateAfterMinutes" INTEGER NOT NULL,
    "deprecatedAt" TIMESTAMP(3),
    "schedule" JSONB,
    "scheduleSetById" TEXT,
    "scheduleSetAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "pausedById" TEXT,
    "pauseReason" TEXT,
    "activeRunId" TEXT,
    "lastQueuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_process_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "job_run" (
    "id" TEXT NOT NULL,
    "processKey" TEXT NOT NULL,
    "trigger" "JobRunTrigger" NOT NULL,
    "forcedById" TEXT,
    "state" "JobRunState" NOT NULL DEFAULT 'queued',
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "handled" INTEGER NOT NULL DEFAULT 0,
    "skippedLate" INTEGER NOT NULL DEFAULT 0,
    "leftForNext" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "error" TEXT,

    CONSTRAINT "job_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_queue_lock" (
    "id" TEXT NOT NULL,
    "touchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_queue_lock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_due_reminder" (
    "taskId" TEXT NOT NULL,
    "dueOn" DATE NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "outcome" "TaskDueReminderOutcome" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_due_reminder_pkey" PRIMARY KEY ("taskId","dueOn")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_process_activeRunId_key" ON "job_process"("activeRunId");

-- CreateIndex
CREATE INDEX "job_run_state_queuedAt_idx" ON "job_run"("state", "queuedAt");

-- CreateIndex
CREATE INDEX "job_run_processKey_queuedAt_idx" ON "job_run"("processKey", "queuedAt");

-- CreateIndex
CREATE INDEX "task_due_reminder_organizationId_idx" ON "task_due_reminder"("organizationId");

-- CreateIndex
CREATE INDEX "task_task_workspaceId_dueOn_idx" ON "task_task"("workspaceId", "dueOn");

-- AddForeignKey
ALTER TABLE "job_run" ADD CONSTRAINT "job_run_processKey_fkey" FOREIGN KEY ("processKey") REFERENCES "job_process"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_due_reminder" ADD CONSTRAINT "task_due_reminder_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task_task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
