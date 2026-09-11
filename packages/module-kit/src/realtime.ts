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
   */
  subscribe<T>(document: string, onNext: (data: T) => void): () => void;
  /** Closes the socket. Safe to call twice. The APP calls this, not a module. */
  close(): void;
}
