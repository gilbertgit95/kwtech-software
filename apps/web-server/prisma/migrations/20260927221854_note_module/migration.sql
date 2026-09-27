-- CreateEnum
CREATE TYPE "NoteVisibility" AS ENUM ('private', 'workspace');

-- CreateTable
CREATE TABLE "note_note" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "visibility" "NoteVisibility" NOT NULL DEFAULT 'private',
    "color" TEXT NOT NULL DEFAULT 'default',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "trashedAt" TIMESTAMP(3),
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "note_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note_pin" (
    "userId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_pin_pkey" PRIMARY KEY ("userId","noteId")
);

-- CreateTable
CREATE TABLE "note_revision" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "editedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note_preference" (
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "look" TEXT NOT NULL DEFAULT 'notebook',
    "font" TEXT NOT NULL DEFAULT 'hand',
    "defaultColor" TEXT NOT NULL DEFAULT 'default',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "note_preference_pkey" PRIMARY KEY ("userId","workspaceId")
);

-- CreateIndex
CREATE INDEX "note_note_workspaceId_visibility_trashedAt_updatedAt_idx" ON "note_note"("workspaceId", "visibility", "trashedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "note_note_workspaceId_authorId_trashedAt_idx" ON "note_note"("workspaceId", "authorId", "trashedAt");

-- CreateIndex
CREATE INDEX "note_note_organizationId_idx" ON "note_note"("organizationId");

-- CreateIndex
CREATE INDEX "note_pin_noteId_idx" ON "note_pin"("noteId");

-- CreateIndex
CREATE INDEX "note_pin_workspaceId_userId_idx" ON "note_pin"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "note_pin_organizationId_idx" ON "note_pin"("organizationId");

-- CreateIndex
CREATE INDEX "note_revision_noteId_createdAt_idx" ON "note_revision"("noteId", "createdAt");

-- CreateIndex
CREATE INDEX "note_revision_organizationId_idx" ON "note_revision"("organizationId");

-- CreateIndex
CREATE INDEX "note_preference_organizationId_idx" ON "note_preference"("organizationId");

-- AddForeignKey
ALTER TABLE "note_pin" ADD CONSTRAINT "note_pin_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "note_note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_revision" ADD CONSTRAINT "note_revision_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "note_note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
