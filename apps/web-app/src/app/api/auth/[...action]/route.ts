import { createAuthRouteHandlers } from '@kwtech/module-auth/next';
import { ACTIVE_ORGANIZATION_COOKIE, ACTIVE_WORKSPACE_COOKIE, expiredPreferenceCookie } from '@/lib/preferences';

/**
 * Every auth endpoint the browser may reach, served by the module.
 *
 * Next discovers route handlers from the filesystem and a package cannot inject
 * one — the same constraint that gives the module pages their catch-all
 * (PLAN §12.11). So this file is the irreducible cost of adopting the module:
 * the handler behind it — the credential proxy, the httpOnly cookies, sign-out
 * that revokes as well as forgets — lives in `@kwtech/module-auth/next` and is
 * reviewed once for every app.
 *
 * It reads `API_URL` and `SESSION_COOKIE` from the environment.
 *
 * ## Why this is no longer a one-line re-export
 *
 * Sign-out has to clear the tenant SELECTION as well as the session, and that
 * belongs here rather than in either module.
 *
 * `module-auth` clears exactly what it owns: the session cookie and its
 * refresh. It must not know that another module has a notion of a "selected
 * organization" — the two modules do not import each other (PLAN §9), and a
 * list of other people's cookies inside a sign-out handler is precisely the
 * coupling that boundary exists to prevent. `module-permissions` cannot do it
 * either: it has no route, and no opinion about when a session ends.
 *
 * Composing the two is the APP's job, exactly as `resolvePrincipal` composes
 * them on the server and `AppShell` composes them on the web. This wrapper is
 * that composition, and it is the whole of it.
 */
const handlers = createAuthRouteHandlers();

/**
 * The actions that END a session, and must therefore drop the selection.
 *
 * `signout-all` is here as well as `signout`, and forgetting it would be the
 * easy mistake: "sign out everywhere" is at least as much a sign-out, and a
 * reader who used it to secure a shared machine would be the one most surprised
 * to come back and find the drawer still opened on their company.
 */
const ENDS_SESSION = new Set(['signout', 'signout-all']);

/**
 * The preferences a sign-out drops.
 *
 * ⚠ Only the ones that name a TENANT. `kwtech_sidebar_collapsed` and the theme
 * deliberately survive: they are facts about how this person likes their
 * browser, not about which customer they were last looking at, and clearing
 * them would make signing out feel like a factory reset.
 */
const CLEARED_ON_SIGN_OUT = [ACTIVE_ORGANIZATION_COOKIE, ACTIVE_WORKSPACE_COOKIE];

export async function POST(request: Request, context: { params: Promise<{ action: string[] }> }): Promise<Response> {
  const response = await handlers.POST(request, context);

  /*
   * Awaited a second time, which is free: `params` is one promise and the
   * module's handler already awaited it. Reading it after delegating rather
   * than before keeps this wrapper unable to change what the module does — it
   * only adds headers to what came back.
   */
  const { action } = await context.params;
  const name = action.length === 1 ? action[0] : undefined;
  if (!name || !ENDS_SESSION.has(name)) return response;

  /*
   * A NEW Response rather than mutating the old one's headers: a Response's
   * `headers` is immutable once it has been constructed by `fetch`-style code,
   * and appending to it silently does nothing in some runtimes rather than
   * throwing. Copying is cheap and it always works.
   *
   * The status, the body and every header the module set are carried through
   * untouched — including its own cookie deletions and, for `signout`, the 303
   * `location` that sends the browser onward.
   */
  const headers = new Headers(response.headers);
  for (const cookie of CLEARED_ON_SIGN_OUT) headers.append('set-cookie', expiredPreferenceCookie(cookie));

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
