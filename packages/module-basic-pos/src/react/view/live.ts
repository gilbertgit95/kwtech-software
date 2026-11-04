/**
 * How long the till may be (re)connecting before it says it is not live
 * (issue #50). The rule itself is module-kit's `isRealtimeLive`, one copy for
 * every screen (issue #64); the threshold is the till's.
 *
 * ⚠ Five seconds stop the note flashing on the reconnect every socket makes
 * when its authorization runs out. Shorter than other screens' because a till
 * is where money changes hands on what the screen says.
 */
export const POS_NOT_LIVE_AFTER_MS = 5_000;

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
