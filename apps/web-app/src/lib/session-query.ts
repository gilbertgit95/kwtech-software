import type { Viewer } from '@kwtech/module-auth';
import { getSessionToken } from '@kwtech/module-auth/next';
import type { PermissionContext } from '@kwtech/module-permissions';
import { cache } from 'react';

/**
 * Who is signed in and what they hold — in ONE request.
 *
 * ## Why this lives in the app and not in either module
 *
 * It asks for `viewer` and `myPermissions` together, and no module may write
 * that query: `module-auth` and `module-permissions` do not import each other
 * (PLAN §9), so neither can name the other's field. Composing them is exactly
 * what the app is for. Each module still ships its own `/next` helper for an app
 * that wants them separately — this is the composed convenience, not a
 * replacement.
 *
 * ## What it replaces
 *
 * Two sequential REST calls in the shell — `GET /auth/profile` then
 * `GET /permissions/me` — each paying a full round trip before the next could
 * start. One GraphQL operation resolves both fields concurrently on the server.
 *
 * ## Deduplicated per request
 *
 * Wrapped in React's `cache()`, so the shell and the page it wraps share one
 * response instead of asking twice. The cache is per-render, not global — two
 * concurrent requests never see each other's session, which for this data is the
 * only acceptable behaviour.
 *
 * ## Three outcomes, not two
 *
 * "Nobody is signed in" and "I could not ask" are different facts, and this
 * used to return the same value for both. The consequence was specific and
 * bad: with the API down, `viewer` came back null, and AppShell's redirect sent
 * a perfectly well signed-in person to /auth/signin — where signing in also
 * failed, because the thing that was down was the thing sign-in needs. Nobody
 * ever saw the status bar, because nobody was ever left in a shell to see it.
 *
 * So `reachable` is carried separately. It is false only when the API could not
 * be reached at all; a 401, an empty body or an absent cookie are all reachable
 * answers meaning "not signed in".
 *
 * ## What it does NOT do
 *
 * It does not sign anyone in. Credential exchange stays on the REST endpoints
 * behind the Next route handler, which is the only thing that can turn a token
 * into an httpOnly cookie — and the only place where per-path rate limiting
 * still works. See AuthResolver for why moving sign-in onto the graph would
 * defeat that limit through field aliasing.
 */

const SESSION_QUERY = `
  query Session {
    viewer { id email username displayName }
    session { expiresAt }
    myPermissions {
      subjectId
      organizationId
      workspaceId
      effective
      granted
      entitled
      grantedAtAppLevel
      accessibleWorkspaceIds
      appRoles {
        key
        label
        icon
      }
    }
  }
`;

export interface SessionSnapshot {
  viewer: Viewer | null;
  permissions: PermissionContext | null;
  /**
   * Whether the API answered at all.
   *
   * Distinct from `viewer` being null, and the distinction is the point: a
   * caller must be able to tell "you are signed out" from "I cannot tell". The
   * first is grounds for a redirect; the second is grounds for a message.
   *
   * True when there is no cookie, because an absent cookie is an answer this
   * app already has — it is not a reason to claim the server is down.
   */
  reachable: boolean;
  /**
   * ISO-8601 access-token expiry, for <SessionKeeper> to schedule against.
   *
   * Converted from the epoch seconds the token carries, because a `Date` is what
   * the browser will do arithmetic on and doing it in one place beats doing it
   * at each call site.
   */
  expiresAt: string | null;
}

/** Signed out, having asked and been told so. */
const SIGNED_OUT: SessionSnapshot = { viewer: null, permissions: null, expiresAt: null, reachable: true };

/** Could not ask. Renders the shell with a status bar rather than a redirect. */
const UNREACHABLE: SessionSnapshot = { viewer: null, permissions: null, expiresAt: null, reachable: false };

/**
 * Null on every failure — no cookie, expired token, API down, malformed body —
 * with `reachable` separating the last two from the first two.
 *
 * **Both nulls FAIL CLOSED at the call site**: a null viewer means signed out, a
 * null permission context means "holds nothing", never "skip the filter". A
 * navigation that failed open would link someone to a page that turns them away,
 * and a permissions service being down is exactly when guessing generously costs
 * most. `reachable: false` does not soften that — it only stops the caller
 * mistaking an outage for a sign-out.
 *
 * A partial answer is honoured rather than discarded: GraphQL returns `data`
 * alongside `errors`, so a failure resolving permissions still yields a viewer,
 * and the shell renders a signed-in user with no privileged navigation — which
 * is the safe direction.
 */
export const getSessionSnapshot = cache(async (): Promise<SessionSnapshot> => {
  const token = await getSessionToken();
  // No cookie is a complete answer, arrived at without asking anyone. Reporting
  // it as unreachable would put "cannot reach the server" on the sign-in page
  // of a perfectly healthy deployment.
  if (!token) return SIGNED_OUT;

  const apiUrl = process.env.API_URL ?? 'http://localhost:8080/api/v1';

  try {
    const response = await fetch(`${apiUrl}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: SESSION_QUERY }),
      // Never cached: one viewer must not be served another's identity or grants
      // from a shared cache.
      cache: 'no-store',
    });
    /*
     * A 5xx is the API failing; a 4xx is the API answering. Only the first is
     * an outage — a 401 here means the token is no longer good, which is a
     * sign-out and should redirect like one.
     */
    if (!response.ok) return response.status >= 500 ? UNREACHABLE : SIGNED_OUT;

    const body = (await response.json()) as {
      data?: {
        viewer: Viewer | null;
        myPermissions: PermissionContext | null;
        session: { expiresAt: number } | null;
      };
    };

    const expiresAt = body.data?.session?.expiresAt;
    return {
      viewer: body.data?.viewer ?? null,
      permissions: body.data?.myPermissions ?? null,
      expiresAt: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
      reachable: true,
    };
  } catch {
    // Connection refused, DNS failure, a body that is not JSON. Nothing came
    // back, so nothing is known — least of all whether anyone is signed in.
    return UNREACHABLE;
  }
});
