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
   * REQUIRED, and NEVER given a fallback value. Omit it and the module reads
   * `AUTH_JWT_SECRET`; if that is unset too, `forRoot` throws at boot.
   *
   * Reading an environment variable is not the same as defaulting one. A
   * module-supplied fallback secret would be the same secret in every
   * deployment that forgot to set one — worse than a boot failure, because
   * nothing ever reports it. This still fails to boot; it just spells the
   * source of the value as a documented convention instead of a wiring line.
   */
  jwtSecret?: string;

  /**
   * Pinned into every token and checked on every verification. Two services
   * sharing a secret but not an audience cannot accept each other's tokens,
   * which is the point — so change these together with the secret when a second
   * service appears, via `AUTH_TOKEN_ISSUER` / `AUTH_TOKEN_AUDIENCE` or here.
   *
   * Unlike the secret these DO default, because they are consistency checks
   * rather than credentials: getting them wrong cannot leak anything, and a
   * single-service deployment has nothing to distinguish itself from.
   */
  issuer?: string;
  audience?: string;

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

export const DEFAULT_TOKEN_ISSUER = 'kwtech-web-server';
export const DEFAULT_TOKEN_AUDIENCE = 'kwtech-api';

const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86_400 } as const;

/**
 * `'15m'` / `'7d'` in configuration, seconds in code.
 *
 * Durations are written the way an operator thinks about them and consumed the
 * way jsonwebtoken and Date arithmetic want them, so nothing downstream parses
 * a suffix. Exported so an app validating its own environment uses THIS table
 * rather than a second copy that can disagree about what 'd' means.
 *
 * Returns null on anything malformed — including a bare number, which is
 * ambiguous between seconds and milliseconds and is exactly the mistake worth
 * refusing rather than guessing at.
 */
export function parseDuration(value: string | undefined): number | null {
  if (!value || !/^\d+[smhd]$/.test(value)) return null;
  const unit = value.slice(-1) as keyof typeof UNIT_SECONDS;
  return Number(value.slice(0, -1)) * UNIT_SECONDS[unit];
}

/**
 * A TTL from the environment, or undefined to leave the policy default alone.
 *
 * A malformed value THROWS rather than falling back. Silently ignoring
 * `AUTH_ACCESS_TOKEN_TTL=15` would hand back a 15-second session and look like
 * a bug in the app; the whole point of reading it is that an operator meant
 * something by it.
 */
function ttlFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;

  const seconds = parseDuration(raw);
  if (seconds === null || seconds <= 0) {
    throw new Error(`${name} must be a positive duration like '15m', '24h' or '7d' — received '${raw}'`);
  }
  return seconds;
}

/** Options with every value the module needs actually present. */
export type ResolvedAuthModuleOptions = AuthModuleOptions & {
  jwtSecret: string;
  issuer: string;
  audience: string;
};

/**
 * Fills in what the app left unsaid, from the environment contract this module
 * publishes, and refuses to boot without a secret.
 *
 * Called once in `forRoot`, so a misconfiguration is a failed start rather than
 * a failed sign-in at 3am.
 */
export function resolveAuthOptions(options: AuthModuleOptions): ResolvedAuthModuleOptions {
  const jwtSecret = options.jwtSecret ?? process.env.AUTH_JWT_SECRET;
  if (!jwtSecret) {
    throw new Error(
      'AuthModule.forRoot: no JWT secret. Set AUTH_JWT_SECRET in the environment, or pass { jwtSecret } explicitly.',
    );
  }

  /*
   * TTLs are three-way: what the app passed, else what the environment says,
   * else the policy default in domain/policy.ts. Only keys that resolved to a
   * number are set, because `exactOptionalPropertyTypes` makes an explicit
   * `undefined` different from an absent key — and the services read
   * `options.sessionTtl ?? SESSION_TTL`, which an explicit undefined would
   * satisfy but a null would not.
   */
  const ttls: Pick<AuthModuleOptions, 'sessionTtl' | 'accessTokenTtl' | 'passwordResetTtl'> = {};
  const sessionTtl = options.sessionTtl ?? ttlFromEnv('AUTH_SESSION_TTL');
  const accessTokenTtl = options.accessTokenTtl ?? ttlFromEnv('AUTH_ACCESS_TOKEN_TTL');
  const passwordResetTtl = options.passwordResetTtl ?? ttlFromEnv('AUTH_PASSWORD_RESET_TTL');
  if (sessionTtl !== undefined) ttls.sessionTtl = sessionTtl;
  if (accessTokenTtl !== undefined) ttls.accessTokenTtl = accessTokenTtl;
  if (passwordResetTtl !== undefined) ttls.passwordResetTtl = passwordResetTtl;

  /*
   * A session shorter than the access token it issues is incoherent: the
   * stateless access token would outlive the revocable row that names it, so
   * sign-out-everywhere would appear to do nothing for the difference. Caught
   * here because both values are finally known here, whatever mix of sources
   * they came from.
   */
  if (sessionTtl !== undefined && accessTokenTtl !== undefined && sessionTtl <= accessTokenTtl) {
    throw new Error(
      `AUTH_SESSION_TTL (${sessionTtl}s) must be longer than AUTH_ACCESS_TOKEN_TTL (${accessTokenTtl}s) — ` +
        'otherwise a revoked session stays usable for the whole difference.',
    );
  }

  return {
    ...options,
    ...ttls,
    jwtSecret,
    issuer: options.issuer ?? process.env.AUTH_TOKEN_ISSUER ?? DEFAULT_TOKEN_ISSUER,
    audience: options.audience ?? process.env.AUTH_TOKEN_AUDIENCE ?? DEFAULT_TOKEN_AUDIENCE,
  };
}
