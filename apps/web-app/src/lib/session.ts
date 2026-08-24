import { cookies } from 'next/headers';
import { env } from '@/config/env';

/**
 * Who is signed in, read on the SERVER.
 *
 * The access token lives in an httpOnly cookie, so this is the only place that
 * can see it — which is the whole point of the arrangement: no client
 * JavaScript, and therefore no XSS, can reach the session.
 *
 * Returns null rather than throwing for every failure — expired token, API
 * down, no cookie at all. A page asking "who is this" wants an answer it can
 * render, and treating "the API is restarting" as a crash would take the whole
 * site down with it.
 *
 * Calls /auth/profile, not /auth/me: the latter returns only the token's claims
 * and would greet someone by their user id.
 */
export interface Viewer {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
}

export async function getViewer(): Promise<Viewer | null> {
  const token = (await cookies()).get(env.SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const response = await fetch(`${env.API_URL}/auth/profile`, {
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
