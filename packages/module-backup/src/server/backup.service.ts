import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { type ProcessRunContext, type ProcessRunResult, processOccurrence } from '@kwtech/module-kit';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type BackupFileEntry,
  type BackupKind,
  backupFileName,
  checkRestoreConfirmation,
  hasDailyBackupFor,
  parseBackupFileName,
  planRetention,
  sortBackups,
} from '../domain/files.js';
import type { BackupActivity, BackupFileView } from '../types.js';
import { BackupWriteError } from './backup.errors.js';
import type { ResolvedBackupOptions } from './backup.options.js';
import { BACKUP_END_SESSIONS, BACKUP_OPTIONS, BACKUP_PASSWORD_CHECK, BACKUP_STORE } from './backup.tokens.js';
import type { BackupEndSessions, BackupPasswordCheck, BackupStore } from './ports.js';

/** What the Backups page shows. */
export interface BackupState {
  activity: BackupActivity;
  maintenance: boolean;
  database: string;
  keep: number;
  timeZone: string;
  files: BackupFileView[];
}

interface DownloadTicket {
  name: string;
  actorId: string;
  expiresAt: number;
}

/**
 * Every backup act, for the page, the daily process and the download route
 * (issue #2).
 *
 * ⚠ NOTHING HERE IS STORED. Which backups exist is the folder; what is running,
 * maintenance and the download tickets are this object's memory; WHO DID WHAT
 * is the log, line by line (the operator, 2026-10-26: "the logs is good for
 * audit trails"). A restart forgets a ticket, which is the safe direction: it
 * only ever lets somebody download once more by asking again.
 *
 * ⚠ ONE AT A TIME. A backup and a restore never overlap, and nor do two of
 * either: a second is refused `busy`, never queued, so pressing the button
 * twice is one backup. In memory, so per server process — this app runs one.
 */
@Injectable()
export class BackupService {
  private readonly log = new Logger('Backup');
  private activity: BackupActivity = 'idle';
  private maintenance = false;
  private readonly tickets = new Map<string, DownloadTicket>();

  constructor(
    @Inject(BACKUP_OPTIONS) private readonly options: ResolvedBackupOptions,
    @Optional() @Inject(BACKUP_STORE) private readonly store?: BackupStore,
    @Optional() @Inject(BACKUP_PASSWORD_CHECK) private readonly passwordCheck?: BackupPasswordCheck,
    @Optional() @Inject(BACKUP_END_SESSIONS) private readonly endSessions?: BackupEndSessions,
  ) {}

  /** While a restore runs: the app's guard answers every other request "under maintenance". */
  inMaintenance(): boolean {
    return this.maintenance;
  }

  async state(): Promise<BackupState> {
    const store = this.requireStore();
    return {
      activity: this.activity,
      maintenance: this.maintenance,
      database: store.database(),
      keep: this.options.keep,
      timeZone: this.options.timeZone,
      files: (await this.backups(store)).map(render),
    };
  }

  /** Back up now, or the daily run (`actorId` null). Then the oldest past the limit are deleted. */
  async create(actorId: string | null, kind: BackupKind, now: Date): Promise<BackupFileView> {
    const store = this.requireStore();
    return this.exclusive('backing_up', async () => {
      const file = await this.dump(store, actorId, kind, now);
      await this.applyRetention(store, actorId, []);
      return render(file);
    });
  }

  async remove(actorId: string, name: string): Promise<void> {
    const store = this.requireStore();
    this.requireName(name);
    // A restore reading this file must not lose it halfway.
    if (this.activity === 'restoring') throw new BackupWriteError('busy');
    if (!(await store.remove(name))) throw new BackupWriteError('not_found');
    this.log.log({ event: 'backup.deleted', name, actorId });
  }

  /**
   * A one-time ticket for one file, spent by the download route. A file is not
   * a GraphQL value (module-print's relay, PLAN §13 2026-10-07), so the
   * authorised step is here and the bytes go through a route of their own.
   * 256 random bits: unguessable, so the route needs no session.
   */
  async issueDownload(actorId: string, name: string, now: Date): Promise<string> {
    const store = this.requireStore();
    this.requireName(name);
    if (!(await this.backups(store)).some((file) => file.name === name)) throw new BackupWriteError('not_found');
    this.forgetExpired(now);
    const ticket = randomBytes(32).toString('base64url');
    this.tickets.set(ticket, { name, actorId, expiresAt: now.getTime() + this.options.downloadTicketSeconds * 1000 });
    return ticket;
  }

  /** Spends a ticket. Null for one unknown, spent or expired — one answer for all three. */
  async redeem(ticket: string, now: Date): Promise<{ name: string; stream: Readable; sizeBytes: number } | null> {
    this.forgetExpired(now);
    const held = this.tickets.get(ticket);
    if (!held || !this.store) return null;
    this.tickets.delete(ticket);
    const opened = await this.store.open(held.name);
    if (!opened) return null;
    this.log.log({ event: 'backup.downloaded', name: held.name, actorId: held.actorId, sizeBytes: opened.sizeBytes });
    return { name: held.name, ...opened };
  }

