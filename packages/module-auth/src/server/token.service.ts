import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { ACCESS_TOKEN_TTL, expiryFrom, SESSION_TTL, WS_TICKET_TTL } from '../domain/policy.js';
import type { Principal, TokenScope } from '../types.js';
import { AUTH_OPTIONS, type ResolvedAuthModuleOptions } from './auth.options.js';

/**
 * Issues and verifies the two tokens, and nothing else — no database, no
 * policy.
 *
 * That separation is the point: it is what makes "the REST API, the GraphQL
 * endpoint and the WebSocket handshake authenticate identically" true rather
 * than aspirational, because there is only one implementation for any of them
 * to call. §5 puts the API on a different host from the frontends and §7 rides
 * subscriptions over one socket; a second verifier would be a second place for
 * them to disagree.
 *
 * Stateless verification only. Whether the session is still alive is a database
 * question, and it lives in AuthService.
 */

/** The only accepted algorithm. See the note in verifyAccess(). */
const ALGORITHM = 'HS256' as const;

interface AccessTokenClaims {
  sub: string;
  sid: string;
  scope: TokenScope;
  typ: 'user';
  jti: string;
  iat: number;
  exp: number;
}

/**
 * A WebSocket ticket, as its own token TYPE rather than another `TokenScope`.
 *
 * `typ: 'ws'` is the whole security argument. `verifyAccess` refuses anything
 * whose `typ` is not `'user'` — the first check it makes — so a ticket cannot
 * authenticate a REST call, a GraphQL POST, or anything else that goes through
 * `JwtAuthGuard`, whatever a future `@AllowScopes` says. Adding a fourth
 * `TokenScope` would have made that a matter of every guard remembering to
 * exclude it, and `resolvePrincipal` — the one seam between auth and
 * permissions — would have had to learn a new word.
 *
 * It is exchanged, never forwarded: the handshake verifies the ticket and the
 * connection then carries an ordinary `full` principal. Nothing downstream of
 * `onConnect` knows a ticket existed.
 */
interface WsTicketClaims {
  sub: string;
  sid: string;
  typ: 'ws';
  /**
   * When the ACCESS TOKEN this ticket was minted from expires — not when the
   * ticket does.
   *
   * Carried because the connection must not outlive the authorization that
   * opened it (see `Principal.expiresAt`: "The WebSocket layer closes on it").
   * The ticket's own `exp` is sixty seconds and governs only how long the
   * browser has to connect; this is what the socket closes on, which is why the
   * two cannot be one field.
   */
  axp: number;
  jti: string;
  iat: number;
  exp: number;
}

export interface IssuedAccessToken {
  accessToken: string;
  /** ISO-8601, for the frontend's refresh scheduling. */
  expiresAt: string;
}

export interface IssuedWsTicket {
  ticket: string;
  /** ISO-8601. When the TICKET dies — a minute out. Not the connection's life. */
  expiresAt: string;
  /**
   * ISO-8601. When the resulting CONNECTION will be closed, inherited from the
   * access token. The client uses it to schedule a reconnect before the drop
   * rather than discovering it as an error.
   */
  connectionExpiresAt: string;
}

export interface IssuedOpaqueToken {
  /** Handed to the caller once. Never stored anywhere in this shape. */
  token: string;
  /** What goes in the row. */
  tokenHash: string;
  expiresAt: Date;
}

@Injectable()
export class TokenService {
  constructor(@Inject(AUTH_OPTIONS) private readonly options: ResolvedAuthModuleOptions) {}

