import type { Principal } from '@kwtech/module-auth';
import type { TokenService } from '@kwtech/module-auth/server';
import { PRINCIPAL_KEY } from '@kwtech/module-auth/server';

/**
 * Authentication for the WebSocket handshake.
 *
 * ## Why this exists at all
 *
 * `JwtAuthGuard` is an HTTP guard: it reads an `Authorization` header off a
 * request and leaves a `Principal` on it. A WebSocket has neither — there is one
 * upgrade request, then frames — so nothing downstream would find a principal
 * and `FeatureGuard` would deny every subscription. Correct, and useless.
 *
 * So the connection is authenticated ONCE, here, and the result is shaped to
 * look exactly like an authenticated HTTP request: an object carrying the
 * principal under `PRINCIPAL_KEY`, placed on the GraphQL context as `req`.
 *
 * That shape is deliberate and it is the whole design. `requestFromContext`
 * already returns `GqlExecutionContext.create(ctx).getContext().req` for a
 * GraphQL call, and `resolvePrincipal` reads `PRINCIPAL_KEY` off whatever it is
 * given. Neither learns that WebSockets exist, and neither should: authorization
 * is one implementation, and a second path to a principal would be a second
 * place for the two to disagree — with the one that drifts always being the one
 * without a guard behind it.
 *
 * ## The credential is a ticket, not the session
 *
 * The browser cannot read its own httpOnly cookie and cannot send it to another
 * origin, so it asks the same-origin proxy for a sixty-second ticket and puts
 * that in `connectionParams`. `verifyWsTicket` exchanges it for an ordinary
 * `full` principal; the `ws` token type never travels further than this file.
 * See `TokenService.issueWsTicket` for what a stolen ticket is worth.
 */

/** What the client sends in `connection_init`. Anything else is refused. */
interface ConnectionParams {
  ticket?: unknown;
}

/**
 * The request-shaped object a subscription resolves its principal from.
 *
 * Not a real request, and it does not pretend to be one beyond the single
 * property anything reads. Giving it headers or a url would invite code to
 * start using them, and none of it would be true.
 */
export interface WsRequestLike {
  [PRINCIPAL_KEY]: Principal;
}

export interface WsConnectionContext {
  req: WsRequestLike;
  /**
   * Epoch seconds, inherited from the access token the ticket was minted from.
   * The socket is closed on it — see `closeWhenAuthorizationExpires`.
   */
  expiresAt: number;
}

/**
 * Where the authenticated connection is kept between the handshake and each
 * operation on it.
 *
 * ⚠ NOT the return value of `onConnect`. That was the first attempt and it is
 * actively wrong twice over — verified by reading `graphql-ws`' server source
 * after the guard refused every subscription:
 *
 *   1. It is not the context. Nest passes the driver's top-level `context`
 *      function to `useServer`, so a subscription would resolve against an
 *      HTTP-shaped context with no `req` — "Not signed in", on every operation.
 *   2. An object returned from `onConnect` is SENT TO THE CLIENT as the
 *      `connection_ack` payload. Returning the connection would have published
 *      the principal — userId, sessionId, expiry — to the browser, which is the
 *      exact disclosure the httpOnly cookie design exists to prevent.
 *
 * So `onConnect` returns a boolean and nothing else, and the connection is
 * stashed on `ctx.extra` — the per-socket bag `graphql-ws` hands to every
 * callback for precisely this. A SYMBOL key, so it cannot collide with the
 * adapter's own `socket`/`request` fields and cannot be reached by anything
 * walking the object's string keys.
 */
const CONNECTION = Symbol.for('kwtech:ws-connection');

/** Called once, in `onConnect`, after the ticket verifies. */
export function rememberConnection(extra: unknown, connection: WsConnectionContext): void {
  (extra as Record<symbol, unknown>)[CONNECTION] = connection;
}

/**
 * The GraphQL context for one operation on an authenticated socket.
 *
 * Shaped as `{ req }` so `requestFromContext` and `resolvePrincipal` work
 * unchanged — neither learns that WebSockets exist, which is the whole design.
 *
 * FAILS CLOSED. An `extra` with no remembered connection should be unreachable
 * (`onConnect` runs first and refuses otherwise), but returning an empty
 * context there means the guard finds no principal and denies, rather than
 * throwing inside the subscribe path where the failure would read as a server
 * fault rather than a refusal.
 */
