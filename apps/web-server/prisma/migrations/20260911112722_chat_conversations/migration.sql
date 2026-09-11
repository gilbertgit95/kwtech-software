-- CreateEnum
CREATE TYPE "ChatParticipantStatus" AS ENUM ('invited', 'active', 'declined', 'left', 'removed');

-- CreateEnum
CREATE TYPE "ChatMessageKind" AS ENUM ('user', 'system');

-- CreateTable
CREATE TABLE "chat_conversation" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "icon" TEXT,
    "directKey" TEXT,
    "createdById" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_participant" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ChatParticipantStatus" NOT NULL DEFAULT 'invited',
    "invitedById" TEXT,
    "lastReadMessageId" TEXT,
    "mutedUntil" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "kind" "ChatMessageKind" NOT NULL DEFAULT 'user',
    "authorId" TEXT,
    "body" TEXT,
    "clientMessageId" TEXT,
    "replyToMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "metadata" JSONB,

    CONSTRAINT "chat_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_block" (
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_block_pkey" PRIMARY KEY ("blockerId","blockedId")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_conversation_directKey_key" ON "chat_conversation"("directKey");

-- CreateIndex
CREATE INDEX "chat_conversation_lastMessageAt_idx" ON "chat_conversation"("lastMessageAt");

-- CreateIndex
CREATE INDEX "chat_conversation_createdById_idx" ON "chat_conversation"("createdById");

-- CreateIndex
CREATE INDEX "chat_participant_userId_status_idx" ON "chat_participant"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "chat_participant_conversationId_userId_key" ON "chat_participant"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "chat_message_conversationId_createdAt_id_idx" ON "chat_message"("conversationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_message_conversationId_clientMessageId_key" ON "chat_message"("conversationId", "clientMessageId");

-- CreateIndex
CREATE INDEX "chat_block_blockedId_idx" ON "chat_block"("blockedId");

-- AddForeignKey
ALTER TABLE "chat_participant" ADD CONSTRAINT "chat_participant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
