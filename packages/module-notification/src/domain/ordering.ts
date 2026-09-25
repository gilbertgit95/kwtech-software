/**
 * The inbox's order and its cursor.
 *
 * ## Unread first, by default
 *
 * `unread_first` is two ordered RUNS — every unread item, then every read one —
 * each newest first by `(occurredAt desc, id desc)`. `newest` is one run, a
 * strict timeline, for somebody looking for "what happened on Tuesday".
 *
 * ## Keyset, never offset
 *
 * New notifications arrive at the top while somebody is on page 3. With OFFSET
 * every arrival shifts every page by one, so a row is shown twice or skipped. A
 * cursor pins the position to a ROW instead. It carries the run it points into,
 * so a page that crosses from unread to read continues in the right place, and
 * both directions work — Next and Previous, not just "load more".
 */

export type NotificationOrder = 'unread_first' | 'newest';
export type NotificationRun = 'unread' | 'read' | 'all';

export const NOTIFICATION_ORDERS: readonly NotificationOrder[] = ['unread_first', 'newest'];

/** Page size when the client says nothing. */
export const NOTIFICATION_PAGE_DEFAULT = 20;
/**
 * The largest page. ⚠ The same number as the bulk cap, so "select all on this
 * page" is always exactly one bulk call.
 */
export const NOTIFICATION_PAGE_MAX = 100;

export function isNotificationOrder(value: unknown): value is NotificationOrder {
  return typeof value === 'string' && (NOTIFICATION_ORDERS as readonly string[]).includes(value);
}

/** A page size in range: absent means the default, anything else is clamped. */
export function clampPageSize(requested: number | null | undefined): number {
  if (requested === null || requested === undefined || !Number.isFinite(requested)) return NOTIFICATION_PAGE_DEFAULT;
  return Math.min(NOTIFICATION_PAGE_MAX, Math.max(1, Math.trunc(requested)));
}

export interface NotificationCursor {
  run: NotificationRun;
  occurredAt: Date;
  id: string;
}

/**
 * The runs a listing walks, in order.
 *
 * ⚠ `unreadOnly` is ONE run whatever the order: the read run would contribute
 * nothing, and walking it would cost a query per page.
 */
export function runsFor(order: NotificationOrder, unreadOnly: boolean): readonly NotificationRun[] {
  if (unreadOnly) return ['unread'];
  return order === 'unread_first' ? ['unread', 'read'] : ['all'];
}

/** Which run a row belongs to, for `order`. Where its cursor points. */
export function runOf(row: { readAt: Date | null }, order: NotificationOrder, unreadOnly: boolean): NotificationRun {
  if (unreadOnly) return 'unread';
  if (order === 'newest') return 'all';
  return row.readAt === null ? 'unread' : 'read';
}

/**
 * One query the service runs to fill a page: which run, and where in it to
 * start. `from: null` means the run's own start — its top going forward, its
 * bottom going back.
 */
export interface PageStep {
  run: NotificationRun;
  from: NotificationCursor | null;
}

export interface PagePlan {
  /**
   * `forward` reads each run newest first; `backward` reads oldest first and
   * the service reverses the rows, so a Previous page comes back in display
   * order.
   */
  direction: 'forward' | 'backward';
  steps: PageStep[];
}

/**
 * The walk for one page.
 *
 * Forward from a cursor: the rest of the cursor's run, then every LATER run
 * from its top. Backward from a cursor: the earlier part of the cursor's run,
 * then every EARLIER run from its bottom. A cursor naming a run this listing
 * does not walk — the order or the filter changed under it — starts over,
 * rather than reading a run the listing does not contain.
 */
export function planPage(
  runs: readonly NotificationRun[],
  cursors: { after: NotificationCursor | null; before: NotificationCursor | null },
): PagePlan {
  const { after, before } = cursors;

  if (before) {
    const at = runs.indexOf(before.run);
    if (at === -1) return { direction: 'forward', steps: runs.map((run) => ({ run, from: null })) };
    const earlier = runs.slice(0, at).reverse();
    return {
      direction: 'backward',
      steps: [{ run: before.run, from: before }, ...earlier.map((run) => ({ run, from: null }))],
    };
  }

  if (after) {
    const at = runs.indexOf(after.run);
    if (at === -1) return { direction: 'forward', steps: runs.map((run) => ({ run, from: null })) };
    return {
      direction: 'forward',
      steps: [{ run: after.run, from: after }, ...runs.slice(at + 1).map((run) => ({ run, from: null }))],
    };
  }

  return { direction: 'forward', steps: runs.map((run) => ({ run, from: null })) };
}

/**
 * The cursor as it travels: opaque to the client, base64url of a small JSON.
 *
 * `btoa`/`atob` rather than `Buffer`, so this file stays usable in the browser
 * and needs no Node import. Every field is ASCII (an ISO date, a cuid, a run
 * name), which is all `btoa` accepts.
 */
export function encodeCursor(cursor: NotificationCursor): string {
  const json = JSON.stringify({ r: cursor.run, o: cursor.occurredAt.toISOString(), i: cursor.id });
  return btoa(json).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * The cursor a client sent back, or null when it is not one this code wrote.
 *
 * ⚠ NULL, NOT "START OVER", for a malformed cursor. The service refuses it:
 * silently restarting would hand back page 1 labelled as page 7, which reads as
 * the list having changed rather than as a broken link.
 */
export function decodeCursor(value: string): NotificationCursor | null {
  if (!value || value.length > 400) return null;
  let parsed: unknown;
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/');
    parsed = JSON.parse(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { r, o, i } = parsed as Record<string, unknown>;
  if (r !== 'unread' && r !== 'read' && r !== 'all') return null;
  if (typeof o !== 'string' || typeof i !== 'string' || !i) return null;
  const occurredAt = new Date(o);
  if (Number.isNaN(occurredAt.getTime())) return null;
  return { run: r, occurredAt, id: i };
}
