/**
 * @kwtech/module-auth/next — the Next.js SERVER adapter.
 *
 * Three things an app would otherwise write for itself: the route handlers that
 * exchange credentials for httpOnly cookies, the server-side read of who is
 * signed in, and the sign-out that revokes as well as forgets.
 *
 * Separate from `/react` on purpose. That entrypoint is the browser half and
 * carries 'use client'; this one reads request cookies through `next/headers`,
 * which throws in a client component. Keeping them apart means the boundary is
 * enforced by the import path rather than by remembering.
 *
 * The route handlers use plain Web `Request`/`Response` rather than
 * `next/server` — see the note in ./cookies.ts for the runtime failure that
 * forced it, and the portability it bought back.
 *
 * It does NOT import `/server` (PLAN §9 rule 3, in spirit): this talks to the
 * API over HTTP exactly as the browser does, so the JWT secret and node:crypto
 * stay on the Nest side.
 *
 * Adopting it is one file:
 *
 *   // app/api/auth/[...action]/route.ts
 *   export { POST } from '@kwtech/module-auth/next';
 *
 * NAMED re-exports, never `export *` — see the note in ../react/index.ts.
 */
import { createAuthRouteHandlers } from './route-handlers.js';

export {
  type AuthNextConfig,
  DEFAULT_API_URL,
  DEFAULT_COOKIE_NAME,
  DEFAULT_SESSION_MAX_AGE,
  refreshCookieName,
} from './config.js';
export { type CookieAttributes, readCookie, serializeCookie } from './cookies.js';
export { type RenewalDecision, renewSessionIfNeeded } from './renew.js';
export { createAuthRouteHandlers } from './route-handlers.js';
export { getSessionToken, getViewer } from './session.js';

/**
 * The zero-configuration handler, for the re-export above.
 *
 * Built once at import; `resolveConfig` still runs per request inside it, so
 * this reads the environment at request time rather than at build time.
 * Apps needing different cookie names or a non-environment source call
 * `createAuthRouteHandlers({ ... })` and export that instead.
 */
export const { POST } = createAuthRouteHandlers();
