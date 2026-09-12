-- CreateEnum
CREATE TYPE "ChatParticipantRole" AS ENUM ('owner', 'admin', 'member');

-- AlterTable
ALTER TABLE "chat_participant" ADD COLUMN     "role" "ChatParticipantRole" NOT NULL DEFAULT 'member';

-- ⚠ BACKFILL: every group that already exists has no owner, and a group with no
-- owner is one nobody can rename, archive or hand on — a dead end created by
-- the migration itself.
--
-- The creator is the only defensible answer. `createdById` is who stood the
-- conversation up and is what the group-chat cap already counts, and until this
-- column existed it was the de facto owner: archiving was hardcoded to it.
--
-- ⚠ Their PARTICIPANT ROW MUST STILL BE ACTIVE. A creator who left is not the
-- owner of anything, and promoting them would hand a live group to somebody who
-- is not in it. Those groups come out of this with no owner, which is the
-- honest result — `successorTo` is for owners who leave AFTER this, and a group
-- whose creator walked out before it had the concept never had one to lose.
UPDATE "chat_participant" AS p
SET "role" = 'owner'
FROM "chat_conversation" AS c
WHERE p."conversationId" = c."id"
  AND p."userId" = c."createdById"
  AND p."status" = 'active'
  -- ⚠ GROUPS ONLY. A direct chat has no roles: both people are equal in it and
  -- every act a role governs is refused there anyway. Marking one side `owner`
  -- would be a claim the product does not make.
  AND c."directKey" IS NULL;
