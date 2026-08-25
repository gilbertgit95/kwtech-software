import { DEFAULT_PALETTE, isPalette, PALETTES } from './palettes.js';

/**
 * Applying and persisting the chosen palette — the half of a palette picker
 * that is easy to get subtly wrong, kept here so each app does not re-derive it
 * from the README.
 *
 * Deliberately HEADLESS: no JSX, no icon set, no dropdown library, and no
 * dependency on how the app renders a menu. That is what lets this package stay
 * dependency-free while still owning the behaviour. The presentation — which
 * control, which icons, where it sits — belongs to the app until a second one
 * genuinely shares it.
 *
 * Safe to import from a Server Component: nothing here runs at module scope,
 * and the two browser functions guard on `document` themselves.
 */

/** The attribute the stylesheets key off. One source, so a rename cannot half-land. */
export const PALETTE_ATTRIBUTE = 'data-palette';

/**
 * localStorage, not a cookie — because the light/dark mode cannot be a cookie
 * (its `system` value resolves to `prefers-color-scheme`, which only the
 * browser knows), and splitting one theme setting across two mechanisms is
 * worse than the cost documented in `palettePreloadScript`.
 */
export const PALETTE_STORAGE_KEY = 'kwtech_palette';

/**
 * The stored palette, or null when there is none, it is unreadable, or it is
 * not a palette this package ships.
 *
 * Validated rather than trusted: the value becomes an attribute selector, and
 * an edited one would match no rules and render the page with no palette at
 * all. Reading throws outright in Safari's private mode and wherever site data
 * is blocked, so that is caught too.
 */
export function readStoredPalette(): string | null {
  try {
    const stored = localStorage.getItem(PALETTE_STORAGE_KEY);
    return isPalette(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Switches the palette now and remembers it.
 *
 * The attribute IS the switch: every palette is already in the stylesheet,
 * scoped to its own selector, so this repaints instantly with no reload and no
 * React re-render. Nothing below the calling component even knows it happened,
 * which is why this returns void rather than something to thread through state.
 *
 * Storage failure is ignored on purpose — the choice still applies for this
 * visit, and a colour preference is not worth taking the page down for.
 *
 * @returns false when `id` is not a known palette, so a caller can tell a
 * mistake from a success instead of silently doing nothing.
 */
export function applyPalette(id: string): boolean {
  if (!isPalette(id) || typeof document === 'undefined') return false;

  document.documentElement.setAttribute(PALETTE_ATTRIBUTE, id);
  try {
    localStorage.setItem(PALETTE_STORAGE_KEY, id);
  } catch {
    // No storage available; the in-memory choice stands for this visit.
  }
  return true;
}

/**
 * The script that applies the stored palette BEFORE the first paint.
 *
 * ── why an app cannot skip this ─────────────────────────────────────────────
 *
 * localStorage is unreadable on the server, and NOTHING in these stylesheets
 * applies without the palette attribute. So a server-rendered page carries
 * whichever palette the app hard-codes, and without this the viewer's actual
 * choice arrives only after hydration — every colour on screen changing at
 * once, on every load.
 *
 * It must be INLINE and it must not be deferred: an external or `defer`red
 * script runs after the browser has already painted, which is precisely too
 * late. Put the output in a `<script>` as early in `<body>` as possible.
 *
 * Pair it with a server-rendered fallback — see the README — so a visitor with
 * JavaScript disabled gets a styled page rather than a blank design.
 *
 * The valid list is BAKED IN rather than imported, because this runs before any
 * bundle has loaded; generating it from PALETTES is what stops the two
 * disagreeing about which palettes exist.
 *
 * Contains no interpolated user input — every value is a build-time constant
 * from this package — so it is safe to inject with `dangerouslySetInnerHTML`.
 */
export function palettePreloadScript(): string {
  const key = JSON.stringify(PALETTE_STORAGE_KEY);
  const ids = JSON.stringify(PALETTES.map((palette) => palette.id));
  const attribute = JSON.stringify(PALETTE_ATTRIBUTE);
  return `try{var p=localStorage.getItem(${key});if(${ids}.indexOf(p)>-1)document.documentElement.setAttribute(${attribute},p)}catch(e){}`;
}

export { DEFAULT_PALETTE };
