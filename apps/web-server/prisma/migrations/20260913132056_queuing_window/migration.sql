-- CreateEnum
CREATE TYPE "QueueTicketStatus" AS ENUM ('called', 'done', 'no_show');

-- CreateTable
CREATE TABLE "queue_settings" (
    "workspaceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "showStaffNames" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_settings_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "queue_line" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "startNumber" INTEGER NOT NULL DEFAULT 1,
    "endNumber" INTEGER NOT NULL DEFAULT 999,
    "padTo" INTEGER NOT NULL DEFAULT 3,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_window" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_window_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_window_line" (
    "windowId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "queue_window_line_pkey" PRIMARY KEY ("windowId","lineId")
);

-- CreateTable
CREATE TABLE "queue_seat" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "windowId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_seat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_session" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "openWorkspaceId" TEXT,
    "displayCode" TEXT,
    "failedCodeAttempts" INTEGER NOT NULL DEFAULT 0,
    "maxDisplays" INTEGER NOT NULL,
    "continuedNumbering" BOOLEAN NOT NULL DEFAULT false,
    "startedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedById" TEXT,
    "stoppedAt" TIMESTAMP(3),

    CONSTRAINT "queue_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_display_pass" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "queue_display_pass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_sequence" (
    "lineId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL,
    "cycle" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_sequence_pkey" PRIMARY KEY ("lineId","sessionId")
);

-- CreateTable
CREATE TABLE "queue_ticket" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "status" "QueueTicketStatus" NOT NULL DEFAULT 'called',
    "windowId" TEXT NOT NULL,
    "windowName" TEXT NOT NULL,
    "calledById" TEXT NOT NULL,
    "firstCalledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recallCount" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "clientRequestId" TEXT,

    CONSTRAINT "queue_ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_staff_nickname" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_staff_nickname_pkey" PRIMARY KEY ("workspaceId","userId")
);

-- CreateIndex
CREATE INDEX "queue_settings_organizationId_idx" ON "queue_settings"("organizationId");

-- CreateIndex
CREATE INDEX "queue_line_organizationId_idx" ON "queue_line"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "queue_line_workspaceId_prefix_key" ON "queue_line"("workspaceId", "prefix");

-- CreateIndex
CREATE INDEX "queue_window_organizationId_idx" ON "queue_window"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "queue_window_workspaceId_nameKey_key" ON "queue_window"("workspaceId", "nameKey");

-- CreateIndex
CREATE INDEX "queue_window_line_lineId_idx" ON "queue_window_line"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "queue_seat_windowId_key" ON "queue_seat"("windowId");

-- CreateIndex
CREATE INDEX "queue_seat_organizationId_idx" ON "queue_seat"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "queue_seat_workspaceId_userId_key" ON "queue_seat"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "queue_session_openWorkspaceId_key" ON "queue_session"("openWorkspaceId");

-- CreateIndex
CREATE INDEX "queue_session_workspaceId_startedAt_idx" ON "queue_session"("workspaceId", "startedAt");

-- CreateIndex
CREATE INDEX "queue_session_organizationId_idx" ON "queue_session"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "queue_display_pass_tokenHash_key" ON "queue_display_pass"("tokenHash");

-- CreateIndex
CREATE INDEX "queue_display_pass_sessionId_idx" ON "queue_display_pass"("sessionId");

-- CreateIndex
CREATE INDEX "queue_sequence_sessionId_idx" ON "queue_sequence"("sessionId");

-- CreateIndex
CREATE INDEX "queue_ticket_sessionId_calledAt_idx" ON "queue_ticket"("sessionId", "calledAt");

-- CreateIndex
CREATE INDEX "queue_ticket_windowId_idx" ON "queue_ticket"("windowId");

-- CreateIndex
CREATE INDEX "queue_ticket_organizationId_idx" ON "queue_ticket"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "queue_ticket_lineId_sessionId_cycle_number_key" ON "queue_ticket"("lineId", "sessionId", "cycle", "number");

-- CreateIndex
CREATE UNIQUE INDEX "queue_ticket_sessionId_clientRequestId_key" ON "queue_ticket"("sessionId", "clientRequestId");

-- CreateIndex
CREATE INDEX "queue_staff_nickname_organizationId_idx" ON "queue_staff_nickname"("organizationId");

-- AddForeignKey
ALTER TABLE "queue_window_line" ADD CONSTRAINT "queue_window_line_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "queue_window"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_window_line" ADD CONSTRAINT "queue_window_line_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "queue_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_seat" ADD CONSTRAINT "queue_seat_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "queue_window"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_display_pass" ADD CONSTRAINT "queue_display_pass_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "queue_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_sequence" ADD CONSTRAINT "queue_sequence_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "queue_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_sequence" ADD CONSTRAINT "queue_sequence_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "queue_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_ticket" ADD CONSTRAINT "queue_ticket_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "queue_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_ticket" ADD CONSTRAINT "queue_ticket_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "queue_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
