-- A customer's one free-text "contact" becomes three optional fields: phone,
-- e-mail and a Facebook link (POS-PLAN D5, 2026-10-02).

-- AlterTable
ALTER TABLE "pos_customer" ADD COLUMN     "email" TEXT,
ADD COLUMN     "facebookUrl" TEXT,
ADD COLUMN     "phone" TEXT;

-- What was typed is kept, never dropped: a contact with an "@" was an e-mail
-- address, anything else a phone number. Orders are untouched: each keeps its
-- own copy in "customerContact".
UPDATE "pos_customer" SET "email" = "contact" WHERE "contact" LIKE '%@%';
UPDATE "pos_customer" SET "phone" = "contact" WHERE "contact" IS NOT NULL AND "contact" NOT LIKE '%@%';

-- AlterTable
ALTER TABLE "pos_customer" DROP COLUMN "contact";
