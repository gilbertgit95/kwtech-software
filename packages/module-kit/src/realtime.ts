/**
 * The realtime CONTRACT: what a connection is, and what opening one needs.
 *
 * ## Why it lives in module-kit rather than in the module that wrote it first
 *
 * Because a socket is a resource of the APPLICATION, not of a feature. This
 * shape started in `module-permissions`, where it was correct while exactly one
 * module subscribed to anything. The second one — `module-chat` — made the
 * arrangement wrong in a way that would not have shown up as an error: each
 * module would reach for its own `createRealtimeConnection`, and a tab would
 * hold a socket per module, each with its own ticket, its own reconnect and its
 * own share of the server's connection budget. Nothing fails; it simply costs
 * N times what it should and gets worse with every module.
 *
 * So the contract is HERE, where every module may name it without importing
 * another module (PLAN §9), and the app opens exactly one connection and hands
 * it down. The same argument as `realtimePubSub()` on the server: which engine,
 * and how many of it, is the host's decision.
 *
 * ## What is deliberately NOT here
 *
 * `createRealtimeConnection`, which needs `graphql-ws`. It sits behind
 * `@kwtech/module-kit/realtime` so that naming a connection costs nothing: a
 * page that TYPES one, or a module that declares a prop for one, must not drag
 * a WebSocket client into every consumer of the barrel. That mistake has been
 * made once in this repo already — a page imported a subscription document,
 * which is a string, and pulled in the whole client with it.
 */

/** Where an app mounts `@kwtech/module-auth`'s ticket endpoint. Overridable. */
export const DEFAULT_WS_TICKET_PATH = '/api/auth/ws-ticket';

/**
 * Where a socket admitted WITHOUT a session carries what admitted it.
 *
 * A socket normally carries a principal: somebody signed in, and the handshake
 * verified a ticket minted from their session. A public board on a TV in a
 * waiting room has no session to mint one from, so an app may also admit a
 * socket through a hook a MODULE implements — `module-queuing-window`'s display
 * pass will be the first. What that hook returns is kept on the socket's
 * request-shaped context under this key, and the module's public resolver reads
 * it back to learn which display it is serving.
 *
 * Here rather than beside the handshake because the module that implements the
 * hook may not import the app, nor `module-auth` (PLAN §9) — the same reason
 * `PUBLIC_SURFACE_METADATA` is here.
 *
 * ⚠ AN ADMISSION IS NOT AN IDENTITY. An anonymous socket carries no principal,
 * and that absence is what keeps it safe: `JwtAuthGuard` refuses every
 * operation on it that is not marked public. A guard that accepted an admission
 * in place of a principal would open every surface to a television.
 *
 * ⚠ Nothing outside the process can set it, for the reason nothing can set the
 * principal: the handshake assigns it on an object the handshake built. It is
 * never a header, a parameter or a field a client sends.
 */
export const ANONYMOUS_ADMISSION_KEY = 'kwtechAnonymousAdmission';

/**
 * The admission a socket was opened with, or undefined for anything else — an
 * HTTP request, or a socket somebody signed in to.
 *
 * The caller names the shape, because only the module that admitted the socket
 * knows it. ⚠ Reading it is not checking it: what admitted a socket at the
 * handshake can be withdrawn later, so a module re-checks it on every publish.
 */
export function anonymousAdmission<T extends object>(request: unknown): T | undefined {
  if (typeof request !== 'object' || request === null) return undefined;
  const value = (request as Record<string, unknown>)[ANONYMOUS_ADMISSION_KEY];
  return typeof value === 'object' && value !== null ? (value as T) : undefined;
}

