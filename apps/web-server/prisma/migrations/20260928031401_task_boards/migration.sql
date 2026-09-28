-- CreateEnum
CREATE TYPE "TaskBoardVisibility" AS ENUM ('private', 'workspace');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateTable
CREATE TABLE "task_board" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visibility" "TaskBoardVisibility" NOT NULL DEFAULT 'workspace',
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_column" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "rank" DOUBLE PRECISION NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_column_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_task" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "columnId" TEXT NOT NULL,
    "rank" DOUBLE PRECISION NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "priority" "TaskPriority" NOT NULL DEFAULT 'normal',
    "scheduledOn" DATE,
    "dueOn" DATE,
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "completedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_assignee" (
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_assignee_pkey" PRIMARY KEY ("taskId","userId")
);

-- CreateTable
CREATE TABLE "task_checklist_item" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "rank" DOUBLE PRECISION NOT NULL,
    "doneById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_checklist_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_comment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_preference" (
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "view" TEXT NOT NULL DEFAULT 'board',
    "lastBoardId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_preference_pkey" PRIMARY KEY ("userId","workspaceId")
);

-- CreateIndex
CREATE INDEX "task_board_workspaceId_ownerId_idx" ON "task_board"("workspaceId", "ownerId");

-- CreateIndex
CREATE INDEX "task_board_workspaceId_visibility_archivedAt_idx" ON "task_board"("workspaceId", "visibility", "archivedAt");

-- CreateIndex
CREATE INDEX "task_board_organizationId_idx" ON "task_board"("organizationId");

-- CreateIndex
CREATE INDEX "task_column_boardId_rank_idx" ON "task_column"("boardId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "task_column_boardId_nameKey_key" ON "task_column"("boardId", "nameKey");

-- CreateIndex
CREATE INDEX "task_task_boardId_archivedAt_columnId_rank_idx" ON "task_task"("boardId", "archivedAt", "columnId", "rank");

-- CreateIndex
CREATE INDEX "task_task_workspaceId_creatorId_idx" ON "task_task"("workspaceId", "creatorId");

-- CreateIndex
CREATE INDEX "task_task_columnId_idx" ON "task_task"("columnId");

-- CreateIndex
CREATE INDEX "task_task_organizationId_idx" ON "task_task"("organizationId");

-- CreateIndex
CREATE INDEX "task_assignee_workspaceId_userId_idx" ON "task_assignee"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "task_assignee_organizationId_idx" ON "task_assignee"("organizationId");

-- CreateIndex
CREATE INDEX "task_checklist_item_taskId_rank_idx" ON "task_checklist_item"("taskId", "rank");

-- CreateIndex
CREATE INDEX "task_checklist_item_organizationId_idx" ON "task_checklist_item"("organizationId");

-- CreateIndex
CREATE INDEX "task_comment_taskId_createdAt_idx" ON "task_comment"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "task_comment_organizationId_idx" ON "task_comment"("organizationId");

-- CreateIndex
CREATE INDEX "task_preference_organizationId_idx" ON "task_preference"("organizationId");

-- AddForeignKey
ALTER TABLE "task_column" ADD CONSTRAINT "task_column_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "task_board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_task" ADD CONSTRAINT "task_task_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "task_board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_task" ADD CONSTRAINT "task_task_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "task_column"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignee" ADD CONSTRAINT "task_assignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task_task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_checklist_item" ADD CONSTRAINT "task_checklist_item_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task_task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comment" ADD CONSTRAINT "task_comment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task_task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
