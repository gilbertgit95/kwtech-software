/**
 * The questions this module needs answered and cannot answer itself.
 *
 * Names belong to `module-auth`, and what was sold belongs to the point of sale
 * — and a module may not import a module (PLAN §9). So each is a structural
 * port the APP fills (`apps/web-server/src/stock/*`), and each absence has a
 * documented MEANING rather than a crash (`stock.tokens.ts`).
 */

export interface StockMember {
  userId: string;
  displayName: string;
}

/**
 * Names, for who received, adjusted, wasted or counted. An id it does not know
 * is left out, and the app says "a team member".
 *
 * UNBOUND MEANS NOBODY HAS A NAME.
 */
export interface StockMemberDirectory {
  describe(userIds: readonly string[]): Promise<readonly StockMember[]>;
}

/**
 * One thing the point of sale sells, as this module needs it to hang a list on
 * it — a shape of this module's own, copied from nothing: the POS's catalogue
 * is the POS's, and the app translates.
 */
export interface StockSourceItem {
  itemId: string;
  /** Null for the item itself; a variant's id for one of its variants. */
  variantId: string | null;
  itemName: string;
  variantName: string | null;
  /** `product` can be sold as it is; a `service` is only ever made, so it only ever uses materials. */
  kind: 'product' | 'service';
  /** The POS's own short code, if any, so the picker can be searched as the till is. */
  code: string | null;
  archived: boolean;
}

/**
 * The POS's items and their variants, archived ones included (a list on an
 * archived product still reads), at most `limit`.
 *
 * ⚠ UNBOUND MEANS THERE IS NO POINT OF SALE (`STOCK_SOURCE_CATALOGUE`).
 */
export interface StockSourceCatalogue {
  itemsOf(organizationId: string, workspaceId: string, limit: number): Promise<readonly StockSourceItem[]>;
}

/**
 * What happened at the point of sale that takes or returns stock — the push
 * after its commit and the catch-up feed deliver the same shapes, so both
 * paths go through one `StockIntakeService.apply`.
 *
 *   finalised — an order line left the store: the order was paid, or released
 *               unpaid with pay later (I4). Takes what its lists say.
 *   voided    — that line's unpaid order was voided: everything it took comes back.
 *   returned  — a refund line put back on the shelf: its for-sale stock comes back.
 *
 * `at` is when it happened at the POS, ISO: the catch-up's cursor follows it.
 */
export type StockSourceEvent =
  | { kind: 'finalised'; lineId: string; itemId: string; variantId: string | null; quantity: number; at: string }
  | { kind: 'voided'; lineId: string; at: string }
  | { kind: 'returned'; refundLineId: string; lineId: string; lineQuantity: number; quantity: number; at: string };

/**
 * The POS's events AT OR AFTER `since`, oldest first, at most `limit`. Only
 * refund lines marked "put back in stock" are `returned` events.
 *
 * ⚠ INCLUSIVE, so two events in the same millisecond split across two pages
 * are both read; the one read twice is skipped by its key.
 *
 * ⚠ UNBOUND MEANS NOTHING IS CAUGHT UP (`STOCK_SALE_FEED`).
 */
export interface StockSaleFeed {
  eventsSince(
    organizationId: string,
    workspaceId: string,
    since: Date,
    limit: number,
  ): Promise<readonly StockSourceEvent[]>;
}

/**
 * Told, after the commit, that stock moved in a workspace. The app relays it to
 * the point of sale, so an open till re-reads its counts.
 *
 * UNBOUND MEANS THE TILL IS NOT TOLD. ⚠ A failure here never fails the write.
 */
export interface StockChangeListener {
  stockChanged(organizationId: string, workspaceId: string): Promise<void>;
}
