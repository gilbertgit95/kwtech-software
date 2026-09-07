'use client';

import { type Client, createClient } from 'graphql-ws';

/**
 * The module's realtime half: one WebSocket, opened with a short-lived ticket.
 *
 * ## Why this is separate from `permissions-client.ts`
 *
 * `graphql-ws` is an OPTIONAL peer. An app that never subscribes — or a NestJS
 * server importing the core — must not be made to install it, and a bare
 * `import` at the top of the HTTP client would do exactly that. Keeping the
 * socket in its own module means the import only happens where someone reached
 * for it (PLAN §9 rule 2).
 *
 * ## Why a ticket, and why the app supplies the URL
 *
 * The session is an httpOnly cookie the page cannot read, and cannot be sent to
 * another origin, so the browser asks the app's own proxy for a sixty-second
 * ticket and puts that in `connectionParams`. Two things therefore have to come
 * from the app rather than from this file:
 *
 *   wsUrl       the API's socket origin. The module cannot know it, and the app
 *               publishes it as NEXT_PUBLIC_WS_URL because a browser genuinely
 *               has to know where to connect — unlike the HTTP path, which is
 *               proxied precisely so the origin stays private.
 *   ticketPath  the mint endpoint, which belongs to `@kwtech/module-auth`.
 *               Hardcoding it would be this module naming the other one's URL —
 *               the same coupling `DEFAULT_GRAPHQL_PATH` avoids, and the
 *               default is a default rather than an assumption.
 */

/** Where the app mounts `@kwtech/module-auth`'s ticket endpoint. Overridable. */
export const DEFAULT_WS_TICKET_PATH = '/api/auth/ws-ticket';

export interface RealtimeOptions {
  /** `wss://api.example.com/api/v1/graphql`. No default — only the app knows it. */
  wsUrl: string;
  ticketPath?: string;
  /**
   * Called when the socket cannot be established or is refused.
   *
   * Realtime is an ENHANCEMENT here: every screen that subscribes also reads
   * over HTTP and works without a socket. So a failure is reported and not
   * thrown — a page that went blank because a WebSocket could not connect would
   * be a worse outcome than one that simply stopped updating by itself.
   */
  onError?: (error: Error) => void;
}

export interface RealtimeConnection {
  /**
   * Subscribes to one document. Returns an unsubscribe function.
   *
   * The payload is handed over as-is; callers are expected to treat an event as
   * "something changed, re-read what you are showing" rather than as data to
   * render. That is what keeps ONE authorization path — the guarded query —
   * rather than a second one on the socket. See the resolver's `planChanged`.
   */
  subscribe<T>(document: string, onNext: (data: T) => void): () => void;
  /** Closes the socket. Safe to call twice. */
  close(): void;
}

/**
 * Mints a ticket and opens the socket, reconnecting with a fresh ticket
 * whenever one is needed.
 *
 * `connectionParams` is a FUNCTION, which is the whole reconnect story:
 * `graphql-ws` calls it on every connect attempt, so a reconnect mints a new
 * ticket rather than replaying the expired one. Passing an object here would
 * work exactly once and then fail forever with a stale credential — and the
 * failure would look like a network problem.
 */
export function createRealtimeConnection(options: RealtimeOptions): RealtimeConnection {
  const ticketPath = options.ticketPath ?? DEFAULT_WS_TICKET_PATH;

  let client: Client | null = createClient({
    url: options.wsUrl,
    /*
     * Lazy: the socket is not opened until something subscribes. A page that
     * mounts the provider but never subscribes should not hold a connection,
     * and on a server render there is no WebSocket to open at all.
     */
    lazy: true,
    connectionParams: async () => {
      const response = await fetch(ticketPath, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The session is an httpOnly cookie on THIS origin. Without this the
        // mint request goes out unauthenticated and 401s.
        credentials: 'same-origin',
        body: '{}',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Could not authorize the realtime connection.');
      const body = (await response.json()) as { ticket?: string };
      if (!body.ticket) throw new Error('The realtime ticket was empty.');
      return { ticket: body.ticket };
    },
    on: {
      error: (error) => options.onError?.(error instanceof Error ? error : new Error(String(error))),
    },
    /**
     * Do not retry a REFUSAL.
     *
     * 4403 is the server declining the connection — a ticket that is missing,
     * forged, or minted from a session that has been signed out. None of those
     * becomes valid by trying again, and a retry loop against an auth failure
     * is how one broken tab keeps a server busy. Every other close, including
     * the 4499 the server sends when the authorization expires, is worth
     * retrying: that one is expected, and the retry mints a fresh ticket.
     */
    shouldRetry: (event) => (event as { code?: number })?.code !== 4403,
  });

  return {
    subscribe<T>(document: string, onNext: (data: T) => void): () => void {
      if (!client) return () => undefined;
      return client.subscribe<T>(
        { query: document },
        {
          next: (result) => {
            if (result.data) onNext(result.data as T);
          },
          error: (error) => options.onError?.(error instanceof Error ? error : new Error(String(error))),
          complete: () => undefined,
        },
      );
    },
    close() {
      client?.dispose();
      client = null;
    },
  };
}

/**
 * The documents this module subscribes to.
 *
 * Kept beside the connection rather than in `operations.graphql`, because that
 * file is for the app's CODEGEN and these are sent as strings by the
 * hand-rolled client — the same arrangement the queries in
 * `permissions-client.ts` already use.
 */
export const PLAN_CHANGED = `subscription PlanChanged { planChanged { planKey } }`;
