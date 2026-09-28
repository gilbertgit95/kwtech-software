/*
  Warnings:

  - Added the required column `boardId` to the `task_assignee` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "task_assignee" ADD COLUMN     "boardId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "task_task" ADD COLUMN     "commentCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "task_assignee_boardId_userId_idx" ON "task_assignee"("boardId", "userId");
