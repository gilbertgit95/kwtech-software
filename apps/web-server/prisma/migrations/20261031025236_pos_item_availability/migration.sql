-- AlterTable
ALTER TABLE "pos_item" ADD COLUMN     "unavailableAt" TIMESTAMP(3),
ADD COLUMN     "unavailableById" TEXT;

-- AlterTable
ALTER TABLE "pos_item_variant" ADD COLUMN     "unavailableAt" TIMESTAMP(3),
ADD COLUMN     "unavailableById" TEXT;
