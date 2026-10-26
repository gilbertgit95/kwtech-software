import type { ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { PUBLIC_SURFACE_METADATA } from '@kwtech/module-kit';
import { Controller, Get, Headers, Logger, Res, SetMetadata } from '@nestjs/common';
import { BACKUP_TICKET_HEADER } from '../../domain/download.js';
import { backupRefusalMessage } from '../backup.errors.js';
import { BackupService } from '../backup.service.js';

/**
 * The bytes of one backup, for the ticket `issueBackupDownload` gave out.
 *
 * ## ⚠ WHY THIS MODULE HAS A CONTROLLER, when the rule is that new modules
 * expose no REST: a file is not a GraphQL value — the same reason, and the
 * same shape, as module-print's relay. Everything that DECIDES (who may
 * download which file) is the guarded mutation; this only spends its ticket.
 *
 * ## ⚠ PUBLIC, BUT NOT OPEN. No session reaches it: the ticket names one
 * file, is spent on use and lasts a minute, and is 256 random bits — not a
 * place a secret is guessed, so it carries no credential marker.
 *
 * ⚠ ONE ANSWER for a ticket unknown, spent or expired: 404, one message.
 */
@Controller('backups')
export class BackupDownloadController {
  private readonly log = new Logger('Backup');

  constructor(private readonly backups: BackupService) {}

  @SetMetadata(
    PUBLIC_SURFACE_METADATA,
    'A super admin’s browser fetches the backup a one-time ticket from issueBackupDownload names; the ticket is the authorisation',
  )
  @Get('download')
  async download(
    @Headers(BACKUP_TICKET_HEADER) ticket: string | undefined,
    @Res() response: ServerResponse,
  ): Promise<void> {
    const file = ticket ? await this.backups.redeem(ticket, new Date()) : null;
    if (!file) {
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ reason: 'ticket_invalid', message: backupRefusalMessage('ticket_invalid') }));
      return;
    }
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': String(file.sizeBytes),
      'content-disposition': `attachment; filename="${file.name}"`,
      // Every row of the database: nobody's to cache.
      'cache-control': 'no-store',
    });
    try {
      await pipeline(file.stream, response);
    } catch (error) {
      // The browser went away mid-download. The file is untouched; say so in the log and nothing else.
      this.log.warn({ event: 'backup.download_interrupted', name: file.name, error: String(error) });
    }
  }
}