  issueAccess(input: { userId: string; sessionId: string; scope: TokenScope }): IssuedAccessToken {
    const issuedAt = Math.floor(this.now().getTime() / 1000);
    const expiresAt = issuedAt + (this.options.accessTokenTtl ?? ACCESS_TOKEN_TTL);

    const claims: AccessTokenClaims = {
      sub: input.userId,
      sid: input.sessionId,
      scope: input.scope,
      typ: 'user',
      jti: randomUUID(),
      iat: issuedAt,
      exp: expiresAt,
    };

    const accessToken = jwt.sign(claims, this.options.jwtSecret, {
      algorithm: ALGORITHM,
      issuer: this.options.issuer,
      audience: this.options.audience,
    });

    return { accessToken, expiresAt: new Date(expiresAt * 1000).toISOString() };
  }

  /**
   * Mints a short-lived ticket the browser may put in `connectionParams`.
   *
   * Takes the PRINCIPAL of a live, full-scope session rather than a userId: a
   * ticket is a projection of a session that already exists, not a way to make
   * one. The endpoint that calls this is behind `JwtAuthGuard`, so the caller
   * has already proved it holds the session — this only re-shapes that proof
   * into something client JavaScript is allowed to hold for a minute.
   *
   * Refuses a principal that is not `full`. A `pwd_change` or `mfa` token is a
   * step-up credential for exactly one endpoint, and letting one buy a socket
   * would make the restricted scope decorative — the same argument
   * `resolvePrincipal` makes, and the reason it is made here too rather than
   * left to the caller.
   */
  issueWsTicket(principal: Principal): IssuedWsTicket {
    if (principal.scope !== 'full') {
      throw new Error(`A ${principal.scope} token cannot open a WebSocket`);
    }

    const issuedAt = Math.floor(this.now().getTime() / 1000);
    const expiresAt = issuedAt + WS_TICKET_TTL;

    const claims: WsTicketClaims = {
      sub: principal.userId,
      sid: principal.sessionId,
      typ: 'ws',
      // The connection dies when the ACCESS TOKEN would have, not a minute from
      // now and not a week from now.
      axp: principal.expiresAt,
      jti: randomUUID(),
      iat: issuedAt,
      exp: expiresAt,
    };

    const ticket = jwt.sign(claims, this.options.jwtSecret, {
      algorithm: ALGORITHM,
      issuer: this.options.issuer,
      audience: this.options.audience,
    });

    return {
      ticket,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      connectionExpiresAt: new Date(principal.expiresAt * 1000).toISOString(),
    };
  }

  /**
   * Verifies a ticket presented at the WebSocket handshake and EXCHANGES it for
   * an ordinary principal.
   *
   * The returned principal is `full` scope, because that is what the session it
   * was minted from held — the `ws` type never travels past this method, so
   * `FeatureGuard` and `resolvePrincipal` see exactly what they see on an HTTP
   * request and no code downstream is aware WebSockets exist.
   *
   * `expiresAt` is the ACCESS TOKEN's expiry, so the caller can close the
   * socket on it. A connection that outlived the credential that opened it
   * would be the one place in the system where authorization is never
   * re-evaluated.
   *
   * Null on any problem, never a distinguishable error — the same rule
   * `verifyAccess` follows, and for the same reason.
   */
  verifyWsTicket(ticket: string | undefined | null): Principal | null {
    if (!ticket) return null;

    let decoded: unknown;
    try {
      decoded = jwt.verify(ticket, this.options.jwtSecret, {
        // Pinned, like verifyAccess: without it the library reads the algorithm
        // from the token's own header, which is the classic forgery.
        algorithms: [ALGORITHM],
        issuer: this.options.issuer,
        audience: this.options.audience,
      });
    } catch {
      return null;
    }

    if (typeof decoded !== 'object' || decoded === null) return null;
    const claims = decoded as Partial<WsTicketClaims>;

    /*
     * `typ` FIRST, and it is the check that matters most here: it is what stops
     * an ACCESS token being replayed as a ticket. Without it, anything holding
     * a bearer token could open a socket directly — which is not a
     * vulnerability by itself, but it would quietly remove the sixty-second
     * exposure window this whole mechanism exists to create.
     */
    if (claims.typ !== 'ws') return null;
    if (typeof claims.sub !== 'string' || claims.sub.length === 0) return null;
    if (typeof claims.sid !== 'string' || claims.sid.length === 0) return null;
    if (typeof claims.axp !== 'number') return null;
    if (typeof claims.iat !== 'number') return null;

    return {
      userId: claims.sub,
      sessionId: claims.sid,
      // Exchanged, not forwarded. See the note on WsTicketClaims.
      scope: 'full',
      // The access token's expiry, NOT the ticket's — the socket closes on it.
      expiresAt: claims.axp,
      issuedAt: claims.iat,
    };
  }

