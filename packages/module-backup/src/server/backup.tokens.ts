/**
 * The ports the app binds. ⚠ Each one UNBOUND fails closed, and says so:
 *
 *   BACKUP_STORE        — the folder and pg_dump/pg_restore. Unbound: the page
 *                         lists nothing and every act is refused "not set up".
 *   BACKUP_PASSWORD_CHECK — re-checks the restorer's password. Unbound: no
 *                         restore is possible, ever.
 *   BACKUP_END_SESSIONS — signs everybody out after a restore. Unbound: no
 *                         restore is possible, because a restored database
 *                         would bring back sessions somebody had ended.
 */
export const BACKUP_OPTIONS = 'kwtech:backup-options';
export const BACKUP_STORE = 'kwtech:backup-store';
export const BACKUP_PASSWORD_CHECK = 'kwtech:backup-password-check';
export const BACKUP_END_SESSIONS = 'kwtech:backup-end-sessions';
