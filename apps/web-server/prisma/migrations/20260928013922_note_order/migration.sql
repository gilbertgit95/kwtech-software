-- AlterTable
ALTER TABLE "note_preference" ADD COLUMN     "noteOrder" TEXT[] DEFAULT ARRAY[]::TEXT[];
