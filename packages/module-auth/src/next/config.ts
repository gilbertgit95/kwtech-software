import { SESSION_TTL } from '../domain/policy.js';

/**
 * How the Next adapter is configured — and why it has defaults at all.
 *
 * PLAN §9 rule 6 says apps configure and modules do not guess. Reading
 * `process.env` here looks like guessing, so the distinction matters: the
 * module does not *discover* its configuration, it *publishes a contract* —
 * these three variable names, documented here and in the README — and an app
 * that sets them has configured it. Anything that wants different names, or
 * values from somewhere other than the environment, passes them explicitly and
 * nothing below is consulted.
 *
 * The point is that the common case costs a `.env` line rather than a wiring
 * file, while the uncommon case stays fully expressible. Without the defaults
 * every app adopting this module rewrites the same twenty lines, and the copy
 * that gets a security detail wrong is the one nobody reviews.
 */

export interface AuthNextConfig {
  /**
   * Where the API lives, including its prefix: `http://localhost:8080/api/v1`.
   *
   * Deliberately NOT a `NEXT_PUBLIC_` value. The browser never calls the API
   * directly — it calls the route handlers in this adapter, which hold the
   * tokens in httpOnly cookies. Publishing the API origin to the client would
   * invite exactly the arrangement that design exists to prevent.
   */
  apiUrl: string;
  /**
   * Names the session cookie; encrypts nothing. Configurable so two
   * deployments on sibling subdomains do not overwrite each other's session.
   */
  cookieName: string;
  /**
   * `Secure` on the cookies. Off in development so the flow works over plain
   * http on localhost; anything else in production is a session sent in clear.
   */
  secure: boolean;
  /** Seconds the browser keeps the cookies. See DEFAULT_SESSION_MAX_AGE. */
  sessionMaxAge: number;
}

/** The refresh token's cookie is derived, so one name configures both. */
export function refreshCookieName(config: AuthNextConfig): string {
  return `${config.cookieName}_refresh`;
}

export const DEFAULT_API_URL = 'http://localhost:8080/api/v1';
export const DEFAULT_COOKIE_NAME = 'kwtech_session';

/**
 * How long the browser keeps the session cookies, in seconds.
 *
 * Defaults to `SESSION_TTL` — the same constant the API uses for the refresh
 * token — so the cookie and the row it names expire together.
 *
 * ## Why this exists at all
 *
 * Written without it, both cookies had no `Max-Age` and no `Expires`, which
 * makes them SESSION COOKIES: the browser throws them away when it closes. A
 * seven-day server session was therefore unreachable after a browser restart,
 * and "stay signed in for a week" actually meant "until you quit your browser".
 *
 * ## The trade, stated
 *
 * A persistent cookie survives closing the browser, which is what people expect
 * — and on a shared or public machine it also means the next person to open the
 * browser is still signed in as you. Applications that care usually put this
 * behind a "Keep me signed in" checkbox and issue a session cookie when it is
 * unticked. This deployment keeps people signed in unconditionally; that is a
 * product decision, and this is where it is made.
 *
 * ⚠️ Keep it >= the API's `AUTH_SESSION_TTL`. A shorter cookie signs people out
 * early for no reason; a longer one merely costs one refused refresh.
 */
export const DEFAULT_SESSION_MAX_AGE = SESSION_TTL;

/**
 * Resolved lazily, per call, NOT once at import time.
 *
 * A module-level constant would be baked in when Next first loads the file,
 * which in a built app is before the runtime environment is necessarily in
 * place — and it would make the value untestable without reloading the module.
 */
export function resolveConfig(overrides?: Partial<AuthNextConfig>): AuthNextConfig {
  return {
    apiUrl: overrides?.apiUrl ?? process.env.API_URL ?? DEFAULT_API_URL,
    cookieName: overrides?.cookieName ?? process.env.SESSION_COOKIE ?? DEFAULT_COOKIE_NAME,
    secure: overrides?.secure ?? process.env.NODE_ENV === 'production',
    sessionMaxAge: overrides?.sessionMaxAge ?? readSeconds(process.env.SESSION_MAX_AGE) ?? DEFAULT_SESSION_MAX_AGE,
  };
}

/**
 * A positive integer of seconds, or undefined.
 *
 * Refuses anything else rather than falling back silently: `SESSION_MAX_AGE=7d`
 * would parse as 7 with `parseInt` and sign everyone out after seven SECONDS,
 * which is the kind of misconfiguration that reads as a mysterious bug rather
 * than a typo.
 */
function readSeconds(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`SESSION_MAX_AGE must be a whole number of seconds — received '${raw}'`);
  }
  const seconds = Number(raw);
  return seconds > 0 ? seconds : undefined;
}
