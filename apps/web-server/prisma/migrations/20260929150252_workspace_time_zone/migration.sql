/*
  Warnings:

  - You are about to drop the column `timeZone` on the `pos_settings` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "perm_workspace" ADD COLUMN     "timeZone" TEXT NOT NULL DEFAULT 'Asia/Manila';

-- AlterTable
ALTER TABLE "pos_settings" DROP COLUMN "timeZone";
