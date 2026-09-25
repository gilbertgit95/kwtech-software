-- AlterTable
ALTER TABLE "notification_batch" ADD COLUMN     "severity" "NotificationSeverity" NOT NULL DEFAULT 'info';
