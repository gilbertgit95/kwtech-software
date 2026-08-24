import type { Provider } from '@nestjs/common';
import type { AuthFailureReason, SessionUser } from '../types.js';

export const AUTH_OPTIONS = 'kwtech:auth-options';

/**
 * What the app must decide, and nothing the module can decide for it.
 *
 * The rule from PLAN §9 rule 6 — apps configure, modules do not guess — applies
 * hardest here: a module that invented a JWT secret, or silently logged reset
 * links to stdout, would be a security hole shipped as a convenience.
 */
export interface AuthModuleOptions {
  /**
   * REQUIRED, and never defaulted. A module-supplied fallback would be the same
   * secret in every deployment that forgot to set one, which is worse than a
   * boot failure because nothing ever reports it.
   */
  jwtSecret: string;

  /**
   * Pinned into every token and checked on every verification. Two services
   * sharing a secret but not an audience cannot accept each other's tokens,
   * which is the point.
   */
  issuer: string;
  audience: string;

  /**
   * Seconds. All three fall back to domain/policy.ts when the app leaves them
   * unset — which is what makes a missing env var a documented default rather
   * than a boot failure or, worse, a zero.
   *
   *   sessionTtl        how long someone stays signed in. One week by default.
   *   accessTokenTtl    how long before the client silently renews. Short by
   *                     design: a revoked session stays usable until the
   *                     current access token expires, because verification
   *                     reads no database. Raising this raises that window.
   *   passwordResetTtl  a link waiting in an inbox. One hour.
   */
  sessionTtl?: number;
  accessTokenTtl?: number;
  passwordResetTtl?: number;

  /** Binds the app's Prisma client to AUTH_PRISMA. */
  prismaProvider?: Provider;

  /**
   * How a reset link reaches its owner.
   *
   * REQUIRED for the forgot-password endpoint, and with no default on purpose:
   * the obvious fallback — log it — writes a working credential into whatever
   * aggregates the app's logs. Absent, `requestPasswordReset` refuses with a
   * configuration error rather than creating a token nobody can receive.
   *
   * Called with the RAW token exactly once. It is not stored in that form
   * anywhere, so if delivery fails the token is gone and the user asks again.
   */
  sendPasswordResetEmail?: (input: {
    user: SessionUser;
    /** The raw token. Put it in a URL; do not log it. */
    token: string;
    expiresAt: Date;
  }) => Promise<void>;

  /**
   * Observability for a path that deliberately tells the caller nothing.
   *
   * Every sign-in failure returns one message; an operator still needs to tell
   * an unknown address from a locked account. This is where that difference
   * goes — a log, a metric, an alert on a spike of `wrong_password`.
   */
  onAuthFailure?: (event: { reason: AuthFailureReason; email?: string; userId?: string; ip?: string | null }) => void;
}
