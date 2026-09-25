import type { NotificationSeverity, NotificationSource } from '../types.js';

/**
 * Grouping: "5 people joined Front desk" as one row, not five.
 *
 * The fold itself happens in the sender, inside a transaction: an UNREAD,
 * unarchived, unrecalled row for the same person with the same key absorbs the
 * next one. What is decided here is the title and the overflow group.
 *
 * ⚠ Once read, a group closes. Someone who read "5 people joined" and then saw
 * "6 people joined" would read that as one new person or six, and neither is
 * right — so the next one starts a fresh row.
 */

export const NOTIFICATION_GROUP_KEY_MAX = 128;

/** The placeholder a group title may contain. */
export const GROUP_COUNT_PLACEHOLDER = '{count}';

/**
 * A group's title for `count` members.
 *
 * ⚠ A group of ONE shows the notification's own title, never the template: "1
 * people joined" is a sentence no one should have to read, and the first event
 * of a group is just an event.
 */
export function renderGroupTitle(template: string, count: number, singleTitle: string): string {
  if (count <= 1) return singleTitle;
  return template.replaceAll(GROUP_COUNT_PLACEHOLDER, String(count));
}

/**
 * Where a flooding source's surplus goes — see `domain/flood.ts`. One group per
 * source per person, titled so it says what is happening without pretending to
 * know what each hidden item was.
 */
export function overflowGroup(source: Pick<NotificationSource, 'key' | 'label'>): { key: string; title: string } {
  return {
    key: `overflow:${source.key}`.slice(0, NOTIFICATION_GROUP_KEY_MAX),
    title: `${GROUP_COUNT_PLACEHOLDER} more notifications from ${source.label}`,
  };
}

const LOUDNESS: Record<NotificationSeverity, number> = { info: 0, success: 1, warning: 2, alert: 3 };

/**
 * A group is as loud as its loudest member.
 *
 * ⚠ The case this exists for is the OVERFLOW group: a flooding source that
 * sends one alert among twenty infos must not have that alert folded into a
 * quiet row. The alert keeps its sticky toast and its assertive announcement.
 */
export function louderSeverity(a: NotificationSeverity, b: NotificationSeverity): NotificationSeverity {
  return LOUDNESS[b] > LOUDNESS[a] ? b : a;
}
