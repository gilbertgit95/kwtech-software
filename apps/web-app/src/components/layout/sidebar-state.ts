import { SIDEBAR_COOKIE, writePreferenceCookie } from '@/lib/preferences';

/**
 * The side drawer's collapsed state.
 *
 * A cookie rather than localStorage because the shell is a Server Component: it
 * reads this during the render that produces the drawer, so the drawer arrives
 * at the right width. localStorage is only readable after hydration, which
 * means every page load would paint the drawer expanded and then snap it shut —
 * small once, and on every navigation exactly the kind of thing that makes an
 * app feel cheap. See lib/preferences.ts for why the theme settings differ.
 */
export { SIDEBAR_COOKIE } from '@/lib/preferences';

export function isCollapsedValue(value: string | undefined): boolean {
  return value === '1';
}

export function writeSidebarCookie(collapsed: boolean): void {
  writePreferenceCookie(SIDEBAR_COOKIE, collapsed ? '1' : '0');
}
