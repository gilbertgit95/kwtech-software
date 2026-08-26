import type { AuthResult } from '../types.js';
import { type AuthNextConfig, refreshCookieName, resolveConfig } from './config.js';
import { serializeCookie } from './cookies.js';

/**
 * Renewing a session from OUTSIDE a route handler — for middleware.
 *
 * ## The gap this closes
 *
 * `SessionKeeper` renews from the browser, and it cannot help on the first
 * request after a gap: closing the laptop, or the browser, for longer than the
 * access token's life means the next NAVIGATION arrives with an expired token,
 * the server renders, `getViewer()` is null, and the shell redirects to sign-in
 * — while a week-long refresh token sits unused in the next cookie. The server
 * decides before any client code runs, so only the server can fix it.
 *
 * Middleware is the right layer: it runs before the render, so the page never
 * sees the expired state.
 *
 * ## Why this file imports no Next
 *
 * `next/server` inside a package that goes through `transpilePackages` becomes a
 * binding that is not there — `ReferenceError: server_1 is not defined`, on the
 * first request rather than at build (see ./cookies.ts). So this returns plain
 * `Set-Cookie` STRINGS and the app's own middleware applies them with whatever
 * `NextResponse` it likes. It also keeps the helper usable from a plain server,
 * a test, or a future non-Next frontend.
 */

/** What middleware needs to decide, without doing any crypto. */
export interface RenewalDecision {
  /** No usable credential at all — let the request through and be redirected. */
  kind: 'no-session' | 'fresh' | 'renewed' | 'ended';
  /** `Set-Cookie` values to apply. Present for 'renewed' and 'ended'. */
  cookies?: string[];
  /** The new access token, for a caller that wants to use it immediately. */
  accessToken?: string;
}

/**
 * Reads a JWT's `exp` WITHOUT verifying it.
 *
 * Deliberate, and safe: this only decides whether attempting a refresh is worth
 * a round trip. A forged or tampered token fails at the API a moment later
 * exactly as it would have anyway, so nothing is trusted on the strength of this
 * — the alternative is to verify, which would put the JWT secret in the frontend
 * process, which is the one thing this whole adapter exists to avoid.
 */
function expiryOf(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}

/**
 * Seconds of headroom. A token expiring within this window is treated as already
 * expired, so a render does not begin with three seconds of validity left and
 * finish without any.
 */
const SKEW_SECONDS = 15;

/**
 * Decides whether the request needs a renewal, and performs one if so.
 *
 * Never throws. A middleware that threw would take out every route on the site,
 * including the sign-in page someone needs in order to recover.
 */
export async function renewSessionIfNeeded(
  cookies: { accessToken: string | null; refreshToken: string | null },
  overrides?: Partial<AuthNextConfig>,
): Promise<RenewalDecision> {
  const config = resolveConfig(overrides);

  // Nothing to renew from. The request continues and the shell redirects, which
  // is the correct handling of "signed out".
  if (!cookies.refreshToken) return { kind: 'no-session' };

  const expiry = cookies.accessToken ? expiryOf(cookies.accessToken) : null;
  const stillGood = expiry !== null && expiry - SKEW_SECONDS > Math.floor(Date.now() / 1000);
  if (stillGood) return { kind: 'fresh' };

  let upstream: Response;
  try {
    upstream = await fetch(`${config.apiUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: cookies.refreshToken }),
      cache: 'no-store',
    });
  } catch {
    /*
     * The API is unreachable — a deploy, a network blip. NOT a signed-out user.
     * Reported as 'fresh' so the request continues untouched: clearing cookies
     * here would sign the whole application out during a thirty-second restart,
     * and the page's own call will fail informatively if the outage is real.
     */
    return { kind: 'fresh' };
  }

  const payload = (await upstream.json().catch(() => ({}))) as Partial<AuthResult>;

  if (!upstream.ok || !payload.accessToken || !payload.refreshToken) {
    /*
     * The session really has ended — revoked, expired, or signed out elsewhere.
     * The cookies are cleared so the browser stops presenting a refresh token
     * that will never work again, and so the shell's redirect is not undone by
     * the next request finding the same dead cookie.
     */
    return { kind: 'ended', cookies: clearCookies(config) };
  }

  return {
    kind: 'renewed',
    accessToken: payload.accessToken,
    cookies: [
      [config.cookieName, payload.accessToken],
      [refreshCookieName(config), payload.refreshToken],
    ].map(([name, value]) =>
      serializeCookie(name as string, value as string, {
        httpOnly: true,
        secure: config.secure,
        sameSite: 'lax',
        path: '/',
        maxAge: config.sessionMaxAge,
      }),
    ),
  };
}

function clearCookies(config: AuthNextConfig): string[] {
  return [config.cookieName, refreshCookieName(config)].map((name) =>
    serializeCookie(name, '', { httpOnly: true, path: '/', maxAge: 0 }),
  );
}
