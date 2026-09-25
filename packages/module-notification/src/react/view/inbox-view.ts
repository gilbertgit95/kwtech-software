import { isNotificationOrder, NOTIFICATION_PAGE_DEFAULT, type NotificationOrder } from '../../domain/ordering.js';
import { isNotificationSeverity } from '../../types.js';

/**
 * The inbox page's pure rules: its state in the URL, the pager's sentence, the
 * day headings, and how a live event lands on page 1.
 */

export type InboxTab = 'all' | 'unread' | 'archived';

/** The page sizes offered. The server clamps anything else to its own range. */
export const INBOX_PAGE_SIZES = [20, 50, 100] as const;

export interface InboxState {
  tab: InboxTab;
  order: NotificationOrder;
  severity: string | null;
  source: string | null;
  /** An organization id, `'global'`, or null for everywhere. */
  from: string | null;
  size: number;
  /** 1-based, as walked. Only the pager's sentence uses it. */
  page: number;
  after: string | null;
  before: string | null;
}

export const DEFAULT_INBOX_STATE: InboxState = {
  tab: 'all',
  order: 'unread_first',
  severity: null,
  source: null,
  from: null,
  size: NOTIFICATION_PAGE_DEFAULT,
  page: 1,
  after: null,
  before: null,
};

/**
 * The state a URL describes. Anything unrecognised falls back to its default,
 * so a hand-edited or stale link opens the inbox rather than an error.
 *
 * ⚠ The state lives in the URL so Back and a shared link restore the page — a
 * person who opened a notification and pressed Back lands where they were.
 */
export function parseInboxState(search: string): InboxState {
  const params = new URLSearchParams(search);
  const tab = params.get('tab');
  const order = params.get('order');
  const severity = params.get('severity');
  const size = Number(params.get('size'));
  const page = Number(params.get('page'));
  const after = params.get('after');
  const before = params.get('before');
  return {
    tab: tab === 'unread' || tab === 'archived' ? tab : 'all',
    order: isNotificationOrder(order) ? order : 'unread_first',
    severity: isNotificationSeverity(severity) ? severity : null,
    source: params.get('source') || null,
    from: params.get('from') || null,
    size: (INBOX_PAGE_SIZES as readonly number[]).includes(size) ? size : NOTIFICATION_PAGE_DEFAULT,
    page: Number.isInteger(page) && page > 1 ? page : 1,
    // Both present is a malformed link; `after` wins and `before` is dropped.
    after: after || null,
    before: after ? null : before || null,
  };
}