export function connectionContext(extra: unknown): { req?: WsRequestLike } {
  const connection = (extra as Record<symbol, unknown> | undefined)?.[CONNECTION] as WsConnectionContext | undefined;
  return connection ? { req: connection.req } : {};
}

/**
 * `graphql-ws`' close codes, as the library actually uses them.
 *
 * Measured, not assumed — an earlier version of this file claimed a thrown
 * error closed with 4401 and the observed code was 4500, because `graphql-ws`
 * reports ANY exception from `onConnect` as an internal server error. Which is
 * the right default for an exception and the wrong story for a refusal: 4500
 * tells a client to retry, and a bad ticket will still be bad on the third
 * attempt.
 *
 * So a refusal RETURNS FALSE rather than throwing, which the library closes as
 * 4403 — its documented mechanism for "the server declined this connection".
 */
export const WS_CLOSE = {
  /** Returned-false from `onConnect`. Fatal: the client must not retry. */
  forbidden: 4403,
  /**
   * The authorization that opened the socket has run out.
   *
   * A BACKSTOP, not the normal path: the client knows `connectionExpiresAt`
   * from the ticket it was issued and reconnects before this fires. It exists
   * for the client that does not — a stale tab, another implementation — so no
   * socket can outlive its authorization whatever the client does.
   */
  expired: 4499,
} as const;

/**
 * Verifies the ticket in `connectionParams` and builds the connection context.
 *
 * Returns null for a refusal rather than throwing, so the caller can return
 * `false` and get a 4403 — see WS_CLOSE. Throwing would surface every bad
 * ticket as a 4500 and invite retry loops against a credential that cannot
 * become valid.
 *
 * ONE outcome for every failure — missing, malformed, expired, forged, or an
 * access token replayed as a ticket. The same rule the credential endpoints
 * follow: the difference between "expired" and "bad signature" is exactly what
 * someone probing a forged ticket wants to know.
 */
export function authenticateConnection(
  tokens: Pick<TokenService, 'verifyWsTicket'>,
  connectionParams: unknown,
): WsConnectionContext | null {
  const params = (connectionParams ?? {}) as ConnectionParams;
  const ticket = typeof params.ticket === 'string' ? params.ticket : undefined;

  const principal = tokens.verifyWsTicket(ticket);
  if (!principal) return null;

  return { req: { [PRINCIPAL_KEY]: principal }, expiresAt: principal.expiresAt };
}

/**
 * Closes the socket when the authorization that opened it expires.
 *
 * This is the property that makes subscriptions safe to add at all. A query is
 * authorized on every request; a subscription is authorized ONCE, at subscribe
 * time, and then streams. Without this, disabling a role — or a customer's plan
 * lapsing — would leave events flowing until the socket happened to drop, which
 * could be hours. `Principal.expiresAt` has said "The WebSocket layer closes on
 * it" since the type was written; this is that.
 *
 * The client reconnects with a fresh ticket, and entitlement is recomputed from
 * scratch on the new connection. So the staleness window is bounded by
 * `AUTH_ACCESS_TOKEN_TTL` — the same bound an HTTP caller already lives with.
 *
 * A DISTINCT code from a refusal (see WS_CLOSE): the credential was valid and
 * has simply run out, so the client should mint a fresh ticket and reconnect
 * rather than treat it as a permanent no.
 */
export function closeWhenAuthorizationExpires(
  socket: { close(code: number, reason: string): void },
  expiresAt: number,
  now: () => number = Date.now,
): NodeJS.Timeout | undefined {
  const ms = expiresAt * 1000 - now();
  /*
   * Already expired: close on the next tick rather than synchronously, because
   * `onConnect` has not returned yet and closing mid-handshake leaves the
   * client without the ack it is waiting for.
   *
   * It should be unreachable — `verifyWsTicket` refuses an expired ticket, and
   * a ticket lives sixty seconds while an access token lives fifteen minutes —
   * but "unreachable" is not a reason to leave a socket open forever.
   */
  if (ms <= 0) {
    return setTimeout(() => socket.close(WS_CLOSE.expired, 'Authorization expired'), 0);
  }

  const timer = setTimeout(() => socket.close(WS_CLOSE.expired, 'Authorization expired'), ms);
  // Do not hold the process open for a socket that may outlive the work.
  timer.unref?.();
  return timer;
}