export interface RealtimeOptions {
  /**
   * Where the socket is. No default — only the app knows it. Either a full
   * address (`wss://api.example.com/api/v1/graphql`), or a PATH
   * (`/api/v1/graphql`) resolved against the page's own address when the
   * connection is opened — see `resolveSocketUrl` for why a path is usually right.
   */
  wsUrl: string;
  ticketPath?: string;
  /**
   * Called when the socket cannot be established or is refused.
   *
   * Realtime is an ENHANCEMENT: every screen that subscribes also reads over
   * HTTP and works without a socket. So a failure is reported and not thrown — a
   * page that went blank because a WebSocket could not connect would be a worse
   * outcome than one that stopped updating by itself.
   */
  onError?: (error: Error) => void;
  /**
   * What to send in `connection_init`, INSTEAD of minting a ticket from the
   * session. Called on every connect attempt.
   *
   * For a socket admitted by something other than a session — a queue display
   * presenting its pass. ⚠ Still one constructor: a module that needs its own
   * socket for a screen with no session gets it through this option, never a
   * second copy of this file.
   */
  connectionParams?: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  /** The socket is up and acknowledged. */
  onConnected?: () => void;
  /**
   * The socket closed, with the close code when there was one. `4403` is the
   * server REFUSING the connection — for a display pass, "that session has
   * stopped" — and is never retried.
   */
  onClosed?: (code: number | undefined) => void;
  /**
   * Never stop reconnecting (a refusal aside), with a delay capped by
   * `reconnectDelay`. For a screen nobody is watching to press reload: the
   * library's default gives up after five attempts, and a TV that gave up at 3am
   * shows yesterday's number all morning.
   */
  retryForever?: boolean;
}

/** The longest a `retryForever` connection waits between attempts. */
export const MAX_RECONNECT_DELAY_MS = 15_000;

/**
 * How long to wait before reconnect attempt `retries` (0-based): exponential
 * from one second, capped at `MAX_RECONNECT_DELAY_MS`, plus up to a second of
 * jitter so a room of TVs that lost the network together does not reconnect in
 * one stampede.
 */
export function reconnectDelay(retries: number, random: () => number = Math.random): number {
  const base = Math.min(1000 * 2 ** Math.max(0, retries), MAX_RECONNECT_DELAY_MS);
  return base + Math.floor(random() * 1000);
}

export interface RealtimeConnection {
  /**
   * Subscribes to one document. Returns an unsubscribe function.
   *
   * ⚠ SHARED. Several modules subscribe to this same connection, each with its
   * own document, and `graphql-ws` multiplexes them over the one socket. So an
   * implementation must not close on the last unsubscribe: the conversation
   * list unmounting is not a reason to drop the plan badge's stream.
   *
   * `variables` because a subscription is a GraphQL operation like any other
   * and can take arguments — chat's carries the cursor it wants replayed from.
   * A connection that could not pass one would push every caller into
   * interpolating values into a document string, which is the wrong answer to
   * a question the protocol already has a right one for.
   */
  subscribe<T>(document: string, onNext: (data: T) => void, variables?: Record<string, unknown>): () => void;
  /** Closes the socket. Safe to call twice. The APP calls this, not a module. */
  close(): void;
  /**
   * Where the socket stands right now. See `RealtimeStatus`.
   *
   * OPTIONAL, like the two below, so a hand-written connection (a test's fake,
   * an app's own transport) still satisfies the interface. A consumer that
   * finds none of them treats the connection as live, which is what every
   * screen assumed before these existed.
   */
  status?(): RealtimeStatusSnapshot;
  /** Called on every status change. Returns the unsubscribe. */
  onStatus?(listener: (snapshot: RealtimeStatusSnapshot) => void): () => void;
  /**
   * Stop waiting out the backoff and try NOW. A no-op while live or idle.
   *
   * For a person pressing "Retry now", and for the moments a reconnect is
   * likely to work — the network came back, a laptop woke up. Without it a
   * socket that has backed off to fifteen seconds sits out the rest of that
   * wait while the network is already fine.
   */
  reconnectNow?(): void;
}

