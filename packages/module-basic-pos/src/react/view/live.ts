/**
 * Whether the till may call itself live (issue #50).
 *
 * module-kit reports the socket's state and when it began; how long counts as
 * a problem is each screen's decision (as the notification bell's). The till's:
 *
 *   no connection at all                 not live (the app wires no socket)
 *   live, idle, or a status not reported live
 *   refused                              not live at once: nothing will retry it
 *   connecting / reconnecting < 5 s      live — the routine reconnect
 *   connecting / reconnecting ≥ 5 s      not live
 *
 * ⚠ IT USED TO BE `realtime !== null`, which is true as soon as the app HAS a
 * connection — before it ever connects, and while it times out forever. The
 * cashier's till in issue #50 said nothing while its socket could not reach
 * the server at all, and the staff trusted a screen that never changed.
 *
 * ⚠ The five seconds stop the note flashing on the reconnect every socket
 * makes when its authorization runs out. They are shorter than the bell's
 * thirty because a till is where money changes hands on what the screen says.
 */

export const POS_NOT_LIVE_AFTER_MS = 5_000;

/** The subset of module-kit's `RealtimeStatus` this rule reads — structural, as the bell's. */
export type PosConnectionStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'refused';

/**
 * `hasConnection` is whether the app gave a connection at all; `status` is
 * null for one that does not report (a test's fake), which counts as live —
 * what every screen assumed before statuses existed.
 */
export function posIsLive(
  hasConnection: boolean,
  status: PosConnectionStatus | null,
  since: number,
  now: number,
): boolean {
  if (!hasConnection) return false;
  if (status === null) return true;
  switch (status) {
    case 'idle':
    case 'live':
      return true;
    case 'refused':
      return false;
    case 'connecting':
    case 'reconnecting':
      return now - since < POS_NOT_LIVE_AFTER_MS;
  }
}

/** When `posIsLive` will next change by itself, in ms from now — so the till sets one timer, never polls. */
export function posLiveChangeIn(status: PosConnectionStatus | null, since: number, now: number): number | null {
  if (status !== 'connecting' && status !== 'reconnecting') return null;
  const left = POS_NOT_LIVE_AFTER_MS - (now - since);
  return left > 0 ? left : null;
}

/** What the till reads again after a burst of events: one flag per read. */
export interface TillRereads {
  catalogue: boolean;
  stock: boolean;
  settings: boolean;
  pending: boolean;
  /** The order on the till itself. */
  order: boolean;
}

/**
 * How the till files one event: an `order` event for the order ON this till
 * is `current`, so it is read again too; every other event is its own kind.
 */
export function tillEventKind(event: { kind: string; orderId: string | null }, tillOrderId: string | null): string {
  return event.kind === 'order' && tillOrderId !== null && event.orderId === tillOrderId ? 'current' : event.kind;
}

/**
 * The reads a burst of event kinds (from `tillEventKind`) calls for. `sync` —
 * a (re)connect, Sell opened again, the window back in view — reads it all.
 *
 *   catalogue → the items, and the counts beside them
 *   stock     → the counts (a sale here or elsewhere, a delivery, a count)
 *   settings  → the keymap and the reference options (issue #50: the Sell
 *               tab's reference dialog after references are edited on Items)
 *   order     → the pending list
 *   current   → the pending list AND the order on this till
 */
export function tillRereads(kinds: ReadonlySet<string>): TillRereads {
  const all = kinds.has('sync');
  return {
    catalogue: all || kinds.has('catalogue'),
    stock: all || kinds.has('catalogue') || kinds.has('stock'),
    settings: all || kinds.has('settings'),
    pending: all || kinds.has('order') || kinds.has('current'),
    order: all || kinds.has('current'),
  };
}
