import type { BackupRefusal } from '../types.js';

/** One sentence per refusal, said by the API and by the web app's download route alike. */
export function backupRefusalMessage(reason: BackupRefusal): string {
  switch (reason) {
    case 'not_signed_in':
      return 'Your session has ended. Sign in again.';
    case 'not_configured':
      return 'Backups are not set up on this server.';
    case 'busy':
      return 'A backup or restore is already running. Wait for it to finish.';
    case 'not_found':
      return 'That backup is not in the backup folder any more.';
    case 'invalid_name':
      return 'That is not the name of a backup.';
    case 'wrong_confirmation':
      return 'Type the database’s name exactly to confirm.';
    case 'wrong_password':
      return 'That password is not right.';
    case 'ticket_invalid':
      return 'That download link has expired. Start the download again from the Backups page.';
    case 'failed':
      return 'The database tool failed. The server log says why.';
  }
}
