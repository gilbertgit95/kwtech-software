import type { PosAlertMoment } from '../../domain/alert-tones.js';
import type { PosOrderSummaryView } from '../pos-client.js';

/**
 * WHICH WAITING ORDERS CHANGED (issue #68): what the Cashier screens light up,
 * and which sound they play.
 *
 * The list is `state.pending`, re-read on every live event, so "what changed"
 * is the difference between two reads of it — no new event, and nothing the
 * server has to say.
 */

/** How an order changed between two reads of the waiting list. */
export type PosOrderChange = 'new' | 'updated';

/** How long a card stays lit after it arrives or changes. Long enough to look up from a customer and see it. */
export const POS_HIGHLIGHT_MS = 4_000;

/**
 * The orders that are new, or updated, in `next` since `previous`.
 *
 * - **The first read lights nothing** (`previous` null): opening Cashier with
 *   ten orders waiting must not flash all ten, nor sound ten times.
 * - **Updated means a newer version** of an order already waiting: a seller
 *   added to it, or changed its type, customer or reference.
 * - ⚠ **THIS TILL'S OWN CHANGES ARE NOT NEWS.** `own` is the latest version of
 *   each order this till has had on it; an order whose version this till
 *   already saw was changed here — held from this till, or edited on it — and
 *   lights nothing, so a cashier's own edit never sounds like a seller's.
 * - An order that left the list (paid, cancelled) is not a change here: it is
 *   simply gone.
 */
export function pendingChanges(
  previous: readonly Pick<PosOrderSummaryView, 'id' | 'version'>[] | null,
  next: readonly Pick<PosOrderSummaryView, 'id' | 'version'>[],
  own: ReadonlyMap<string, number>,
): Map<string, PosOrderChange> {
  const changes = new Map<string, PosOrderChange>();
  if (previous === null) return changes;
  const before = new Map(previous.map((order) => [order.id, order.version]));
  for (const order of next) {
    const seenHere = own.get(order.id);
    if (seenHere !== undefined && seenHere >= order.version) continue;
    const was = before.get(order.id);
    if (was === undefined) changes.set(order.id, 'new');
    else if (order.version > was) changes.set(order.id, 'updated');
  }
  return changes;
}

/**
 * The one sound a read calls for: a new order's when anything arrived — it is
 * the louder news — otherwise an update's, otherwise none. One sound per read,
 * never one per order: three orders held at once are one chime.
 */
export function alertMomentFor(changes: ReadonlyMap<string, PosOrderChange>): PosAlertMoment | null {
  const kinds = [...changes.values()];
  if (kinds.includes('new')) return 'newOrder';
  if (kinds.includes('updated')) return 'updatedOrder';
  return null;
}
