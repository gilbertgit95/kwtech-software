/**
 * What a backup file is called, and what can be read back from the name
 * (issue #2).
 *
 * ⚠ THE FOLDER IS THE RECORD. Nothing about a backup is in the database (the
 * operator, 2026-10-26): the Backups page lists the folder, and everything it
 * shows — which database, when, and why it was made — is in the FILE NAME, so
 * it survives the database being restored over, and a file copied in by hand
 * is listed like any other.
 *
 *   kwtech-2026-10-26-210003-daily.dump
 *   └db──┘ └day─────┘ └time┘ └kind┘
 *
 * The day and time are in the backup's time zone (`BACKUP_TIME_ZONE`, the
 * app's default zone unless set), the zone the daily 21:00 is measured in.
 */

/** Why a backup was made: somebody pressed "Back up now", the daily process, or a restore's safety copy. */
export const BACKUP_KINDS = ['manual', 'daily', 'before_restore'] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];

/** The kinds as they appear in a name. Hyphenated, because a name already separates its parts with them. */
const KIND_SUFFIX: Readonly<Record<BackupKind, string>> = {
  manual: 'manual',
  daily: 'daily',
  before_restore: 'before-restore',
};

export const BACKUP_FILE_EXTENSION = '.dump';

/** How many backups the folder keeps by default: the 31st deletes the oldest (the operator, 2026-10-26). */
export const BACKUP_KEEP_DEFAULT = 30;

/**
 * ⚠ THE ONLY NAMES THIS MODULE WILL READ, DOWNLOAD, DELETE OR RESTORE. A name
 * comes from the browser, so it is matched whole against this, never joined
 * to a path as given: no `/`, no `..`, no name it did not make. The database
 * part is what `backupDatabasePart` produces.
 */
const BACKUP_NAME =
  /^([a-z0-9_]{1,63})-(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})(\d{2})-(manual|daily|before-restore)\.dump$/u;

export interface ParsedBackupName {
  database: string;
  /** `YYYY-MM-DD`, in the backup's time zone. */
  dayKey: string;
  /** `HH:MM:SS`, in the same zone. */
  time: string;
  kind: BackupKind;
}

/** The database name as a name part: lower case, letters, digits and `_` only, so it can never be read as a path. */
export function backupDatabasePart(database: string): string {
  const part = database
    .toLowerCase()
    .replace(/[^a-z0-9_]/gu, '_')
    .slice(0, 63);
  return part.length > 0 ? part : 'database';
}

/** The name for a backup made at `at`, in `timeZone`. Seconds in it, so two backups a minute apart do not collide. */
export function backupFileName(database: string, at: Date, timeZone: string, kind: BackupKind): string {
  const parts = zonedParts(at, timeZone);
  const stamp = `${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
  return `${backupDatabasePart(database)}-${stamp}-${KIND_SUFFIX[kind]}${BACKUP_FILE_EXTENSION}`;
}

/** What a name says, or null for anything this module did not name — which it then never touches. */
export function parseBackupFileName(name: string): ParsedBackupName | null {
  const match = BACKUP_NAME.exec(name);
  if (!match) return null;
  const [, database, dayKey, hour, minute, second, suffix] = match;
  if (!database || !dayKey || !hour || !minute || !second || !suffix) return null;
  const kind = BACKUP_KINDS.find((one) => KIND_SUFFIX[one] === suffix);
  if (!kind) return null;
  return { database, dayKey, time: `${hour}:${minute}:${second}`, kind };
}

export function isBackupFileName(name: string): boolean {
  return parseBackupFileName(name) !== null;
}

/** A backup as the folder holds it. */
export interface BackupFileEntry {
  name: string;
  sizeBytes: number;
  /** When the file was last written: what orders the list, and what the retention keeps the newest of. */
  modifiedAt: Date;
}

/** Newest first: the order the page lists them in and the retention counts them in. */
export function sortBackups<T extends Pick<BackupFileEntry, 'name' | 'modifiedAt'>>(files: readonly T[]): T[] {
  return [...files].sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime() || b.name.localeCompare(a.name));
}

/**
 * Which backups to delete so that `keep` remain: the oldest, whatever their
 * kind (the operator, 2026-10-26: "the oldest be deleted if the number of
 * backups reach 31"). Only names this module made are counted or deleted.
 *
 * ⚠ `keep` below 1 is treated as 1. Retention must never delete the backup
 * that was just made — the one thing a backup run is for.
 */
export function planRetention(
  files: readonly BackupFileEntry[],
  keep: number,
  /**
   * Counted, but never deleted: the backup a restore is reading from. Kept
   * even when it is the oldest, so the folder may briefly hold one over.
   */
  protect: readonly string[] = [],
): BackupFileEntry[] {
  const floor = Math.max(1, Math.floor(keep));
  return sortBackups(files.filter((file) => isBackupFileName(file.name)))
    .slice(floor)
    .filter((file) => !protect.includes(file.name));
}

/** Whether the daily backup for `dayKey` (the backup zone's day) is already in the folder: the process's "done" record. */
export function hasDailyBackupFor(files: readonly Pick<BackupFileEntry, 'name'>[], dayKey: string): boolean {
  return files.some((file) => {
    const parsed = parseBackupFileName(file.name);
    return parsed?.kind === 'daily' && parsed.dayKey === dayKey;
  });
}

/**
 * Typed confirmation for a restore: the database's name, exactly. Trimmed,
 * because a pasted name brings a space with it; never case-folded, because
 * "close enough" is not a confirmation.
 */
export function checkRestoreConfirmation(typed: string, database: string): boolean {
  return typed.trim() === database;
}

function zonedParts(
  at: Date,
  timeZone: string,
): Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', string> {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => formatted.find((one) => one.type === type)?.value ?? '00';
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
  };
}
