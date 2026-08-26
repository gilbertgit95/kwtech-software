import type { Provider } from '@nestjs/common';
import type { AuthFailureReason, SessionUser } from '../types.js';
import type { SessionRevocationStore } from './revocation.js';
import { readSecretKey } from './secret-box.js';

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
   * How JwtAuthGuard finds the underlying request, for transports that are not
   * plain HTTP.
   *
   * Unset, the guard calls `context.switchToHttp().getRequest()`, which is
   * correct for REST and returns UNDEFINED for a GraphQL resolver or a
   * subscription — the guard then reads `.headers` off nothing and the field
   * fails with `Cannot read properties of undefined`, which names neither the
   * transport nor the cause.
   *
   * The module cannot supply this itself: knowing that a GraphQL request lives
   * at `GqlExecutionContext.create(ctx).getContext().req` means importing
   * @nestjs/graphql, and a module that did would make every consumer install a
   * GraphQL stack to run a REST API.
   *
   * Typed as `unknown` for the same reason — the ExecutionContext is Nest's, and
   * narrowing it belongs in the app, which already depends on Nest.
   *
   *   getRequest: (ctx) => {
   *     const c = ctx as ExecutionContext;
   *     return c.getType() === 'graphql'
   *       ? GqlExecutionContext.create(c).getContext().req
   *       : c.switchToHttp().getRequest();
   *   }
   *
   * @kwtech/module-permissions publishes the identical hook, and an app that
   * uses both should hand them the SAME function — two ways of finding the
   * request is two chances for the authentication guard and the authorisation
   * guard to disagree about who is calling.
   */
  getRequest?: (context: unknown) => unknown;

  /**
   * Which transports this module mounts. Both on by default.
   *
   *   rest     the AuthController — sign-in, refresh, sign-out, the password
   *            and MFA endpoints. Turning it off leaves an app with NO way to
   *            exchange a credential, so it is almost never right.
   *   graphql  the AuthResolver — `viewer` and `session`, reads only. Turn it
   *            off in an app that mounts no GraphQLModule: the resolver would
   *            otherwise be a provider whose decorators reference a driver that
   *            is not there.
   *
   * Mirrors `PermissionsModuleOptions.expose` deliberately — two modules with
   * the same shape of switch is one thing for an app to learn.
   */
  expose?: { rest?: boolean; graphql?: boolean };

  /**
   * Where revoked sessions are remembered until their access tokens expire.
   *
   * This is what makes sign-out IMMEDIATE. Without a store, revoking a session
   * sets a column nothing reads until the next refresh, so a revoked or stolen
   * token keeps working for the rest of its life — a window that lowering
   * `accessTokenTtl` bounds but never closes.
   *
   * Defaults to `InMemoryRevocationStore`, which is **correct for exactly one
   * API instance**. A second replica has its own memory and will accept a token
   * the first just revoked. Supply a Redis-backed implementation when you scale
   * — the same caveat, and the same remedy, as the in-memory PubSub behind
   * subscriptions (PLAN §7).
   *
   * Pass `null` to disable it and accept the window.
   */
  revocationStore?: SessionRevocationStore | null;

  /**
   * Encrypts TOTP secrets at rest. 32 bytes, base64 or hex; omit it and the
   * module reads `AUTH_MFA_SECRET_KEY`.
   *
   * REQUIRED before anyone can enrol a second factor, and with no default for
   * the same reason `jwtSecret` has none — except that the consequence here is
   * worse than a shared secret. A TOTP secret is SYMMETRIC: unlike a password
   * hash, a stolen row generates valid codes forever, so a module-supplied
   * default key would mean every deployment that forgot to set one stores
   * effectively-plaintext second factors.
   *
   * Unlike `jwtSecret` this does NOT fail the boot when absent — an app with no
   * 2FA users has no reason to hold the key. The enrolment endpoint refuses
   * instead, in the same shape as `sendPasswordResetEmail`: the feature is off
   * rather than half-on.
   *
   * ⚠️ Rotating it makes every enrolled factor undecryptable. Those users fall
   * back to a recovery code, which is the other half of why
   * `AuthRecoveryCode` exists — but it is a support event, not a no-op.
   * Deliberately NOT the same value as `jwtSecret`: rotating that one to
   * respond to a token incident would otherwise lock every 2FA user out.
   */
  mfaSecretKey?: string;

  /**
   * The name an authenticator app shows above the code — "KWTech", not
   * "kwtech-api".
   *
   * Defaults to `issuer`, which is right for a single-service deployment and
   * wrong the moment the token audience stops being a human-readable name. A
   * user with a dozen entries in their app distinguishes them by this string
   * alone.
   */
  mfaIssuerLabel?: string;

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
  mfaIssuerLabel: string;
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

  const issuer = options.issuer ?? process.env.AUTH_TOKEN_ISSUER ?? DEFAULT_TOKEN_ISSUER;

  /*
   * The MFA key is only READ here, never required. An app with no 2FA users has
   * no reason to hold one, and failing the boot over it would make enabling the
   * feature a deployment-wide event rather than a per-user one.
   *
   * It is validated eagerly all the same — `readSecretKey` runs at enrolment,
   * but a key of the wrong length set in the environment is a configuration
   * mistake an operator wants to hear about at boot, not from the first user who
   * scans a QR code.
   */
  const mfaSecretKey = options.mfaSecretKey ?? process.env.AUTH_MFA_SECRET_KEY;
  if (mfaSecretKey !== undefined) readSecretKey(mfaSecretKey);

  const mfa: Pick<AuthModuleOptions, 'mfaSecretKey'> = {};
  if (mfaSecretKey !== undefined) mfa.mfaSecretKey = mfaSecretKey;

  return {
    ...options,
    ...ttls,
    ...mfa,
    jwtSecret,
    issuer,
    audience: options.audience ?? process.env.AUTH_TOKEN_AUDIENCE ?? DEFAULT_TOKEN_AUDIENCE,
    mfaIssuerLabel: options.mfaIssuerLabel ?? process.env.AUTH_MFA_ISSUER_LABEL ?? issuer,
  };
}
