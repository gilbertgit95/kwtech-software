'use client';

import { type Client, createClient } from 'graphql-ws';
import { DEFAULT_WS_TICKET_PATH, type RealtimeConnection, type RealtimeOptions } from './realtime.js';

/**
 * The app's realtime half: ONE WebSocket, opened with a short-lived ticket.
 *
 * ## The ONLY file in this package that imports `graphql-ws`
 *
 * Which is what makes that peer genuinely optional. Reached through
 * `@kwtech/module-kit/realtime` — a subpath, like `/react` — so importing
 * either barrel resolves nothing here. The shapes and the ticket path live in
 * `realtime.ts`, where a module can name a connection without installing a
 * WebSocket client.
 *
 * ## Why a ticket, and why the app supplies the URL
 *
 * The session is an httpOnly cookie the page cannot read, and cannot be sent to
 * another origin, so the browser asks the app's own proxy for a sixty-second
 * ticket and puts that in `connectionParams`. Two things therefore come from
 * the app rather than from any package:
 *
 *   wsUrl       the API's socket origin. No package can know it, and the app
 *               publishes it as NEXT_PUBLIC_WS_URL because a browser genuinely
 *               has to know where to connect — unlike the HTTP path, which is
 *               proxied precisely so the origin stays private.
 *   ticketPath  the mint endpoint, which belongs to `@kwtech/module-auth`.
 *               Hardcoding it would be this package naming a module's URL, so
 *               the default is a default rather than an assumption.
 *
 * ⚠ THIS IS CALLED ONCE PER TAB, by the application. A module calling it for
 * itself would open a second socket, with a second ticket and a second
 * reconnect — nothing would fail, and the cost would multiply by the number of
 * modules. `RealtimeProvider` is where the one connection is put so every
 * module can reach it.
 */

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
