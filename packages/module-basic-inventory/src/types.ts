/**
 * The shapes the stock domain decides over (docs/INVENTORY-PLAN.md). Plain
 * data, no framework, so the server half and the web half hold the same rules.
 *
 * ⚠ A QUANTITY IS AN INTEGER NUMBER OF THOUSANDTHS of its item's unit
 * everywhere in this module: 1 sheet is `1000`, 0.5 m of film is `500`, 2 ml
 * of ink is `2000` (INVENTORY-PLAN §3). The same rule as money's centavos, for
 * the same reason: a float cannot hold 0.1 exactly, and a count off by a
 * fraction per sale never matches the shelf again.
 *
 * ⚠ MONEY IS AN INTEGER NUMBER OF CENTAVOS, as in the point of sale: a unit
 * cost is centavos per WHOLE unit (₱4.20 a sheet is `420`), never per
 * thousandth.
 */

/** Thousandths of a unit. Signed on a movement, never a float. */
export type StockQuantity = number;

/**
 * What a stock item is for (INVENTORY-PLAN §2).
 *
 *   for_sale — goods the till sells as they are (an ink bottle, a ready-made mug).
 *              A refund line may put it back on the shelf.
 *   material — used up making what is sold (photo paper, pouches, a hook).
 *              Never comes back on a refund: the paper a print used stays used.
 */
export type StockItemKind = 'for_sale' | 'material';

/**
 * The unit a stock item is counted in. Piece, sheet and pack are counted WHOLE
 * in the UI (I6); the others take up to three decimals.
 */
export type StockUnit = 'piece' | 'sheet' | 'pack' | 'ml' | 'l' | 'g' | 'kg' | 'm';

/**
 * Why on hand changed (INVENTORY-PLAN §4). On hand is the SUM of an item's
 * movements; nothing else holds a count.
 *
 *   opening     + the first receipt or count of a new item, marked opening
 *   received    + a delivery, with its unit cost
 *   used        − another module's event: a POS line finalised
 *   returned    + that event reversed: a void, or a refund line put back
 *   adjustment  ± Adjust stock, with a reason
 *   wasted      − Record waste: a misprint, something damaged (I15)
 *   count       ± a confirmed stock take's difference
 */
export type StockMoveKind = 'opening' | 'received' | 'used' | 'returned' | 'adjustment' | 'wasted' | 'count';

/** Which module's catalogue a materials list hangs on. Only the POS in v1 (I9). */
export type StockSource = 'pos';

/**
 * Where a materials list sits (I14): on the ITEM, for what every variant uses,
 * or on one VARIANT, for what changes with it. A sale uses both.
 */
export type StockUseRefKind = 'item' | 'variant';

/** Why stock was adjusted by hand. `other` needs a note. */
export type StockAdjustReason = 'damaged_in_storage' | 'lost' | 'used_in_house' | 'found' | 'correction' | 'other';

/** Why work was wasted (I15). `other` needs a note. */
export type StockWasteReason = 'misprint' | 'damaged_while_making' | 'damaged_in_storage' | 'reprint' | 'other';

/**
 * How an item stands, for the list and the till.
 *
 *   ok        — above its low-stock level, or no level is set
 *   low       — at or under its low-stock level, but some left
 *   out       — nothing left (exactly zero)
 *   negative  — more was used than was ever recorded: the count is wrong, and
 *               a stock take is due. Shown, never refused (I5).
 */
export type StockLevel = 'ok' | 'low' | 'out' | 'negative';

/** One line of a materials list (`StockUse`), as the domain needs it. */
export interface StockUseLine {
  refKind: StockUseRefKind;
  /** The POS item's id for `item`, the variant's for `variant`. A bare string (principle 10). */
  refId: string;
  stockItemId: string;
  /** Thousandths of the stock item's unit, per ONE unit sold. */
  quantityPerUnit: StockQuantity;
}

/** What one stock item gains or loses, in thousandths: positive in, negative out. */
export interface StockDelta {
  stockItemId: string;
  quantity: StockQuantity;
}

/**
 * Every expected refusal in this module, one union so a form, the server and
 * the error class share one vocabulary.
 */
export type StockRefusal =
  | 'not_found'
  | 'not_permitted'
  | 'archived'
  | 'invalid_name'
  | 'invalid_code'
  | 'code_taken'
  | 'invalid_text'
  | 'reason_required'
  | 'note_required'
  | 'invalid_quantity'
  | 'whole_units_only'
  | 'invalid_cost'
  | 'invalid_low_stock'
  | 'duplicate_use'
  | 'no_change'
  | 'take_closed'
  | 'limit_reached'
  | 'no_source';
