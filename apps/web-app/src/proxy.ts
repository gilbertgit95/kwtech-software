import { AUTH_DEVICE_COOKIE, isAuthDeviceId } from '@kwtech/module-auth';
import { DEFAULT_COOKIE_NAME, renewSessionIfNeeded, serializeCookie } from '@kwtech/module-auth/next';
import { type NextRequest, NextResponse, userAgent } from 'next/server';
import { chooseLayout, mobileRewritePath, parseLayoutPreference } from '@/lib/layout-choice';
import { layoutCookieName } from '@/lib/preferences';
import { tokenSubject } from '@/lib/token-subject';

/**
 * Renews an expired session BEFORE the page renders, and sends a phone to the
 * phone layout (issue #22, `@/lib/layout-choice`).
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
 * The proxy runs before the render, which makes it the only layer where the
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
 * what. Enforcement stays with the API, on every request — a proxy check is
 * something an attacker calling the API directly never runs.
 */

/*
 * ⚠ Node.js, never Edge — and no `export const runtime` here. Next 16 renamed
 * `middleware.ts` to `proxy.ts`, and a proxy ALWAYS runs on Node.js: the build
 * refuses a route segment config in this file. Node is what this needs anyway.
 * `renewSessionIfNeeded` decodes a JWT payload with `Buffer`, which Edge lacks,
 * and reads `process.env` at request time rather than having it inlined at build.
 */

const cookieName = () => process.env.SESSION_COOKIE ?? DEFAULT_COOKIE_NAME;

export async function proxy(request: NextRequest) {
  const name = cookieName();
  const decision = await renewSessionIfNeeded({
    accessToken: request.cookies.get(name)?.value ?? null,
    refreshToken: request.cookies.get(`${name}_refresh`)?.value ?? null,
  });

  const renewed = decision.cookies?.length ? decision.cookies : null;
  /** Cookies this request should carry onward that the browser has not sent yet: name → value. */
  const added = new Map<string, string>();
  const setCookies = [...(renewed ?? [])];

  /*
   * The renewed token is put on the REQUEST as well as in the response cookies.
   *
   * Without the request half, the page this proxy is about to render would
   * still read the old expired cookie — the new one would only take effect on
   * the NEXT navigation, so the first click after a gap would still bounce. That
   * is the whole bug, half-fixed, which is worse than obvious.
   */
  if (renewed && decision.kind === 'renewed' && decision.accessToken) added.set(name, decision.accessToken);

  /*
   * THIS DEVICE'S ID (the operator, 2026-10-29), issued on the first visit and
   * kept for years: a person's display sizes can be this device's own. Not a
   * credential and proves nothing — see `AUTH_DEVICE_COOKIE` — so readable by
   * the page, which names it to the API. On the request too, like the token,
   * so the very first page already reads this device's sizes.
   */
  if (!isAuthDeviceId(request.cookies.get(AUTH_DEVICE_COOKIE)?.value)) {
    const deviceId = crypto.randomUUID();
    added.set(AUTH_DEVICE_COOKIE, deviceId);
    setCookies.push(
      serializeCookie(AUTH_DEVICE_COOKIE, deviceId, {
        path: '/',
        maxAge: DEVICE_COOKIE_MAX_AGE,
        sameSite: 'lax',
        secure: request.nextUrl.protocol === 'https:',
      }),
    );
  }

  // Whose layout choice applies: the signed-in person's, read from their (possibly just renewed) token.
  const userId = tokenSubject(added.get(name) ?? request.cookies.get(name)?.value);
  const mobileTarget = mobileTargetFor(request, userId);

  if (added.size === 0 && !mobileTarget) return NextResponse.next();

  const headers = new Headers(request.headers);
  if (added.size > 0) {
    const kept = request.cookies
      .getAll()
      .filter((cookie) => !added.has(cookie.name))
      .map((cookie) => `${cookie.name}=${cookie.value}`);
    headers.set('cookie', [...kept, ...[...added].map(([key, value]) => `${key}=${value}`)].join('; '));
  }

  /*
   * A phone's page is REWRITTEN, not redirected (issue #22): the address bar
   * keeps the URL that was asked for, and the phone page renders it. The
   * renewed token rides on the rewritten request too — the same headers — or
   * the phone page would render with the expired one and send its reader to
   * sign in, the bug above in a new place.
   */
  let response = NextResponse.next({ request: { headers } });
  if (mobileTarget) {
    const url = request.nextUrl.clone();
    url.pathname = mobileTarget;
    response = NextResponse.rewrite(url, { request: { headers } });
  }
  for (const cookie of setCookies) response.headers.append('set-cookie', cookie);
  return response;
}

/** How long a device keeps its id: five years, renewed by nothing — it is the device, not a session. */
const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 5;

/**
 * The phone page to render this request with, or null for the page it asked for.
 *
 * Allowlisted paths only (`mobileRewritePath`), and only when the layout is
 * `mobile` — by the device, or by the signed-in person's own choice on this
 * device (`layoutCookieName`), which wins everywhere but on a phone. Not a guard: the phone page resolves the viewer's grants
 * itself, exactly as the desktop one does.
 *
 * ⚠ One URL therefore answers differently by device. Safe today because these
 * pages are rendered per request and sent `no-store`, so nothing between here
 * and the browser keeps one. A `Vary: User-Agent, Cookie` set here does not
 * survive: Next writes the page's own `Vary` over it. A CDN put in front later
 * must be told to bypass these paths, or one phone's page could reach a
 * computer.
 */
function mobileTargetFor(request: NextRequest, userId: string | null): string | null {
  const target = mobileRewritePath(request.nextUrl.pathname);
  if (!target) return null;
  // The signed-in person's own choice on this device; nobody signed in has none, and the device decides.
  const preference = userId ? request.cookies.get(layoutCookieName(userId))?.value : undefined;
  const layout = chooseLayout(userAgent(request).device.type, parseLayoutPreference(preference));
  return layout === 'mobile' ? target : null;
}

export const config = {
  /*
   * Document navigations only.
   *
   *   /api/auth  — excluded so this and SessionKeeper never rotate the same
   *                refresh token at once. Refresh is a conditional update and
   *                the loser is told the session was revoked; racing ourselves
   *                would sign people out at random.
   *   /api/print — excluded because it carries a print job's FILE. Next reads
   *                a request's body to run a proxy over it, up to a size
   *                limit, and a file past the limit would arrive cut short.
   *                No session is read there either: a one-time ticket is the
   *                authorisation (see app/api/print/jobs/[jobId]/content).
   *   /api/backups — excluded for the same reason in the other direction: a
   *                backup's file, streamed out, admitted by a one-time ticket
   *                (app/api/backups/download). Nothing there reads a session.
   *   _next, static assets — no session is read while serving a file, and a
   *                refresh round trip per image would be absurd.
   */
  matcher: ['/((?!api/auth|api/print|api/backups|_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)'],
};
