/**
 * How an unread count is shown: on the bell, and in the tab's title.
 *
 * One function for both, so the bell and the title can never disagree about
 * whether it is "99+" or "100".
 */

/** Past this the digits stop helping; the badge says "99+". */
export const NOTIFICATION_BADGE_CEILING = 99;

/** The badge's text, or null when there is nothing to show. */
export function badgeText(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > NOTIFICATION_BADGE_CEILING ? `${NOTIFICATION_BADGE_CEILING}+` : String(Math.trunc(count));
}

/** What a screen reader hears for the bell — the whole number, never "99+". */
export function bellLabel(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return 'Notifications';
  const whole = Math.trunc(count);
  return `Notifications, ${whole} unread`;
}

/** The prefix this module puts on a tab title: `(3) `. */
const TITLE_PREFIX = /^\(\d+\+?\)\s/;

/**
 * The tab title for `count` unread, given whatever the title currently is.
 *
 * ⚠ It STRIPS its own prefix before adding one, so re-applying after every
 * route change and every count change never stacks into `(2) (3) kwtech`.
 */
export function tabTitle(current: string, count: number): string {
  const base = stripTabTitle(current);
  const text = badgeText(count);
  return text ? `(${text}) ${base}` : base;
}

/** The title without this module's prefix. */
export function stripTabTitle(current: string): string {
  return current.replace(TITLE_PREFIX, '');
}