  /**
   * Signature and claims only.
   *
   * Returns null on ANY problem rather than throwing a distinguishable error. A
   * caller able to tell "expired" from "bad signature" from "wrong audience"
   * would leak that difference to whoever sent the token, and the difference is
   * exactly what an attacker probing a forged token wants to know.
   *
   * `algorithms` is pinned explicitly. Without it the library takes the
   * algorithm from the token's own header, which is the classic JWT forgery: an
   * attacker re-signs with `alg: none`, or downgrades an RS256 verifier into
   * treating the public key as an HMAC secret.
   */
  verifyAccess(token: string | undefined | null): Principal | null {
    if (!token) return null;

    let decoded: unknown;
    try {
      decoded = jwt.verify(token, this.options.jwtSecret, {
        algorithms: [ALGORITHM],
        issuer: this.options.issuer,
        audience: this.options.audience,
      });
    } catch {
      return null;
    }

    if (typeof decoded !== 'object' || decoded === null) return null;
    const claims = decoded as Partial<AccessTokenClaims>;

    if (claims.typ !== 'user') return null;
    if (typeof claims.sub !== 'string' || claims.sub.length === 0) return null;
    if (typeof claims.sid !== 'string' || claims.sid.length === 0) return null;
    if (typeof claims.exp !== 'number') return null;
    if (typeof claims.iat !== 'number') return null;
    // Every KNOWN scope is accepted here; deciding which ones may reach a given
    // endpoint is JwtAuthGuard's job (@AllowScopes) and resolvePrincipal's.
    // Verification says "this token is genuine", not "this token is enough".
    if (claims.scope !== 'full' && claims.scope !== 'pwd_change' && claims.scope !== 'mfa') return null;

    return {
      userId: claims.sub,
      sessionId: claims.sid,
      scope: claims.scope,
      expiresAt: claims.exp,
      issuedAt: claims.iat,
    };
  }

  /**
   * Opaque and random — not a JWT.
   *
   * A refresh token carries no claims because nothing should be able to read
   * anything out of it. Its only job is to name a row, and the row is the truth;
   * a self-describing token would be a second, unrevokable source of it.
   */
  issueRefresh(): IssuedOpaqueToken {
    return this.issueOpaque(this.options.sessionTtl ?? SESSION_TTL);
  }

  /** Same shape, different lifetime. A reset link waits in an inbox, so it is short. */
  issueOpaque(ttlSeconds: number): IssuedOpaqueToken {
    const token = randomBytes(32).toString('base64url');
    return { token, tokenHash: this.hashOpaque(token), expiresAt: expiryFrom(this.now(), ttlSeconds) };
  }

  /**
   * SHA-256, not scrypt.
   *
   * A password needs a slow hash because it is low-entropy and guessable; this
   * is 256 bits of CSPRNG output, where brute force is not a threat and a slow
   * hash would only add latency to every refresh. The property that matters is
   * the same either way: the stored row cannot be replayed.
   */
  hashOpaque(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Overridable in tests; token expiry should not be the reason a clock is untestable. */
  protected now(): Date {
    return new Date();
  }

  /** Bearer, case-insensitively, from an HTTP header or a connection-init param. */
  static bearer(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const match = /^bearer\s+(.+)$/i.exec(value.trim());
    return match?.[1] ?? null;
  }
}