/**
 * The socket's state, as a screen needs it.
 *
 *   idle          nothing is subscribed, so no socket is open. Lazy by design —
 *                 NOT a failure, and never shown as one.
 *   connecting    the first attempt of this connection is in flight.
 *   live          acknowledged; events are arriving.
 *   reconnecting  it was live, or tried to be, and is retrying.
 *   refused       the server declined it (4403: signed out, a pass withdrawn).
 *                 Never retried — see `shouldRetry` — so this one is final.
 *
 * ⚠ There is no "down". Down is `reconnecting` that has lasted too long, and
 * how long is too long is a SCREEN's decision (a bell waits thirty seconds, a
 * TV may wait less), so the connection reports the state and when it began, and
 * each screen draws its own line.
 */
export type RealtimeStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'refused';

export interface RealtimeStatusSnapshot {
  status: RealtimeStatus;
  /** Epoch milliseconds when this status began. A screen measures "how long" from it. */
  since: number;
}

/** What the socket client reports, narrowed to what moves the status. */
export type RealtimeStatusEvent = 'connecting' | 'connected' | 'closed' | 'closed_normally' | 'refused';

/**
 * The status after `event`. Pure, so the transitions are tested without a
 * WebSocket.
 *
 * ⚠ A `connecting` after the socket was ever live is `reconnecting`, not
 * `connecting`: to a screen, "trying for the first time" and "lost it and
 * trying again" are different sentences, and only the second is a problem.
 *
 * ⚠ `closed_normally` (code 1000) is the lazy client closing because nothing is
 * subscribed. That is `idle`, and reporting it as a loss would flash a warning
 * on every page that stops listening.
 */
export function nextRealtimeStatus(current: RealtimeStatus, event: RealtimeStatusEvent): RealtimeStatus {
  switch (event) {
    case 'connecting':
      return current === 'idle' ? 'connecting' : 'reconnecting';
    case 'connected':
      return 'live';
    case 'closed':
      return current === 'refused' ? 'refused' : 'reconnecting';
    case 'closed_normally':
      return current === 'refused' ? 'refused' : 'idle';
    case 'refused':
      return 'refused';
  }
}

/**
 * How long a sent ping may go unanswered before the socket is treated as dead.
 *
 * Five seconds on top of the twenty-second keepalive: a dead socket is noticed
 * within about twenty-five seconds, and a slow-but-alive one is not killed by a
 * busy server taking a moment to answer.
 */
export const REALTIME_PONG_TIMEOUT_MS = 5_000;

/** The close code that means "refused, do not retry". Shared with `shouldRetry`. */
export const REALTIME_REFUSED_CODE = 4403;

/**
 * Which status event a close with `code` is.
 *
 * `undefined` is an abnormal close that carried no code — a dropped network —
 * and is retried like any other loss.
 */
export function closeEvent(code: number | undefined): RealtimeStatusEvent {
  if (code === REALTIME_REFUSED_CODE) return 'refused';
  if (code === 1000) return 'closed_normally';
  return 'closed';
}

/** The part of `window.location` a socket address is resolved against. */
export interface SocketPageAddress {
  /** `https:` or `http:`, with the colon, as `location.protocol` gives it. */
  protocol: string;
  /** Host and port, as `location.host` gives it: `192.168.1.68`, `localhost:8081`. */
  host: string;
}

/**
 * The socket address to open, from what the app was configured with and the
 * address the page itself was opened on. Null when no address can be made —
 * a path with no page to resolve it against (a server render), or a value that
 * is neither a path nor a `ws:` / `wss:` address.
 *
 *   `wss://api.example.com/api/v1/graphql`  → itself: a socket on another host
 *   `/api/v1/graphql`, page `https://192.168.1.68`  → `wss://192.168.1.68/api/v1/graphql`
 *   `/api/v1/graphql`, page `https://localhost`     → `wss://localhost/api/v1/graphql`
 *
 * ⚠ A PATH IS WHAT KEEPS ONE BUILD WORKING FROM EVERY ADDRESS (issue #50). The
 * value is baked into the web app's build, and a full address baked in sends
 * EVERY browser to that one host — including a browser that can load the page
 * but cannot reach that host. On a shop's WSL computer that is the computer
 * itself: Windows does not route its own network address back into WSL
 * (docs/HTTPS.md §4), so the cashier's till opened the page on `localhost`,
 * sent its socket to `wss://192.168.1.68`, timed out, and never showed another
 * till's order. Resolved against the page, the socket goes wherever the page
 * came from, which by definition the browser can reach.
 *
 * The scheme follows the page: an `https:` page gets `wss:` (a browser refuses
 * a plain `ws:` from a secure page), anything else `ws:`.
 */
