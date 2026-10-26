import type { BackupKind } from './domain/files.js';

/** One backup in the folder, as the page shows it. */
export interface BackupFileView {
  name: string;
  kind: BackupKind;
  sizeBytes: number;
  /** ISO-8601: when the file was written. */
  createdAt: string;
}

/** What this server is doing with its database right now. In memory: nothing here is stored. */
export type BackupActivity = 'idle' | 'backing_up' | 'restoring';

/** Every reason a backup act is refused. Each has one sentence in `backup.errors.ts`. */
export type BackupRefusal =
  | 'not_signed_in'
  | 'not_configured'
  | 'busy'
  | 'not_found'
  | 'invalid_name'
  | 'wrong_confirmation'
  | 'wrong_password'
  | 'ticket_invalid'
  | 'failed';
