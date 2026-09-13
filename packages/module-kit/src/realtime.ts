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
  /** `wss://api.example.com/api/v1/graphql`. No default — only the app knows it. */
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
}
