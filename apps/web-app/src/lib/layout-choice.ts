/**
 * Which layout a request gets: the desktop shell, or the phone layout (issue #22).
 *
 * Decided ONCE, in `proxy.ts`, before anything renders. A phone's request for
 * a page in the allowlist below is REWRITTEN to the phone page under
 * `MOBILE_PAGE_PREFIX`: the address in the browser stays the one that was
 * asked for, so a notification's link, a bookmark and the installed app's
 * `start_url` mean the same place on every device.
 *
 * The alternative — a `/m` section with addresses of its own — was rejected
 * (PLAN §13, 2026-10-29): every link would need a phone twin, and a desktop
 * link opened on a phone would land on the desktop page.
 *
 * Plain functions over plain values, with no Next import, so the proxy, the
 * shells and anything that tests them read the same rules.
 */

export type LayoutChoice = 'desktop' | 'mobile';

/** What a person asked for, from `LAYOUT_COOKIE`. Null: decide by the device. */
export type LayoutPreference = 'mobile' | 'full';

/**
 * Where the phone page lives. Never shown: the proxy rewrites to it. Opening
 * it directly shows the phone layout on any device, which is how it is looked
 * at from a computer.
 */
export const MOBILE_PAGE_PREFIX = '/mobile';

/** The cookie's value, or null for anything else — a forged or stale value decides nothing. */
export function parseLayoutPreference(value: string | undefined): LayoutPreference | null {
  if (value === 'mobile' || value === 'full') return value;
  return null;
}

/**
 * A PHONE is `device.type === 'mobile'` from Next's `userAgent()`.
 *
 * ⚠ A PHONE ALWAYS GETS THE PHONE LAYOUT, whatever the cookie says (the
 * operator, 2026-10-29). The full site is built for a mouse and a wide
 * screen, and a seller who wandered onto it on a phone had no good way back;
 * the cookie's `full` is therefore ignored on a phone, including one left
 * from before this rule. See `canUseFullSite`.
 *
 * Everything else — computers and tablets — follows the cookie, and without
 * one gets the desktop shell. Tablets are left there by default: the screen
 * fits it, and a tablet at a counter can use every section of the point of
 * sale. An iPad says it is a Mac anyway (Safari's default since iPadOS 13).
 */
export function chooseLayout(deviceType: string | undefined, preference: LayoutPreference | null): LayoutChoice {
  if (!canUseFullSite(deviceType)) return 'mobile';
  if (preference === 'mobile') return 'mobile';
  return 'desktop';
}

/**
 * Whether this device may open the full site at all: anything but a phone.
 * The phone layout hides "Use full site" and every "Open full site" button
 * where this is false, and the desktop shell refuses to draw itself there.
 */
export function canUseFullSite(deviceType: string | undefined): boolean {
  return deviceType !== 'mobile';
}

/**
 * Whether the desktop shell offers "Use mobile view": on a tablet, or for
 * somebody who switched to the full site and may want to come back. Not on a
 * computer that never asked, where it is one more line in a menu for
 * something nobody there needs. (A phone never sees the desktop shell.)
 */
export function offersMobileView(deviceType: string | undefined, preference: LayoutPreference | null): boolean {
  return preference === 'full' || deviceType === 'tablet';
}

/**
 * The phone page a path is rewritten to, or null to leave it alone.
 *
 * ⚠ AN ALLOWLIST, and it fails closed: only the signed-in pages a person works
 * in — `/` and a tenant's own pages. Everything else is untouched, and that is
 * most of the app on purpose:
 *
 *   /auth/*         sign-in, two-step and reset are already one narrow column;
 *                   one copy of the credential pages, for every device.
 *   /api/*          route handlers, not pages.
 *   /install, /invitations/*, /queue-display/*, /book/*, /my-booking/*
 *                   public pages, each already its own full-screen frame.
 *   /settings/*, /admin/*
 *                   single-column account forms, and administration.
 *
 * A page added later is therefore never sent to the phone page by accident; a
 * denylist would have needed somebody to remember it.
 */
export function mobileRewritePath(pathname: string): string | null {
  if (pathname === '/') return MOBILE_PAGE_PREFIX;
  if (pathname.startsWith('/organizations/')) return `${MOBILE_PAGE_PREFIX}${pathname}`;
  return null;
}
