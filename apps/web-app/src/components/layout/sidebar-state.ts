import { SIDEBAR_COOKIE, SIDEBAR_WIDTH_COOKIE, writePreferenceCookie } from '@/lib/preferences';

/**
 * The side drawer's collapsed state and expanded width.
 *
 * Cookies rather than localStorage because the shell is a Server Component: it
 * reads these during the render that produces the drawer, so the drawer arrives
 * at the right width. localStorage is only readable after hydration, which
 * means every page load would paint the drawer expanded and then snap it shut —
 * small once, and on every navigation exactly the kind of thing that makes an
 * app feel cheap. See lib/preferences.ts for why the theme settings differ.
 */
export { SIDEBAR_COOKIE, SIDEBAR_WIDTH_COOKIE } from '@/lib/preferences';

export function isCollapsedValue(value: string | undefined): boolean {
  return value === '1';
}

export function writeSidebarCookie(collapsed: boolean): void {
  writePreferenceCookie(SIDEBAR_COOKIE, collapsed ? '1' : '0');
}

/**
 * The bounds of the expanded drawer, in pixels.
 *
 * The default is the 14rem the drawer always had. The minimum is where the
 * switchers' names and a section heading still fit beside their icons; below
 * it the drawer is a worse version of the collapsed one, which already exists.
 * The maximum keeps the page, not the navigation, the widest thing on screen.
 */
export const SIDEBAR_WIDTH = { min: 192, default: 224, max: 420 } as const;

export function clampSidebarWidth(width: number): number {
  return Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)));
}

/**
 * The cookie's value as a usable width. Anything unreadable is the default —
 * the cookie is written by the browser and can hold anything at all — and a
 * number out of range is clamped rather than refused, so tightening the bounds
 * later moves a stored width inside them instead of discarding it.
 */
export function parseSidebarWidth(value: string | undefined): number {
  const width = Number(value);
  if (value === undefined || value === '' || !Number.isFinite(width)) return SIDEBAR_WIDTH.default;
  return clampSidebarWidth(width);
}

export function writeSidebarWidthCookie(width: number): void {
  writePreferenceCookie(SIDEBAR_WIDTH_COOKIE, String(clampSidebarWidth(width)));
}
