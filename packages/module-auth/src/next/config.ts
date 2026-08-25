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
}

/** The refresh token's cookie is derived, so one name configures both. */
export function refreshCookieName(config: AuthNextConfig): string {
  return `${config.cookieName}_refresh`;
}

export const DEFAULT_API_URL = 'http://localhost:8080/api/v1';
export const DEFAULT_COOKIE_NAME = 'kwtech_session';

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
  };
}
