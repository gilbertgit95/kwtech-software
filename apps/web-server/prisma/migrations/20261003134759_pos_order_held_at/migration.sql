-- AlterTable
ALTER TABLE "pos_order" ADD COLUMN     "heldAt" TIMESTAMP(3);

-- Every order open at this moment was listed as pending under the old rule
-- (open = pending), and some of them really are held: table 3 must not vanish
-- from the list because the rule changed. They cannot be told apart from carts
-- left behind, so all of them stay listed, with the time they were started.
-- A cart that was only a try can be cancelled from the list.
UPDATE "pos_order" SET "heldAt" = "createdAt" WHERE "status" = 'open' AND "heldAt" IS NULL;
