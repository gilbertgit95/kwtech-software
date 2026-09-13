-- AlterTable
ALTER TABLE "queue_settings" ADD COLUMN     "voiceEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "voicePitch" TEXT NOT NULL DEFAULT 'normal',
ADD COLUMN     "voiceRepeat" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "voiceSpeed" TEXT NOT NULL DEFAULT 'normal',
ADD COLUMN     "voiceType" TEXT NOT NULL DEFAULT 'any',
ADD COLUMN     "voiceVolume" TEXT NOT NULL DEFAULT 'full';
