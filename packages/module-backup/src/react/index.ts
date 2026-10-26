/**
 * `@kwtech/module-backup/react` — the Backups page and its descriptor. Never
 * imports `/server`. NAMED re-exports, as module-auth's barrel explains.
 */
export { type BackupClient, type BackupStateView, createBackupClient } from './backup-client.js';
export { BACKUPS_ADMIN_HREF, type BackupWebModuleOptions, backupWebModule, DATABASE_NAV_GROUP } from './module.js';
export { BackupsPage, type BackupsPageProps } from './pages/backups-page.js';
export { useBackups } from './use-backups.js';
