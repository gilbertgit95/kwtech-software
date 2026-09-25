'use client';

import { type Client, createClient } from 'graphql-ws';
import {
  closeEvent,
  DEFAULT_WS_TICKET_PATH,
  nextRealtimeStatus,
  REALTIME_PONG_TIMEOUT_MS,
  REALTIME_REFUSED_CODE,
  type RealtimeConnection,
  type RealtimeOptions,
  type RealtimeStatusEvent,
  type RealtimeStatusSnapshot,
  reconnectDelay,
} from './realtime.js';

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
 *
 * ⚠ The ONE documented exception (PLAN §12.39): a public queue display, which
 * has no session to mint a ticket from and opens its own socket with
 * `connectionParams` carrying its display pass.
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

  const mintTicket = async () => {
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
  };

  /*
   * ── status ──────────────────────────────────────────────────────────────
   *
   * Kept here, fed by the client's own lifecycle callbacks, so every module
   * reads ONE answer to "is this tab live" rather than each inferring it from
   * whether its own events happen to be arriving — which on a quiet stream is
   * indistinguishable from a dead one.
   */
  let snapshot: RealtimeStatusSnapshot = { status: 'idle', since: Date.now() };
  const listeners = new Set<(next: RealtimeStatusSnapshot) => void>();
  const move = (event: RealtimeStatusEvent) => {
    const status = nextRealtimeStatus(snapshot.status, event);
    if (status === snapshot.status) return;
    snapshot = { status, since: Date.now() };
    for (const listener of listeners) listener(snapshot);
  };

  /*
   * ── an interruptible backoff ────────────────────────────────────────────
   *
   * `retryWait` resolves on its timer OR when `reconnectNow` wakes it. Without
   * the second, a socket that has backed off to fifteen seconds sits out the
   * rest of that wait after the network is already back — and fifteen seconds
   * is long enough for a person to decide the app has stopped working.
   */
  const waking = new Set<() => void>();
  const wait = (retries: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        waking.delete(done);
        resolve();
      };
      const timer = setTimeout(done, reconnectDelay(retries));
      waking.add(done);
    });
  const reconnectNow = () => {
    if (snapshot.status !== 'reconnecting') return;
    for (const wake of [...waking]) wake();
  };

  /*
   * The two moments a retry is most likely to succeed. Only for a connection
   * that retries at all: one that gives up after five attempts has nothing
   * waiting to wake.
   */
  const onOnline = () => reconnectNow();
  const onVisible = () => {
    if (document.visibilityState === 'visible') reconnectNow();
  };
  const watchBrowser = Boolean(options.retryForever) && typeof window !== 'undefined';
  if (watchBrowser) {
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
  }

  /*
   * ── a socket that stopped answering ─────────────────────────────────────
   *
   * `keepAlive` SENDS a ping every twenty seconds; on its own it never notices
   * that no pong came back. A half-open socket — a laptop that slept, a network
   * that changed under it — then reports `live` while delivering nothing, which
   * is the one state a notification bell must never show. So a ping with no
   * pong inside `REALTIME_PONG_TIMEOUT_MS` terminates the socket, and the retry
   * above takes over.
   */
  let pongTimer: ReturnType<typeof setTimeout> | undefined;

  let client: Client | null = createClient({
    url: options.wsUrl,
    /*
     * Lazy: the socket is not opened until something subscribes. A page that
     * mounts the provider but never subscribes should not hold a connection,
     * and on a server render there is no WebSocket to open at all.
     */
    lazy: true,
    /*
     * ⚠ PING ON A TIMER WHILE IDLE, which is what makes a server-side presence
     * TTL possible at all.
     *
     * An ungraceful disconnect — a closed laptop lid, a dropped network —
     * delivers no close event, so a server that trusted a goodbye would show
     * that person as present until their token expired. A client that keeps
     * saying it is there lets the server expire one that stops.
     *
     * It is also what keeps a socket alive through a proxy that drops idle
     * connections, which is the more common reason to set it.
     */
    keepAlive: 20_000,
    // Called on EVERY attempt — see above. A display's pass, or a fresh ticket.
    connectionParams: options.connectionParams ?? mintTicket,
    on: {
      error: (error) => options.onError?.(error instanceof Error ? error : new Error(String(error))),
      connecting: () => move('connecting'),
      ping: (received) => {
        if (received) return;
        clearTimeout(pongTimer);
        pongTimer = setTimeout(() => client?.terminate(), REALTIME_PONG_TIMEOUT_MS);
      },
      pong: (received) => {
        if (received) clearTimeout(pongTimer);
      },
      connected: () => {
        move('connected');
        options.onConnected?.();
      },
      closed: (event) => {
        const code = (event as { code?: number } | undefined)?.code;
        move(closeEvent(code));
        options.onClosed?.(code);
      },
    },
    ...(options.retryForever ? { retryAttempts: Number.POSITIVE_INFINITY, retryWait: wait } : {}),
    /**
     * Do not retry a REFUSAL.
     *
     * 4403 is the server declining the connection — a ticket that is missing,
     * forged, or minted from a session that has been signed out, or a display
     * pass whose queuing session has stopped. None of those becomes valid by
     * trying again, and a retry loop against an auth failure is how one broken
     * tab keeps a server busy. Every other close, including the 4499 the server
     * sends when the authorization expires, is worth retrying.
     */
    shouldRetry: (event) => (event as { code?: number })?.code !== REALTIME_REFUSED_CODE,
  });

  return {
    subscribe<T>(document: string, onNext: (data: T) => void, variables?: Record<string, unknown>): () => void {
      if (!client) return () => undefined;
      return client.subscribe<T>(
        // `variables` omitted entirely when there are none, rather than sent as
        // `{}`: a server that validates the payload shape should see the same
        // request a client with no arguments has always sent.
        variables ? { query: document, variables } : { query: document },
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
      if (watchBrowser) {
        window.removeEventListener('online', onOnline);
        document.removeEventListener('visibilitychange', onVisible);
      }
      clearTimeout(pongTimer);
      for (const wake of [...waking]) wake();
      listeners.clear();
      client?.dispose();
      client = null;
    },
    status() {
      return snapshot;
    },
    onStatus(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reconnectNow,
  };
}
