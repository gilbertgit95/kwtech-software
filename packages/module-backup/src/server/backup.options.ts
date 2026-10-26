import { BACKUP_KEEP_DEFAULT } from '../domain/files.js';

export interface BackupModuleOptions {
  /** Principal → `userId`, for who did what in the log. The module never learns what a session is. */
  resolveActorId?: (request: unknown) => string | undefined;
  /**
   * The zone file names and the daily 21:00 are in. ⚠ Required in practice:
   * the app passes `BACKUP_TIME_ZONE` or its default zone. Absent, Asia/Manila
   * — never UTC, which would make "9 PM" 5 AM.
   */
  timeZone?: string;
  /** How many backups the folder keeps; a new one past it deletes the oldest. Default 30. */
  keep?: number;
  /** Validity of a download ticket, in seconds. Default 60: long enough to start a download, no longer. */
  downloadTicketSeconds?: number;

  /** The ports, as Nest providers (see backup.tokens.ts for what unbound means). */
  storeProvider?: unknown;
  passwordCheckProvider?: unknown;
  endSessionsProvider?: unknown;

  expose?: { graphql?: boolean; rest?: boolean };
}

export interface ResolvedBackupOptions {
  resolveActorId?: (request: unknown) => string | undefined;
  timeZone: string;
  keep: number;
  downloadTicketSeconds: number;
}

export function resolveBackupOptions(options: BackupModuleOptions): ResolvedBackupOptions {
  const keep = options.keep ?? BACKUP_KEEP_DEFAULT;
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error(`backupServerModule: keep must be a whole number of backups, at least 1 (was ${keep}).`);
  }
  return {
    timeZone: options.timeZone ?? 'Asia/Manila',
    keep,
    downloadTicketSeconds: options.downloadTicketSeconds ?? 60,
    ...(options.resolveActorId ? { resolveActorId: options.resolveActorId } : {}),
  };
}
