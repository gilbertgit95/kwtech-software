-- AlterTable
ALTER TABLE "perm_organization" ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "perm_workspace" ADD COLUMN     "description" TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: every existing row gets its NAME as its initial description.
--
-- The column is nullable, so this is not required to make the schema valid — it
-- is here so no row that predates the column reads as blank on a screen that
-- now has a description field. A tenant sees a starting value they can replace
-- rather than an empty box they have to notice.
--
-- ⚠ It carries no information the name does not. That is what "initial" means
-- here: it is a placeholder occupying the field, not a description anybody
-- wrote, and the settings screens exist to replace it.
--
-- `WHERE description IS NULL` rather than an unconditional UPDATE, so re-running
-- this against a database where somebody has already written one cannot
-- overwrite it. Migrations run once, but a hand-replayed one should not destroy
-- data, and the guard costs nothing.
UPDATE "perm_organization" SET "description" = "name" WHERE "description" IS NULL;
UPDATE "perm_workspace"    SET "description" = "name" WHERE "description" IS NULL;
