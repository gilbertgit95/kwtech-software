/**
 * `@kwtech/module-file-manager/next` — the web app's two routes for a file's
 * bytes: the upload going in, the download coming out.
 *
 * The browser never talks to the API directly (the web app's `config/env.ts`),
 * and a file is not JSON, so each has a handler of its own, as module-print's
 * relay and module-backup's download do. Both pass the bytes on AS A STREAM:
 * the web app holds no more of a file than the server does.
 *
 * ⚠ NO SESSION IS READ OR ATTACHED. The one-time ticket from
 * `startFileUpload` / `issueFileDownload` is the authorisation; the session
 * did its work when the ticket was issued. So each forwards exactly one
 * header, to one path.
 *
 * Adopting them is two files:
 *
 *   // app/api/files/upload/route.ts
 *   export const { PUT } = createFileUploadRouteHandlers();
 *   // app/api/files/download/route.ts
 *   export const { GET } = createFileDownloadRouteHandlers();
 *
 * ⚠ AND KEEP THE APP'S PROXY (MIDDLEWARE) OFF `/api/files`. Next reads a
 * request's body to run a proxy over it, up to a size limit, and a file past
 * the limit arrives cut short.
 *
 * Plain Web `Request`/`Response`; imports neither `/server` nor `/react`.
 */
import { fileRefusalMessage } from '../domain/messages.js';
import {
  FILE_API_DOWNLOAD_PATH,
  FILE_API_UPLOAD_PATH,
  FILE_DOWNLOAD_TICKET_HEADER,
  FILE_UPLOAD_TICKET_HEADER,
  isFileTicketShaped,
} from '../domain/transfer.js';

export interface FileTransferNextOptions {
  /** The API's base URL. Falls back to `API_URL`; with neither, 503 — it never guesses where the server is. */
  apiUrl?: string;
}

function json(status: number, reason: string, message: string): Response {
  return new Response(JSON.stringify({ reason, message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function apiUrlOf(options: FileTransferNextOptions): string | null {
  return (options.apiUrl ?? process.env.API_URL)?.replace(/\/+$/u, '') ?? null;
}

const TICKET_INVALID = () => json(404, 'ticket_invalid', fileRefusalMessage('ticket_invalid'));
const NOT_CONFIGURED = () => json(503, 'not_configured', fileRefusalMessage('not_configured'));

export function createFileUploadRouteHandlers(options: FileTransferNextOptions = {}) {
  /** The file's bytes, from the browser, passed on as they arrive. */
  async function PUT(request: Request): Promise<Response> {
    const apiUrl = apiUrlOf(options);
    if (!apiUrl) return NOT_CONFIGURED();
    const ticket = request.headers.get(FILE_UPLOAD_TICKET_HEADER);
    // Refused here, unsent: no ticket of the right shape, or no body, cannot be an upload the server admitted.
    if (!isFileTicketShaped(ticket) || !request.body) return TICKET_INVALID();

    let upstream: Response;
    try {
      upstream = await fetch(`${apiUrl}${FILE_API_UPLOAD_PATH}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/octet-stream',
          [FILE_UPLOAD_TICKET_HEADER]: ticket,
          // The API rate-limits per address, and from its side every request comes from this server.
          'x-forwarded-for': request.headers.get('x-forwarded-for') ?? '',
        },
        body: request.body,
        // Required to send a stream: the body is passed on while it is still arriving.
        duplex: 'half',
        cache: 'no-store',
      } as RequestInit);
    } catch {
      return json(502, 'interrupted', 'The file could not be passed to the server. Try uploading it again.');
    }
    // ⚠ Only the status and the JSON body cross back. No upstream header is forwarded.
    const body = await upstream.json().catch(() => null);
    return new Response(JSON.stringify(body ?? { reason: 'failed', message: 'The file could not be saved.' }), {
      status: upstream.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  return { PUT };
}

/** Headers of the API's download worth passing on to the browser. Nothing else crosses. */
const PASSED_ON = [
  'content-type',
  'content-length',
  'content-disposition',
  'cache-control',
  'x-content-type-options',
] as const;

export function createFileDownloadRouteHandlers(options: FileTransferNextOptions = {}) {
  async function GET(request: Request): Promise<Response> {
    const apiUrl = apiUrlOf(options);
    if (!apiUrl) return NOT_CONFIGURED();
    const ticket = new URL(request.url).searchParams.get('ticket');
    if (!isFileTicketShaped(ticket)) return TICKET_INVALID();

    let answer: Response;
    try {
      answer = await fetch(`${apiUrl}${FILE_API_DOWNLOAD_PATH}`, {
        headers: { [FILE_DOWNLOAD_TICKET_HEADER]: ticket },
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
