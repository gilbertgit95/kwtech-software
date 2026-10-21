import type { PosFeatureKey } from '../feature-keys.js';

/**
 * The questions this module needs answered and cannot answer itself.
 *
 * Grants belong to `module-permissions` and names to `module-auth`, and a
 * module may not import a module (PLAN §9). So each is a structural port the
 * APP fills, and each absence has a documented MEANING rather than a crash.
 */

/**
 * Does this person hold `key` in this workspace — after the plan filter,
 * exactly as the guard would resolve it?
 *
 * Asked where a key changes WHAT an operation returns or keeps, rather than
 * whether it runs (the binding already decided that):
 *
 * - `pos:manage_items` / `pos:reports`: whether costs are in the answer at all
 *   (guard rules, "cost stays on the server");
 * - `pos:discount`: whether an edit keeps a fixed discount somebody else gave.
 *
 * ⚠ UNBOUND MEANS NO. Costs never leave the server, and fixed discounts drop
 * on every edit. Fail closed.
 */
export interface PosAccessCheck {
  holds(organizationId: string, workspaceId: string, userId: string, key: PosFeatureKey): Promise<boolean>;
}

/**
 * The workspace's IANA time zone (`perm_workspace.timeZone`): which day a sale
 * belongs to, and when "today" starts. Null when the app cannot say.
 *
 * UNBOUND MEANS `DEFAULT_TIME_ZONE` (Asia/Manila), never UTC.
 */
export interface PosWorkspaceTimeZone {
  timeZoneOf(organizationId: string, workspaceId: string): Promise<string | null>;
}

export interface PosMember {
  userId: string;
  displayName: string;
}

/**
 * Names, for "by staff" and for who did what on an order. An id it does not
 * know is left out, and the app says "a former member".
 *
 * UNBOUND MEANS NOBODY HAS A NAME.
 */
export interface PosMemberDirectory {
  describe(userIds: readonly string[]): Promise<readonly PosMember[]>;
}

/**
 * What left the store, or came back, as stock sees it — a shape of this
 * module's own: the stock app's is its own, and the app translates
 * (`apps/web-server/src/stock/*`). The same events feed the push after a commit
 * and the catch-up's read (`PosStockService.eventsSince`).
 *
 *   finalised — a line of an order that was paid, or released unpaid (pay later)
 *   voided    — that line's unpaid order was voided: its goods came back whole
 *   returned  — a refund line whose units were put back on the shelf
 *
 * `at` is when it happened, ISO.
 */
export type PosStockEvent =
  | { kind: 'finalised'; lineId: string; itemId: string; variantId: string | null; quantity: number; at: string }
  | { kind: 'voided'; lineId: string; at: string }
  | { kind: 'returned'; refundLineId: string; lineId: string; lineQuantity: number; quantity: number; at: string };

/**
 * Told, AFTER THE COMMIT, what left the store or came back, so stock can take
 * it off or put it back (INVENTORY-PLAN §5).
 *
 * UNBOUND MEANS THE STORE COUNTS NO STOCK: the till works exactly as before.
 * ⚠ A failure here NEVER fails the sale: it is logged, and the stock app's
 * catch-up reads the same events again from `PosStockService.eventsSince`.
 */
export interface PosStockEvents {
  record(organizationId: string, workspaceId: string, events: readonly PosStockEvent[]): Promise<void>;
}

/** How many of an item or variant are left, or null when the store does not count it. */
export interface PosStockLevel {
  itemId: string;
  variantId: string | null;
  left: number | null;
}

/**
 * How many of each item and variant the shelf can still make, for the till's
 * "3 left" and "Out of stock" (INVENTORY-PLAN §6). Only a warning: the till
 * never refuses a sale on it (I5).
 *
 * UNBOUND MEANS THE TILL SHOWS NO COUNTS.
 */
export interface PosStockLevels {
  levelsFor(
    organizationId: string,
    workspaceId: string,
    refs: readonly { itemId: string; variantId: string | null }[],
  ): Promise<readonly PosStockLevel[]>;
}
