/**
 * `@kwtech/module-backup/next` — the web app's download route for a backup.
 *
 * The browser never talks to the API directly (the web app's `config/env.ts`),
 * and a file is not JSON, so it has a handler of its own, like module-print's
 * relay. It passes the API's answer back AS A STREAM: the web app holds no
 * more of the file than the server does.
 *
 * ⚠ NO SESSION IS READ OR ATTACHED. The one-time ticket from
 * `issueBackupDownload` is the authorisation; the session did its work when
 * the ticket was issued. So this forwards exactly one header, to one path.
 *
 * Adopting it is one file:
 *
 *   // app/api/backups/download/route.ts
 *   export const { GET } = createBackupDownloadRouteHandlers();
 *
 * Plain Web `Request`/`Response`; imports neither `/server` nor `/react`.
 */
import { BACKUP_API_DOWNLOAD_PATH, BACKUP_TICKET_HEADER, isBackupTicketShaped } from '../domain/download.js';
import { backupRefusalMessage } from '../domain/messages.js';

export interface BackupDownloadNextOptions {
  /** The API's base URL. Falls back to `API_URL`; with neither, 503 — it never guesses where the server is. */
  apiUrl?: string;
}

function json(status: number, reason: string, message: string): Response {
  return new Response(JSON.stringify({ reason, message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Headers of the API's answer worth passing on to the browser. Nothing else crosses. */
const PASSED_ON = ['content-type', 'content-length', 'content-disposition', 'cache-control'] as const;

export function createBackupDownloadRouteHandlers(options: BackupDownloadNextOptions = {}) {
  async function GET(request: Request): Promise<Response> {
    const apiUrl = (options.apiUrl ?? process.env.API_URL)?.replace(/\/+$/u, '');
    if (!apiUrl) return json(503, 'not_configured', 'Backups are not set up on this server.');

    const ticket = new URL(request.url).searchParams.get('ticket');
    // Refused here, unsent: a ticket of the wrong shape cannot be one the server gave out.
    if (!isBackupTicketShaped(ticket)) return json(404, 'ticket_invalid', backupRefusalMessage('ticket_invalid'));

    let answer: Response;
    try {
      answer = await fetch(`${apiUrl}${BACKUP_API_DOWNLOAD_PATH}`, {
        headers: { [BACKUP_TICKET_HEADER]: ticket },
        cache: 'no-store',
      });
    } catch {
      return json(503, 'unreachable', 'Cannot reach the server.');
    }
    const headers = new Headers();
    for (const name of PASSED_ON) {
      const value = answer.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(answer.body, { status: answer.status, headers });
  }

  return { GET };
}
