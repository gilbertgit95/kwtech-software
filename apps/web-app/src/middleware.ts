import { DEFAULT_COOKIE_NAME, renewSessionIfNeeded } from '@kwtech/module-auth/next';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Renews an expired session BEFORE the page renders.
 *
 * ## Why this file exists
 *
 * `SessionKeeper` renews from the browser, and it cannot help on the first
 * request after a gap. Close the laptop — or the browser — for longer than the
 * access token's five minutes, and the next navigation arrives with an expired
 * token: the server renders, `getViewer()` is null, and the shell redirects to
 * sign-in, while a week-long refresh token sits unused in the next cookie.
 *
 * The server decides before any client code runs, so only the server can fix it.
 * Middleware runs before the render, which makes it the only layer where the
 * page never sees the expired state at all.
 *
 * Together with the persistent cookies (see DEFAULT_SESSION_MAX_AGE), this is
 * what makes "close the browser, come back later, still signed in" true. Either
 * one alone leaves it false: persistent cookies without this bounce you on the
 * first click; this without persistent cookies has no refresh token to use.
 *
 * ## What it does NOT do
 *
 * It is not a guard. It renews a credential; it does not decide who may see
 * what. Enforcement stays with the API, on every request — a middleware check is
 * something an attacker calling the API directly never runs.
 */

/**
 * The Node runtime, not Edge.
 *
 * `renewSessionIfNeeded` decodes a JWT payload with `Buffer`, which does not
 * exist on Edge, and it reads `process.env` at request time rather than having
 * it inlined at build. Both are the sort of thing that builds cleanly and then
 * fails on the first request in production.
 */
export const runtime = 'nodejs';

const cookieName = () => process.env.SESSION_COOKIE ?? DEFAULT_COOKIE_NAME;

export async function middleware(request: NextRequest) {
  const name = cookieName();
  const decision = await renewSessionIfNeeded({
    accessToken: request.cookies.get(name)?.value ?? null,
    refreshToken: request.cookies.get(`${name}_refresh`)?.value ?? null,
  });

  if (!decision.cookies?.length) return NextResponse.next();

  /*
   * The renewed token is put on the REQUEST as well as in the response cookies.
   *
   * Without the request half, the page this middleware is about to render would
   * still read the old expired cookie — the new one would only take effect on
   * the NEXT navigation, so the first click after a gap would still bounce. That
   * is the whole bug, half-fixed, which is worse than obvious.
   */
  const headers = new Headers(request.headers);
  if (decision.kind === 'renewed' && decision.accessToken) {
    const others = request.cookies
      .getAll()
      .filter((cookie) => cookie.name !== name)
      .map((cookie) => `${cookie.name}=${cookie.value}`);
    headers.set('cookie', [...others, `${name}=${decision.accessToken}`].join('; '));
  }

  const response = NextResponse.next({ request: { headers } });
  for (const cookie of decision.cookies) response.headers.append('set-cookie', cookie);
  return response;
}

export const config = {
  /*
   * Document navigations only.
   *
   *   /api/auth  — excluded so this and SessionKeeper never rotate the same
   *                refresh token at once. Refresh is a conditional update and
   *                the loser is told the session was revoked; racing ourselves
   *                would sign people out at random.
   *   _next, static assets — no session is read while serving a file, and a
   *                refresh round trip per image would be absurd.
   */
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)'],
};
