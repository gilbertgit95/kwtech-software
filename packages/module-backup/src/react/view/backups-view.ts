export { BACKUP_KIND_LABELS, formatBackupSize } from '../../domain/labels.js';

/** The whole folder's size, for the line under the heading. */
export function totalBackupSize(files: readonly { sizeBytes: number }[]): number {
  return files.reduce((sum, file) => sum + file.sizeBytes, 0);
}

/** "12 of 30 kept": how near the folder is to deleting its oldest. */
export function keptLine(count: number, keep: number): string {
  if (count < keep) return `${count} of ${keep} kept.`;
  return `${count} of ${keep} kept — the next backup deletes the oldest.`;
}

/** The command-line restore for one backup, as the README gives it: copied from the page into a terminal on the server. */
export function restoreCommand(name: string): string {
  return `pnpm --filter @kwtech/web-server backup:restore ${name}`;
}
