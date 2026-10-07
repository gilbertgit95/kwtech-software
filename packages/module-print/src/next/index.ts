/**
 * `@kwtech/module-print/next` — the one Next route handler the printing side
 * needs: the browser's way to hand a job's file to the server.
 *
 * ## Why it exists
 *
 * The browser never talks to the API directly (see the web app's
 * `config/env.ts`): it talks to the app's own route handlers. Everything else
 * this module sends is JSON through the app's GraphQL handler. A file is not
 * JSON, so it has a handler of its own, which passes the request's body on AS
 * A STREAM — the web app holds no more of the file than the server does.
 *
 * ⚠ NO SESSION IS READ OR ATTACHED. What admits the file is the one-time
 * ticket `startPrintJob` returned, which the browser sends in a header; the
 * session already did its work when that ticket was issued. So this handler
 * forwards exactly one header of the caller's choosing, to exactly one path.
 *
 * Plain Web `Request`/`Response`, as `@kwtech/module-auth/next` is, and it
 * imports neither `/server` nor `/react`.
 *
 * Adopting it is one file:
 *
 *   // app/api/print/jobs/[jobId]/content/route.ts
 *   export const { PUT } = createPrintRelayRouteHandlers();
 *
 * ⚠ AND KEEP THE APP'S PROXY (MIDDLEWARE) OFF THAT PATH. Next reads a request's
 * body to run a proxy over it, up to a size limit, and a file past the limit
 * arrives cut short.
 */
import { isJobTicketShaped, PRINT_JOB_TICKET_HEADER, printJobContentPath } from '../domain/jobs.js';

export interface PrintRelayNextOptions {
  /**
   * The API's base URL, `http://localhost:8080/api/v1` locally. Falls back to
   * the `API_URL` variable. ⚠ With neither, the handler answers 503: it never
   * guesses where the server is.
   */
  apiUrl?: string;
}

const NOT_FOUND = { reason: 'job_not_found', message: 'That print job is not here — it may have ended already' };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function createPrintRelayRouteHandlers(options: PrintRelayNextOptions = {}) {
  /** The file of one job, from the browser, passed on as it arrives. */
  async function PUT(request: Request, context: { params: Promise<{ jobId: string }> }): Promise<Response> {
    const apiUrl = (options.apiUrl ?? process.env.API_URL)?.replace(/\/+$/, '');
    if (!apiUrl) return json(503, { reason: 'not_configured', message: 'Printing is not set up on this server' });

    const { jobId } = await context.params;
    const ticket = request.headers.get(PRINT_JOB_TICKET_HEADER);
    // Refused here, unsent: a request with no ticket or no file cannot be a job's, and the API need not be asked.
    if (!isJobTicketShaped(ticket) || !request.body) return json(404, NOT_FOUND);

    let upstream: Response;
    try {
      upstream = await fetch(`${apiUrl}${printJobContentPath(jobId)}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/pdf',
          [PRINT_JOB_TICKET_HEADER]: ticket,
          // The API rate-limits per address, and from its side every request comes from this server.
          'x-forwarded-for': request.headers.get('x-forwarded-for') ?? '',
        },
        body: request.body,
        // Required to send a stream: the body is passed on while it is still arriving.
        duplex: 'half',
        cache: 'no-store',
      } as RequestInit);
    } catch {
      /*
       * The API closes the connection when a transfer fails part-way (the
       * computer dropped, the file was not what was declared). That is not
       * the answer; the job's own status is, and the page reads it next.
       */
      return json(502, { reason: 'interrupted', message: 'The file could not be passed to the server' });
    }
    // ⚠ Only the status and the body cross back. No upstream header is forwarded.
    return json(upstream.status, await upstream.json().catch(() => NOT_FOUND));
  }

  return { PUT };
}
