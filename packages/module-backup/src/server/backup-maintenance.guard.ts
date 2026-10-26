import { type CanActivate, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { BackupService } from './backup.service.js';

/** What every request is told while a restore runs. */
export const BACKUP_MAINTENANCE_MESSAGE = 'The database is being restored from a backup. Try again in a minute.';

/**
 * Refuses every request while a restore replaces the database (issue #2).
 *
 * ⚠ THE APP INSTALLS IT, FIRST among its global guards (`APP_GUARD`), because
 * only the app sees every request; a module's guard would see its own. First,
 * so a request is turned away before anything reads a session from a database
 * being replaced. The restore's own request is already past it.
 *
 * 503, not 401: nobody's session is wrong, the server is busy. The web app
 * reads a 5xx as "cannot reach the server" and waits, rather than signing
 * anybody out (session-query.ts) — and once the restore ends, everybody is
 * signed out on purpose.
 */
@Injectable()
export class BackupMaintenanceGuard implements CanActivate {
  constructor(private readonly backups: BackupService) {}

  canActivate(): boolean {
    if (this.backups.inMaintenance()) throw new ServiceUnavailableException(BACKUP_MAINTENANCE_MESSAGE);
    return true;
  }
}
