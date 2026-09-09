/**
 * Every per-viewer preference this app stores, and where each one lives.
 *
 * ── the naming rule ─────────────────────────────────────────────────────────
 *
 * All three are prefixed `kwtech_`. localStorage is scoped per origin and
 * cookies per domain, so on a machine running several of these apps at once —
 * which `pnpm dev` does by design — an unprefixed `theme` is one app silently
 * reading another's preference. The prefix is also what makes these greppable:
 * searching `kwtech_` finds everything this app persists.
 *
 * They are collected here rather than declared next to their readers because
 * "uniform" is a property of the SET, and a set spread over three files drifts
 * the first time someone adds a fourth key without reading the other three.
 *
 * ── the two THEME preferences share localStorage ────────────────────────────
 *
 * `next-themes` owns the light/dark mode and stores it in localStorage; it has
 * no cookie option, and one of its values is `system`, which only the browser
 * can resolve. The palette follows it there so the theme configuration is one
 * mechanism rather than two. See @kwtech/web-ui's README for the two things an
 * app must do as a result — a server-rendered fallback and a pre-paint script —
 * and layout.tsx for this app doing them.
 *
 * The sidebar stays a COOKIE. It is not theme configuration, it has no `system`
 * equivalent, and the shell is a Server Component that can render the drawer at
 * its stored width with no script at all — there is nothing to gain by moving
 * it and a render-blocking script to lose.
 */

/*
 * The palette's key, reader, writer and pre-paint script live in
 * `@kwtech/web-ui` alongside the palettes themselves — applying one correctly
 * is the part that is easy to get wrong, so the package that defines them owns
 * it rather than each app rediscovering it:
 *
 *   import { applyPalette, palettePreloadScript, PALETTE_STORAGE_KEY } from '@kwtech/web-ui';
 *
 * Its key is `kwtech_palette`, which is why the prefix rule above is worth
 * stating here even though this file no longer declares it.
 */

/**
 * localStorage, written by next-themes. Passed as its `storageKey`; left unset
 * it defaults to a bare `theme`, which two of these apps on one machine share.
 */
export const THEME_STORAGE_KEY = 'kwtech_theme';

/** Cookie. Read by AppShell so the drawer renders at the right width. */
export const SIDEBAR_COOKIE = 'kwtech_sidebar_collapsed';

/**
 * Cookie. The organization the switcher has selected.
 *
 * A COOKIE for the same reason the sidebar's width is one, and the reason is
 * sharper here: the shell is a Server Component and this decides which drawer
 * SECTION exists. Read after hydration, every page outside an organization
 * would paint without the tenant section and then grow one — a whole block of
 * navigation appearing a beat late, on every navigation.
 *
 * ⚠ **NOT AUTHORISATION, and nothing may treat it as such.** It is a UI
 * preference the browser can write to anything at all. Everything it reaches is
 * still resolved server-side against the viewer's real grants IN that
 * organization, and `AppShell` refuses an id that is not in the viewer's own
 * list before it is used for anything. A forged value gets you a drawer of
 * links the API then refuses one by one — which is the same answer typing the
 * URLs would give.
 *
 * A preference rather than session state, so it survives a reload and a browser
 * restart the way the collapsed drawer does: coming back to the organization
 * you were last working in is what people expect from a tenant switcher.
 *
 * ⚠ **It does NOT survive a sign-out.** This and the workspace cookie are
 * cleared by `app/api/auth/[...action]/route.ts`, which is the one place that
 * may know about both modules — see that file. Unlike the sidebar width and the
 * theme, these name a CUSTOMER, and leaving one behind on a shared machine
 * after somebody signed out is the kind of residue nobody expects. A session
 * RENEWAL leaves them alone, which is the distinction that matters: renewing is
 * not ending.
 */
export const ACTIVE_ORGANIZATION_COOKIE = 'kwtech_active_organization';

/**
 * Cookie. The workspace the switcher has selected, INSIDE that organization.
 *
 * ⚠ It is deliberately NOT cleared when the organization changes, and does not
 * need to be. It is validated against the workspaces of the SELECTED
 * organization that the viewer may enter, and a workspace of some other tenant
 * is not in that list — so switching organization drops the selection by
 * arithmetic rather than by a cleanup step somebody has to remember. The same
 * check also drops one the viewer has been removed from, or that has since been
 * archived.
 *
 * Not authorisation, for the reasons `ACTIVE_ORGANIZATION_COOKIE` gives, and
 * one more: the list it is validated against IS the viewer's
 * `accessibleWorkspaceIds`, so a forged value can only ever name somewhere they
 * could already go.
 */
export const ACTIVE_WORKSPACE_COOKIE = 'kwtech_active_workspace';

/** A year. A preference should outlive the session that set it. */
export const PREFERENCE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * None of these cookies is httpOnly and none is a secret: they are UI
 * preferences, and the client half has to be able to write them. See
 * `ACTIVE_ORGANIZATION_COOKIE` for what that means for the one that names a
 * tenant — nothing, because it is validated and re-authorised server-side.
 */
export function writePreferenceCookie(name: string, value: string): void {
  if (typeof document === 'undefined') return;

  // biome-ignore lint/suspicious/noDocumentCookie: the suggested Cookie Store API is Chromium-only — neither Safari nor Firefox ships it, and a UI preference is not worth a polyfill.
  document.cookie = `${name}=${value}; path=/; max-age=${PREFERENCE_MAX_AGE_SECONDS}; samesite=lax`;
}

/**
 * A `Set-Cookie` value that DELETES one of these, for a server response.
 *
 * ⚠ It repeats the attributes the cookie was written with, and that is the
 * whole reason it lives here rather than beside its caller: a browser keys a
 * cookie on name + domain + PATH, so a deletion sent with a different `Path`
 * creates and immediately expires a second, unrelated cookie and leaves the
 * original in place. Written next to `writePreferenceCookie` so the two cannot
 * drift — module-auth's sign-out carries the same warning about its own
 * cookies, which is where this pattern comes from.
 *
 * `Max-Age=0` is the deletion. `HttpOnly` is deliberately absent, matching the
 * write: these are preferences the client half sets itself.
 */
export function expiredPreferenceCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}
