import { cookies } from 'next/headers';
import type { Viewer } from '../types.js';
import { type AuthNextConfig, resolveConfig } from './config.js';

/**
 * Who is signed in, read on the SERVER.
 *
 * The access token lives in an httpOnly cookie, so this is the only place that
 * can see it — which is the whole point of the arrangement: no client
 * JavaScript, and therefore no XSS, can reach the session.
 */

/**
 * The raw access token, for anything that has to call the API on the viewer's
 * behalf.
 *
 * THIS IS THE WEB-SIDE SEAM. `module-permissions` needs a token to ask what the
 * caller holds, and the two modules must not import each other (PLAN §9) — so
 * the app reads it here and passes it there, exactly as
 * `apps/web-server/src/auth/resolve-principal.ts` does on the server. One
 * function, one direction, no shared package between them.
 *
 * Returns null rather than throwing when there is no cookie: signed out is a
 * normal state, not an error.
 */
export async function getSessionToken(overrides?: Partial<AuthNextConfig>): Promise<string | null> {
  const config = resolveConfig(overrides);
  return (await cookies()).get(config.cookieName)?.value ?? null;
}

/**
 * Returns null rather than throwing for every failure — expired token, API
 * down, no cookie at all. A page asking "who is this" wants an answer it can
 * render, and treating "the API is restarting" as a crash would take the whole
 * site down with it.
 *
 * Calls /auth/profile, not /auth/me: the latter returns only the token's claims
 * and would greet someone by their user id.
 */
export async function getViewer(overrides?: Partial<AuthNextConfig>): Promise<Viewer | null> {
  const config = resolveConfig(overrides);
  const token = await getSessionToken(config);
  if (!token) return null;

  try {
    const response = await fetch(`${config.apiUrl}/auth/profile`, {
      headers: { authorization: `Bearer ${token}` },
      // Never cached: a signed-out user must not be served the previous
      // viewer's identity from a shared cache.
      cache: 'no-store',
    });
    if (!response.ok) return null;
    // The endpoint answers `null` for a user suspended or deleted since the
    // token was issued — a 200 with no body, not an error.
    return ((await response.json()) as Viewer | null) ?? null;
  } catch {
    return null;
  }
}
