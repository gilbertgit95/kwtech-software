-- DropIndex
DROP INDEX "file_ticket_expiresAt_idx";

-- CreateIndex
CREATE INDEX "file_ticket_workspaceId_expiresAt_idx" ON "file_ticket"("workspaceId", "expiresAt");
