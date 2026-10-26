import type { Readable } from 'node:stream';
import type { BackupFileEntry } from '../domain/files.js';

/**
 * The backup folder and the database tools, implemented by the app (it knows
 * DATABASE_URL, where Postgres runs, and where the folder is). A module never
 * opens a database connection (PLAN §9), and running pg_dump is opening one.
 *
 * ⚠ NAMES ARRIVE CHECKED. The service passes only names `parseBackupFileName`
 * accepts; the store still resolves each inside its folder and refuses one
 * that would leave it, because a port is a boundary of its own.
 */
export interface BackupStore {
  /** The database's own name: the start of every file name, and what a restore asks to be typed. */
  database(): string;
  /** Every file in the folder. The service picks out the backups. */
  list(): Promise<BackupFileEntry[]>;
  /**
   * Writes a full dump under `name`. ⚠ Under a temporary name until pg_dump
   * succeeds, so a dump that died halfway is never listed as a backup.
   */
  create(name: string): Promise<BackupFileEntry>;
  /** Deletes one. False when it was not there. */
  remove(name: string): Promise<boolean>;
  /** The file to stream to a download, or null when it is not there. */
  open(name: string): Promise<{ stream: Readable; sizeBytes: number } | null>;
  /**
   * Replaces the database with `name`, in one transaction (so a failure
   * leaves the database as it was), then brings its schema up to this
   * version of the app.
   */
  restore(name: string): Promise<void>;
}

/** Whether `password` is this user's current one. */
export type BackupPasswordCheck = (userId: string, password: string) => Promise<boolean>;

/** Ends every session of every account, and refuses every access token issued before now. Returns how many ended. */
export type BackupEndSessions = () => Promise<number>;
