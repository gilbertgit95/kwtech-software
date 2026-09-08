'use client';

/**
 * The realtime CONTRACT: the option shape, the connection shape, the ticket
 * path and the documents. No socket, and no `graphql-ws` import.
 *
 * ## Why it is split from the client
 *
 * `graphql-ws` is an OPTIONAL peer, and it stopped being optional the moment
 * anything reachable from the `/react` barrel imported it unconditionally.
 * `plans-page.tsx` did: it imports `PLAN_CHANGED` — a string — and that one
 * value dragged a WebSocket client into every consumer of the barrel, whether
 * or not they ever open a socket. An app that never subscribes was resolving
 * `graphql-ws` at build time, and only succeeded because this package happens
 * to carry it as a devDependency inside a pnpm workspace.
 *
 * So the parts that cost nothing live here, and the one function that needs the
 * library lives behind `@kwtech/module-permissions/react/realtime`. A page can
 * name a subscription document and TYPE a connection it was handed without
 * installing anything.
 *
 * ## Why a ticket, and why the app supplies the URL
 *
 * The session is an httpOnly cookie the page cannot read, and cannot be sent to
 * another origin, so the browser asks the app's own proxy for a sixty-second
 * ticket and puts that in `connectionParams`. Two things therefore have to come
 * from the app rather than from this package:
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
 * The documents this module subscribes to.
 *
 * Here rather than beside the connection, and that is the point of the split: a
 * document is a STRING. A page naming one — `plans-page.tsx` does — must not
 * have to resolve a WebSocket client to say which events it cares about.
 *
 * Not in `operations.graphql` either, because that file is for the app's
 * CODEGEN and these are sent as strings by the hand-rolled client — the same
 * arrangement the queries in `permissions-client.ts` already use.
 */
export const PLAN_CHANGED = `subscription PlanChanged { planChanged { planKey } }`;
