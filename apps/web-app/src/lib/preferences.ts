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

/** A year. A preference should outlive the session that set it. */
export const PREFERENCE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Neither cookie is httpOnly and neither is a secret: they are UI preferences,
 * and the client half has to be able to write them.
 */
export function writePreferenceCookie(name: string, value: string): void {
  if (typeof document === 'undefined') return;

  // biome-ignore lint/suspicious/noDocumentCookie: the suggested Cookie Store API is Chromium-only — neither Safari nor Firefox ships it, and a UI preference is not worth a polyfill.
  document.cookie = `${name}=${value}; path=/; max-age=${PREFERENCE_MAX_AGE_SECONDS}; samesite=lax`;
}