/** The query string for a state — defaults left out, so a plain inbox is a plain URL. */
export function serializeInboxState(state: InboxState): string {
  const params = new URLSearchParams();
  if (state.tab !== 'all') params.set('tab', state.tab);
  if (state.order !== 'unread_first') params.set('order', state.order);
  if (state.severity) params.set('severity', state.severity);
  if (state.source) params.set('source', state.source);
  if (state.from) params.set('from', state.from);
  if (state.size !== NOTIFICATION_PAGE_DEFAULT) params.set('size', String(state.size));
  if (state.page > 1) params.set('page', String(state.page));
  if (state.after) params.set('after', state.after);
  if (state.before) params.set('before', state.before);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * A filter changed: back to page 1. A cursor from the old filter points into a
 * list that no longer exists, and the server would refuse it or start over.
 */
export function withFilter(
  state: InboxState,
  change: Partial<Omit<InboxState, 'page' | 'after' | 'before'>>,
): InboxState {
  return { ...state, ...change, page: 1, after: null, before: null };
}

/** The list request a state makes. */
export function inboxRequest(state: InboxState): {
  first: number;
  order: NotificationOrder;
  unreadOnly: boolean;
  archived: boolean;
  after: string | null;
  before: string | null;
  severity: string | null;
  source: string | null;
  organizationId: string | null;
  globalOnly: boolean;
} {
  return {
    first: state.size,
    order: state.order,
    unreadOnly: state.tab === 'unread',
    archived: state.tab === 'archived',
    after: state.after,
    before: state.before,
    severity: state.severity,
    source: state.source,
    organizationId: state.from && state.from !== 'global' ? state.from : null,
    globalOnly: state.from === 'global',
  };
}

/**
 * "41–60 of 1,284". The range comes from the page number walked and the rows on
 * screen, which is what a keyset can know without counting offsets.
 */
export function pagerLabel(page: number, size: number, shown: number, total: number): string {
  if (total === 0 || shown === 0) return 'No notifications';
  const first = (page - 1) * size + 1;
  const last = first + shown - 1;
  const format = (value: number) => value.toLocaleString('en-US');
  return `${format(first)}–${format(last)} of ${format(total)}`;
}

/** The heading a day's notifications sit under. */
export function dayLabel(iso: string, now: Date): string {
  const date = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (day === startOfToday) return 'Today';
  if (day === startOfToday - 86_400_000) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/**
 * Items under day headings, in the order given.
 *
 * ⚠ In the unread-first order a day can appear twice — once among the unread,
 * once among the read. That is kept rather than merged: merging would pull a
 * read item up among the unread and undo the order the person asked for.
 */
export function groupByDay<T extends { occurredAt: string }>(
  items: readonly T[],
  now: Date,
): Array<{ label: string; items: T[] }> {
  const groups: Array<{ label: string; items: T[] }> = [];
  for (const item of items) {
    const label = dayLabel(item.occurredAt, now);
    const last = groups.at(-1);
    if (last && last.label === label) {
      last.items.push(item);
      continue;
    }
    groups.push({ label, items: [item] });
  }
  return groups;
}

/** "just now", "5 min ago", "3 h ago", then the clock or the date. */
export function relativeTime(iso: string, now: Date): string {
  const then = new Date(iso);
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24 && then.getDate() === now.getDate()) return `${hours} h ago`;
  if (hours < 48) return then.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * A live notification on the page the person is looking at.
 *
 * `created` goes on top; `grouped` replaces its row and moves it to the top,
 * because a group that grew is news. Anything already on screen is replaced,
 * never duplicated.
 */
export function mergeLive<T extends { id: string }>(items: readonly T[], incoming: T): T[] {
  return [incoming, ...items.filter((item) => item.id !== incoming.id)];
}

/** The newest `occurredAt` in a list, or null. What "mark all read" and the reconnect catch-up are bounded by. */
export function newestOccurredAt(items: readonly { occurredAt: string }[]): string | null {
  let newest: string | null = null;
  for (const item of items) {
    if (newest === null || item.occurredAt > newest) newest = item.occurredAt;
  }
  return newest;
}

/** The organizations seen in a list, for the "where from" filter — labelled as they were when sent. */
export function organizationsIn(
  items: readonly { organizationId: string | null; contextLabel: string | null }[],
): Array<{ id: string; label: string }> {
  const seen = new Map<string, string>();
  for (const item of items) {
    if (!item.organizationId || seen.has(item.organizationId)) continue;
    // The label is "Org · Workspace" for a workspace item; the part before the
    // separator names the organization.
    const label = item.contextLabel?.split(' · ')[0]?.trim() || 'An organization';
    seen.set(item.organizationId, label);
  }
  return [...seen].map(([id, label]) => ({ id, label }));
}

/** How many filters narrow the list — what "Clear filters" would undo. The tab and order are not filters. */
export function activeFilterCount(state: InboxState): number {
  return [state.severity, state.source, state.from].filter((value) => value !== null).length;
}

/** The empty state's words, for what the person is looking at. */
export function emptyInboxCopy(state: InboxState): { title: string; body: string } {
  if (activeFilterCount(state) > 0) {
    return { title: 'Nothing matches these filters', body: 'Try another type or source, or clear the filters.' };
  }
  switch (state.tab) {
    case 'unread':
      return { title: 'You’re all caught up', body: 'Every notification has been read.' };
    case 'archived':
      return { title: 'Nothing archived', body: 'Notifications you archive are kept here.' };
    case 'all':
      return {
        title: 'No notifications yet',
        body: 'When something happens that you should know about, it appears here.',
      };
  }
}

/** A body long enough to fold behind "Show more". */
export const INBOX_BODY_FOLD = 220;

export function isLongBody(body: string | null): boolean {
  return body !== null && (body.length > INBOX_BODY_FOLD || body.split('\n').length > 3);
}
