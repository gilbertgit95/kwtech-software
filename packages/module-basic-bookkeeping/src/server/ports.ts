import type { BooksFeatureKey } from '../feature-keys.js';
import type { BooksDay } from '../types.js';

/**
 * The questions this module needs answered and cannot answer itself.
 *
 * Grants belong to `module-permissions`, names to `module-auth`, the
 * workspace's zone to permissions and sales to the point of sale — and a module
 * may not import a module (PLAN §9). So each is a structural port the APP
 * fills, and each absence has a documented MEANING rather than a crash.
 */

/**
 * Does this person hold `key` in this workspace — after the plan filter,
 * exactly as the guard would resolve it?
 *
 * Asked where an operation is bound to one key but some of what it can touch
 * needs another: `voidBooksEntry` is `books:record`, and voiding an INVESTOR's
 * entry also needs `books:manage_investors`.
 *
 * ⚠ UNBOUND MEANS NO. Fail closed.
 */
export interface BooksAccessCheck {
  holds(organizationId: string, workspaceId: string, userId: string, key: BooksFeatureKey): Promise<boolean>;
}

/**
 * The workspace's IANA time zone (`perm_workspace.timeZone`): which day "today"
 * is, so nothing is dated in the future. Null when the app cannot say.
 *
 * UNBOUND MEANS `DEFAULT_TIME_ZONE` (Asia/Manila), never UTC.
 */
export interface BooksWorkspaceTimeZone {
  timeZoneOf(organizationId: string, workspaceId: string): Promise<string | null>;
}

export interface BooksMember {
  userId: string;
  displayName: string;
}

/**
 * Names, for who recorded and who voided each entry. An id it does not know is
 * left out, and the app says "a former member".
 *
 * UNBOUND MEANS NOBODY HAS A NAME.
 */
export interface BooksMemberDirectory {
  describe(userIds: readonly string[]): Promise<readonly BooksMember[]>;
}

/**
 * What the point of sale took over some of the workspace's days, in centavos —
 * a shape of this module's own, copied from nothing: the POS's report is the
 * POS's, and the app translates (`apps/web-server/src/books/sales-source.ts`).
 */
export interface BooksSalesFigures {
  /** Money KEPT per place: received − change handed back − refunds, by how it was paid. Card payments are `bank`. */
  cash: number;
  ewallet: number;
  bank: number;
  /** Σ unit cost × quantity of what was sold, over the lines that had a cost entered. */
  costOfGoods: number;
  /** How much of the sales had a cost, in basis points: 10,000 is all of it. */
  costCoverage: number;
  /** Paid orders. */
  orders: number;
  /** True when the POS read fewer orders than there were: the figures are too low, and must not be recorded. */
  truncated: boolean;
}

/**
 * The point of sale's takings for the workspace's days `fromDay`…`toDay`,
 * inclusive, counted the way the POS's own reports count them (a sale on the
 * day it was PAID, a refund on the day it was made).
 *
 * ⚠ UNBOUND MEANS THERE IS NO POINT OF SALE. Bringing sales in is refused.
 */
export interface BooksSalesSource {
  salesBetween(
    organizationId: string,
    workspaceId: string,
    fromDay: BooksDay,
    toDay: BooksDay,
  ): Promise<BooksSalesFigures>;
}