export function resolveSocketUrl(configured: string, page: SocketPageAddress | null): string | null {
  const value = configured.trim();
  if (/^wss?:\/\//i.test(value)) return value;
  // `//host/...` is a protocol-relative ADDRESS, not a path: refused rather than guessed at.
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (!page) return null;
  const scheme = page.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${page.host}${value}`;
}

/**
 * A sentence for whatever a socket failure handed over.
 *
 * `graphql-ws` reports a failed connection with the browser's bare `Event` or
 * `CloseEvent`, and `String()` of those is `[object Event]` — which is all the
 * console said while the cashier's till sat dead for issue #50. A GraphQL
 * refusal of one subscription arrives as an array of errors, which `String()`
 * also flattens to nothing useful.
 */
export function describeRealtimeError(error: unknown, url: string | null): Error {
  if (error instanceof Error) return error;
  if (Array.isArray(error)) {
    const messages = error
      .map((each) => (typeof each === 'object' && each !== null ? (each as { message?: unknown }).message : each))
      .filter((message): message is string => typeof message === 'string' && message !== '');
    if (messages.length > 0) return new Error(`A live subscription was refused: ${messages.join('; ')}`);
  }
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    const where = url ?? 'the server';
    if (typeof code === 'number') return new Error(`The live-updates socket to ${where} closed (code ${code}).`);
    return new Error(
      `Could not reach the live-updates socket at ${where}. Screens update only on a reload until it connects.`,
    );
  }
  return new Error(String(error));
}

/**
 * Whether a screen may call itself live (issues #50, #64): the SOCKET'S state,
 * never merely that the app has a connection.
 *
 *   no connection at all                      not live (the app wires no socket)
 *   live or idle, or a status not reported    live
 *   refused                                   not live at once: nothing will retry it
 *   connecting / reconnecting < the screen's threshold   live — the routine reconnect
 *   connecting / reconnecting ≥ it                       not live
 *
 * ⚠ `realtime !== null` IS NOT THIS. It is true as soon as the app HAS a
 * connection — before it ever connects, and while it times out forever. That is
 * how the POS cashier's till looked live in issue #50 with nothing reaching it.
 *
 * `notLiveAfterMs` is the SCREEN'S decision (a till, where money changes hands,
 * says so sooner than a notes list), so it is a parameter; the rule is one copy.
 * A status of `null` is a connection that does not report one (a test's fake),
 * which counts as live — what every screen assumed before statuses existed.
 */
export function isRealtimeLive(
  hasConnection: boolean,
  status: RealtimeStatus | null,
  since: number,
  now: number,
  notLiveAfterMs: number,
): boolean {
  if (!hasConnection) return false;
  if (status === null) return true;
  switch (status) {
    case 'idle':
    case 'live':
      return true;
    case 'refused':
      return false;
    case 'connecting':
    case 'reconnecting':
      return now - since < notLiveAfterMs;
  }
}

/** When `isRealtimeLive` will next change by itself, in ms from now — so a screen sets one timer, never polls. */
export function realtimeLiveChangeIn(
  status: RealtimeStatus | null,
  since: number,
  now: number,
  notLiveAfterMs: number,
): number | null {
  if (status !== 'connecting' && status !== 'reconnecting') return null;
  const left = notLiveAfterMs - (now - since);
  return left > 0 ? left : null;
}
