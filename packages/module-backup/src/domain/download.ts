/**
 * The download handshake, shared by the API's route and the web app's
 * (`/next`): the page asks for a ticket, then sends the browser to
 * `BACKUP_DOWNLOAD_PATH?ticket=…`, which passes it on in this header.
 */
export const BACKUP_TICKET_HEADER = 'x-backup-ticket';

/** The web app's route the browser downloads from. */
export const BACKUP_DOWNLOAD_PATH = '/api/backups/download';

/** The API's route, under its own prefix (`/api/v1`). */
export const BACKUP_API_DOWNLOAD_PATH = '/backups/download';

/** 32 random bytes as base64url: 43 characters of `[A-Za-z0-9_-]`. Anything else is not worth a request. */
export function isBackupTicketShaped(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value);
}
