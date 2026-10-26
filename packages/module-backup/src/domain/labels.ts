import type { BackupKind } from './files.js';

/*
 * Said the same way on the Backups page and at the command line: the pure
 * core, because both read them.
 */

/** What each kind is called on the page and at the command line. */
export const BACKUP_KIND_LABELS: Readonly<Record<BackupKind, string>> = {
  manual: 'Manual',
  daily: 'Daily',
  before_restore: 'Before a restore',
};

/** "512 KB", "3.4 MB", "1.2 GB": one decimal past a megabyte, none below. */
export function formatBackupSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
