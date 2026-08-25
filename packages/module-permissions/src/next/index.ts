/**
 * @kwtech/module-permissions/next — the Next.js SERVER adapter.
 *
 * One job: fetch the caller's permission context so the app can mount
 * `<PermissionsProvider>` and filter navigation with the same keys the pages
 * check.
 *
 * ── the web-side seam ──────────────────────────────────────────────────────
 *
 * It takes a TOKEN rather than reading a cookie. This module does not know how
 * the app authenticates, must not import `module-auth` (PLAN §9), and would be
 * guessing if it picked a cookie name. The app reads the token from whatever
 * owns identity — `getSessionToken()` in module-auth's Next adapter — and hands
 * it here. That is the same one-directional seam as
 * `apps/web-server/src/auth/resolve-principal.ts`, in the same shape, for the
 * same reason: either half can be replaced without touching the other.
 */
import type { PermissionContext } from '../types.js';

export const DEFAULT_API_URL = 'http://localhost:8080/api/v1';

export interface PermissionsNextConfig {
  /** Where the API lives, including its prefix. Defaults to `API_URL`. */
  apiUrl?: string;
  /** The caller's access token. Null when signed out — the call is then skipped. */
  token: string | null;
}

/**
 * Null on every failure — no token, non-2xx, unreachable API, empty body.
 *
 * **Null must FAIL CLOSED at the call site**: treat it as "holds nothing", not
 * as "skip the filter". A navigation that fails open would link a user to a
 * page that turns them away, which is the exact mismatch one shared key exists
 * to prevent — and a permissions service being down is precisely when guessing
 * generously is most expensive.
 *
 * `/permissions/me` requires no feature of its own: asking what you hold is not
 * itself a privilege, and gating it would deadlock the first render.
 */
export async function getPermissionContext({
  apiUrl,
  token,
}: PermissionsNextConfig): Promise<PermissionContext | null> {
  if (!token) return null;

  const base = apiUrl ?? process.env.API_URL ?? DEFAULT_API_URL;

  try {
    const response = await fetch(`${base}/permissions/me`, {
      headers: { authorization: `Bearer ${token}` },
      // Never cached: one viewer must not be served another's grants.
      cache: 'no-store',
    });
    if (!response.ok) return null;
    // A caller with no membership gets 200 with an empty body, which is not
    // JSON — so this parses defensively rather than letting it throw.
    const text = await response.text();
    return text ? ((JSON.parse(text) as PermissionContext | null) ?? null) : null;
  } catch {
    return null;
  }
}
