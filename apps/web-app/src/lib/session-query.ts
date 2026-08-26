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
    }
  }
`;

export interface SessionSnapshot {
  viewer: Viewer | null;
  permissions: PermissionContext | null;
  /**
   * ISO-8601 access-token expiry, for <SessionKeeper> to schedule against.
   *
   * Converted from the epoch seconds the token carries, because a `Date` is what
   * the browser will do arithmetic on and doing it in one place beats doing it
   * at each call site.
   */
  expiresAt: string | null;
}

/** Signed out, or the API is unreachable. Both render the same way. */
const EMPTY: SessionSnapshot = { viewer: null, permissions: null, expiresAt: null };

/**
 * Null on every failure — no cookie, expired token, API down, malformed body.
 *
 * **Both nulls FAIL CLOSED at the call site**: a null viewer means signed out, a
 * null permission context means "holds nothing", never "skip the filter". A
 * navigation that failed open would link someone to a page that turns them away,
 * and a permissions service being down is exactly when guessing generously costs
 * most.
 *
 * A partial answer is honoured rather than discarded: GraphQL returns `data`
 * alongside `errors`, so a failure resolving permissions still yields a viewer,
 * and the shell renders a signed-in user with no privileged navigation — which
 * is the safe direction.
 */
export const getSessionSnapshot = cache(async (): Promise<SessionSnapshot> => {
  const token = await getSessionToken();
  if (!token) return EMPTY;

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
    if (!response.ok) return EMPTY;

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
    };
  } catch {
    return EMPTY;
  }
});
