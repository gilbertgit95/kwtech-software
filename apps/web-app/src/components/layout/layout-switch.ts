'use client';

import { type LayoutPreference, MOBILE_PAGE_PREFIX, mobileRewritePath } from '@/lib/layout-choice';
import { LAYOUT_COOKIE, writePreferenceCookie } from '@/lib/preferences';

/**
 * Switches this browser to the full site or the phone layout, and reloads
 * into it (issue #22).
 *
 * A full load, not a client navigation: the PROXY picks the layout, and it
 * runs on a request — a router refresh could be answered from what is already
 * on screen.
 *
 * Where it lands, so the switch is never a reload that seems to do nothing:
 *   - to the full site: the same place, with the phone page's own prefix
 *     dropped when it was opened directly (`/mobile/...`);
 *   - to the phone layout: the same place when the phone layout has it, and
 *     `/` otherwise — an account settings page stays desktop by design, and
 *     reloading it would show the same desktop page.
 */
export function switchLayout(preference: LayoutPreference): void {
  writePreferenceCookie(LAYOUT_COOKIE, preference);

  const { pathname, search } = window.location;
  const onPhonePage = pathname === MOBILE_PAGE_PREFIX || pathname.startsWith(`${MOBILE_PAGE_PREFIX}/`);
  const here = onPhonePage ? pathname.slice(MOBILE_PAGE_PREFIX.length) || '/' : pathname;
  const target = preference === 'mobile' && !mobileRewritePath(here) ? '/' : `${here}${search}`;
  window.location.assign(target);
}
