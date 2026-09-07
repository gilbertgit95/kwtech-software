import type { Principal } from '@kwtech/module-auth';
import { PRINCIPAL_KEY } from '@kwtech/module-auth/server';
import {
  authenticateConnection,
  closeWhenAuthorizationExpires,
  connectionContext,
  rememberConnection,
  WS_CLOSE,
} from '../src/graphql/ws-context.js';

/**
 * The WebSocket handshake, which is the highest-consequence code in this app
 * after `resolvePrincipal`: it is the only place a credential becomes a
 * long-lived authenticated connection, and everything it gets wrong is wrong
 * for as long as the socket stays open.
 *
 * Three of these assertions exist because the first implementation failed them,
 * and each failure was silent in a different way — see the comments.
 */

const principal = (over: Partial<Principal> = {}): Principal => ({
  userId: 'u1',
  sessionId: 's1',
  scope: 'full',
  expiresAt: Math.floor(Date.now() / 1000) + 900,
  issuedAt: Math.floor(Date.now() / 1000),
  ...over,
});

/** A verifier that accepts exactly one ticket string. */
const tokens = (good: string, result: Principal | null = principal()) => ({
  verifyWsTicket: (ticket: string | undefined | null) => (ticket === good ? result : null),
});

describe('authenticateConnection', () => {
  it('accepts a valid ticket and shapes the result like an authenticated request', () => {
    const connection = authenticateConnection(tokens('good'), { ticket: 'good' });

    // The shape is the whole design: `requestFromContext` and `resolvePrincipal`
    // read exactly this, so neither learns that WebSockets exist.
    expect(connection?.req[PRINCIPAL_KEY]).toMatchObject({ userId: 'u1', scope: 'full' });
  });

  it.each([
    ['no connectionParams at all', undefined],
    ['an empty object', {}],
    ['a null ticket', { ticket: null }],
    ['a non-string ticket', { ticket: { toString: () => 'good' } }],
    ['the wrong ticket', { ticket: 'forged' }],
  ])('refuses %s', (_label, params) => {
    expect(authenticateConnection(tokens('good'), params)).toBeNull();
  });

  /**
   * NULL, not a throw. `graphql-ws` reports an exception from `onConnect` as
   * 4500 "internal server error", which tells the client to RETRY — and a bad
   * ticket cannot become good, so that is a reconnect loop against a permanent
   * failure. Returning null lets the caller return `false`, which the library
   * closes as 4403.
   */
  it('returns null rather than throwing, so the caller can refuse with 4403', () => {
    expect(() => authenticateConnection(tokens('good'), { ticket: 'forged' })).not.toThrow();
    expect(WS_CLOSE.forbidden).toBe(4403);
  });

  /**
   * A ticket verified with a stale expiry must not open a connection that
   * outlives it — the expiry travels with the principal, not with the socket.
   */
  it('carries the access token expiry through, for the close timer', () => {
    const expiresAt = 1_800_000_000;
    const connection = authenticateConnection(tokens('good', principal({ expiresAt })), { ticket: 'good' });
    expect(connection?.expiresAt).toBe(expiresAt);
  });
});

describe('the connection is kept on `extra`, never returned', () => {
  /**
   * ⚠ THE REGRESSION TEST FOR A REAL LEAK.
   *
   * The first implementation returned the connection from `onConnect`. An
   * object returned there is sent to the client as the `connection_ack`
   * payload — verified in graphql-ws' source — so the principal, its userId and
   * its sessionId were being published to the browser. That is precisely the
   * disclosure the httpOnly cookie design exists to prevent, and nothing failed:
   * the socket worked, and the credential went out with the acknowledgement.
   *
   * Keeping the connection on `extra` is what fixes it, and this asserts the
   * round trip so nobody "simplifies" it back.
   */
  it('round-trips through extra and yields a request-shaped context', () => {
    const extra: Record<string, unknown> = { socket: {}, request: {} };
    const connection = authenticateConnection(tokens('good'), { ticket: 'good' });
    if (!connection) throw new Error('expected a connection');

    rememberConnection(extra, connection);
    expect(connectionContext(extra).req?.[PRINCIPAL_KEY]).toMatchObject({ userId: 'u1' });
  });

  it('hides the connection from anything reading string keys', () => {
    // A symbol key, so it cannot collide with the adapter's own `socket` and
    // `request` and cannot be reached by an enumeration or a JSON round trip.
    const extra: Record<string, unknown> = {};
    const connection = authenticateConnection(tokens('good'), { ticket: 'good' });
    rememberConnection(extra, connection as never);

    expect(Object.keys(extra)).toEqual([]);
    expect(JSON.stringify(extra)).toBe('{}');
  });

  /**
   * FAILS CLOSED. An `extra` with nothing remembered should be unreachable —
   * `onConnect` runs first and refuses otherwise — but the answer must be "no
   * principal", which the guard turns into a denial, rather than a throw that
   * would read as a server fault.
   */
  it.each([
    ['an empty extra', {}],
    ['an undefined extra', undefined],
  ])('yields an empty context for %s, so the guard denies', (_label, extra) => {
    expect(connectionContext(extra).req).toBeUndefined();
  });
});

describe('closeWhenAuthorizationExpires', () => {
  /**
   * The property that makes subscriptions safe to add at all: a query
   * re-authorizes on every request, a subscription authorizes once. Without
   * this, a disabled role or a lapsed plan keeps streaming until the socket
   * happens to drop.
   */
  it('closes the socket when the access token would have expired', () => {
    jest.useFakeTimers();
    const close = jest.fn();
    const now = 1_000_000_000_000;

    closeWhenAuthorizationExpires({ close }, now / 1000 + 900, () => now);

    jest.advanceTimersByTime(899_000);
    expect(close).not.toHaveBeenCalled();

    jest.advanceTimersByTime(2_000);
    expect(close).toHaveBeenCalledWith(WS_CLOSE.expired, 'Authorization expired');
    jest.useRealTimers();
  });

  /**
   * A distinct code from a refusal: the credential WAS valid and has run out,
   * so a client should mint a fresh ticket and reconnect rather than give up.
   */
  it('uses a different close code from a refusal', () => {
    expect(WS_CLOSE.expired).not.toBe(WS_CLOSE.forbidden);
  });

  it('closes an already-expired connection rather than leaving it open forever', () => {
    jest.useFakeTimers();
    const close = jest.fn();
    const now = 1_000_000_000_000;

    // Unreachable in practice — verifyWsTicket refuses an expired ticket — but
    // "unreachable" is not a reason to leave a socket open.
    closeWhenAuthorizationExpires({ close }, now / 1000 - 1, () => now);
    jest.advanceTimersByTime(1);

    expect(close).toHaveBeenCalledWith(WS_CLOSE.expired, 'Authorization expired');
    jest.useRealTimers();
  });
});
