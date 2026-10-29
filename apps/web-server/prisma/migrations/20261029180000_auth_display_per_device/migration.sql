-- Display sizes kept PER DEVICE as well (the operator, 2026-10-29): a row is
-- one person's sizes for one layout on one device, or — deviceId '' — the
-- account's own for the layout, which a device without its own follows. Every
-- existing row is the account's, so the new column defaults to '' and
-- nobody's sizes change.

-- AlterTable
ALTER TABLE "auth_display_preference" DROP CONSTRAINT "auth_display_preference_pkey",
ADD COLUMN     "deviceId" TEXT NOT NULL DEFAULT '',
ADD CONSTRAINT "auth_display_preference_pkey" PRIMARY KEY ("userId", "layout", "deviceId");