  /**
   * Replaces the database with a backup. In this order, each step a reason to
   * stop before the next:
   *
   *   1. the name, the typed database name and the password are checked;
   *   2. a SAFETY BACKUP of the database as it is now — if that fails, nothing
   *      else happens, because a restore with no way back is not offered;
   *   3. maintenance: every other request is refused while it runs;
   *   4. the restore, in one transaction (a failure leaves the database as it
   *      was), then the schema brought up to this version of the app;
   *   5. everybody signed out — the restored database holds sessions from the
   *      backup's day, some of them ended since — the restorer included.
   *
   * ⚠ No ports, no restore: without the password check or the sign-out it is
   * refused as not set up, never run with a step missing.
   */
  async restore(actorId: string, name: string, confirmation: string, password: string, now: Date): Promise<void> {
    const store = this.requireStore();
    if (!this.passwordCheck || !this.endSessions) throw new BackupWriteError('not_configured');
    this.requireName(name);
    if (!(await this.backups(store)).some((file) => file.name === name)) throw new BackupWriteError('not_found');
    if (!checkRestoreConfirmation(confirmation, store.database())) throw new BackupWriteError('wrong_confirmation');
    if (!(await this.passwordCheck(actorId, password))) {
      this.log.warn({ event: 'backup.restore_refused', reason: 'wrong_password', name, actorId });
      throw new BackupWriteError('wrong_password');
    }

    const endSessions = this.endSessions;
    await this.exclusive('restoring', async () => {
      const safety = await this.dump(store, actorId, 'before_restore', now);
      this.log.warn({ event: 'backup.restore_started', name, actorId, safetyBackup: safety.name });
      this.maintenance = true;
      try {
        await store.restore(name);
        const ended = await endSessions();
        this.log.warn({ event: 'backup.restored', name, actorId, sessionsEnded: ended });
      } catch (error) {
        this.log.error({
          event: 'backup.restore_failed',
          name,
          actorId,
          safetyBackup: safety.name,
          error: describe(error),
        });
        throw new BackupWriteError('failed');
      } finally {
        this.maintenance = false;
      }
      // After, and never touching the file just restored from.
      await this.applyRetention(store, actorId, [name]);
    });
  }

  /**
   * The daily backup (`backup.daily`). "Done today" is the folder: a daily
   * backup named for the backup zone's day. So a second run that day — a
   * restart, a Run now — makes nothing.
   */
  async runDaily(context: ProcessRunContext): Promise<ProcessRunResult> {
    const result = { handled: 0, skippedLate: 0, leftForNext: 0 };
    if (!this.store) {
      this.log.warn({ event: 'backup.daily_skipped', reason: 'not_configured' });
      return result;
    }
    const occurrence = processOccurrence(
      context.schedule,
      context.now,
      this.options.timeZone,
      context.tooLateAfterMinutes,
    );
    if (occurrence.kind === 'none') return result;
    if (hasDailyBackupFor(await this.store.list(), occurrence.dayKey)) return result;
    if (occurrence.kind === 'too_late') {
      this.log.warn({ event: 'backup.daily_skipped', reason: 'too_late', day: occurrence.dayKey });
      return { ...result, skippedLate: 1 };
    }
    // Somebody's own backup or a restore is running: the next sweep, minutes from now, makes today's.
    if (this.activity !== 'idle') return { ...result, leftForNext: 1 };
    await this.create(null, 'daily', context.now);
    return { ...result, handled: 1 };
  }

  // ── the parts ───────────────────────────────────────────────────────────

  private async dump(
    store: BackupStore,
    actorId: string | null,
    kind: BackupKind,
    now: Date,
  ): Promise<BackupFileEntry> {
    const name = backupFileName(store.database(), now, this.options.timeZone, kind);
    try {
      const file = await store.create(name);
      this.log.log({ event: 'backup.created', name, kind, actorId, sizeBytes: file.sizeBytes });
      return file;
    } catch (error) {
      this.log.error({ event: 'backup.create_failed', name, kind, actorId, error: describe(error) });
      throw new BackupWriteError('failed');
    }
  }

  /**
   * Deletes the oldest past the limit (the operator, 2026-10-26: the 31st
   * deletes the oldest). ⚠ A failed deletion is logged and never fails the
   * backup that was just made, which succeeded.
   */
  private async applyRetention(store: BackupStore, actorId: string | null, protect: readonly string[]): Promise<void> {
    for (const old of planRetention(await store.list(), this.options.keep, protect)) {
      try {
        await store.remove(old.name);
        this.log.log({
          event: 'backup.deleted',
          name: old.name,
          actorId,
          reason: `over the limit of ${this.options.keep}`,
        });
      } catch (error) {
        this.log.error({ event: 'backup.retention_failed', name: old.name, error: describe(error) });
      }
    }
  }

  private async exclusive<T>(activity: Exclude<BackupActivity, 'idle'>, work: () => Promise<T>): Promise<T> {
    if (this.activity !== 'idle') throw new BackupWriteError('busy');
    this.activity = activity;
    try {
      return await work();
    } finally {
      this.activity = 'idle';
    }
  }

  private async backups(store: BackupStore): Promise<BackupFileEntry[]> {
    return sortBackups((await store.list()).filter((file) => parseBackupFileName(file.name) !== null));
  }

  private requireStore(): BackupStore {
    if (!this.store) throw new BackupWriteError('not_configured');
    return this.store;
  }

  private requireName(name: string): void {
    if (!parseBackupFileName(name)) throw new BackupWriteError('invalid_name');
  }

  private forgetExpired(now: Date): void {
    for (const [ticket, held] of this.tickets) {
      if (held.expiresAt <= now.getTime()) this.tickets.delete(ticket);
    }
  }
}

function render(file: BackupFileEntry): BackupFileView {
  // Only names `parseBackupFileName` accepted reach here, so the kind is always there.
  const kind = parseBackupFileName(file.name)?.kind ?? 'manual';
  return { name: file.name, kind, sizeBytes: file.sizeBytes, createdAt: file.modifiedAt.toISOString() };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
