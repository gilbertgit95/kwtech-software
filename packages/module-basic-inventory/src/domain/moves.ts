import type {
  StockAdjustReason,
  StockDelta,
  StockQuantity,
  StockRefusal,
  StockUnit,
  StockUseLine,
  StockWasteReason,
} from '../types.js';
import { checkStockCost, checkStockQuantity } from './quantities.js';
import { prepareStockText } from './text.js';
import { planLineTakes } from './uses.js';

/**
 * The movements people make by hand: receiving, adjusting and recording waste
 * (INVENTORY-PLAN §2). Each is checked here once, so the form says why before
 * Save and the server refuses for the same reason.
 *
 * ⚠ NOTHING IS EDITED OR DELETED. A wrong movement is corrected by another one,
 * an adjustment with its reason, so the history always explains on hand.
 */

/** Every adjustment reason, in the order the form lists them. */
export const STOCK_ADJUST_REASONS: readonly StockAdjustReason[] = [
  'damaged_in_storage',
  'lost',
  'used_in_house',
  'found',
  'correction',
  'other',
];

/** Every waste reason, in the order the form lists them (I15). */
export const STOCK_WASTE_REASONS: readonly StockWasteReason[] = [
  'misprint',
  'damaged_while_making',
  'damaged_in_storage',
  'reprint',
  'other',
];

/** What a receipt carries. */
export interface StockReceiveDraft {
  quantity: StockQuantity;
  unitCost: number | null;
}

/**
 * Why a receipt is refused, or null: it adds a positive quantity at a cost
 * that is entered or not. A receipt at ₱0 is allowed (a free sample is still
 * stock); a receipt with no cost leaves the item's cost as it was.
 */
export function checkReceive(draft: StockReceiveDraft, unit: StockUnit): StockRefusal | null {
  if (draft.quantity <= 0) return 'invalid_quantity';
  return checkStockQuantity(draft.quantity, unit) ?? checkStockCost(draft.unitCost);
}

/**
 * The stock item's cost after a receipt (I16): the LATEST cost typed becomes
 * the item's, and a receipt without one leaves it. Each receipt keeps its own
 * cost on its movement, so the history still shows what every delivery cost.
 *
 * The alternative — a weighted average over what is on hand — is closer to
 * what the stock is worth but cannot be checked by eye, and a negative count
 * would make it meaningless. Later, if wanted.
 */
export function costAfterReceipt(current: number | null, received: number | null): number | null {
  return received ?? current;
}

/**
 * Why a note is required and missing, or null. `other` explains nothing by
 * itself; the named reasons do.
 */
function checkReasonNote(reason: StockAdjustReason | StockWasteReason, note: string | null): StockRefusal | null {
  if (reason === 'other' && note === null) return 'note_required';
  return null;
}

/**
 * An adjustment as it will be stored, or why not. `quantity` is signed: in
 * (found, a correction up) or out (damaged, lost, used in-house).
 */
export function prepareAdjustment(
  input: { quantity: StockQuantity; reason: StockAdjustReason; note?: string | null | undefined },
  unit: StockUnit,
): { quantity: StockQuantity; reason: StockAdjustReason; note: string | null } | { refused: StockRefusal } {
  const quantityRefused = checkStockQuantity(input.quantity, unit);
  if (quantityRefused) return { refused: quantityRefused };
  const note = prepareStockText(input.note);
  if ('refused' in note) return note;
  const noteRefused = checkReasonNote(input.reason, note.text);
  if (noteRefused) return { refused: noteRefused };
  return { quantity: input.quantity, reason: input.reason, note: note.text };
}

/**
 * What a waste OF A PRODUCT proposes (I15): its materials, from both its lists,
 * times how many were spoiled — as POSITIVE quantities, the way the form shows
 * them, for a person to change before confirming (the hook was not used yet).
 */
export function proposeWaste(
  uses: readonly StockUseLine[],
  ref: { itemId: string; variantId: string | null },
  units: number,
): StockDelta[] {
  return planLineTakes(uses, { ...ref, quantity: units }).map((take) => ({
    stockItemId: take.stockItemId,
    quantity: -take.quantity,
  }));
}

/**
 * A waste as it will be stored, or why not: at least one line, each a positive
 * quantity in its item's unit, each item once, and a note for `other`. The
 * lines come back as NEGATIVE deltas, ready to write as `wasted` movements.
 *
 * `unitOf` answers each line's unit; a line for an item it does not know is
 * refused as not found, so a waste cannot name another store's item.
 */
export function prepareWaste(
  input: { lines: readonly StockDelta[]; reason: StockWasteReason; note?: string | null | undefined },
  unitOf: (stockItemId: string) => StockUnit | null,
): { lines: StockDelta[]; reason: StockWasteReason; note: string | null } | { refused: StockRefusal } {
  if (input.lines.length === 0) return { refused: 'no_change' };
  const seen = new Set<string>();
  for (const line of input.lines) {
    const unit = unitOf(line.stockItemId);
    if (unit === null) return { refused: 'not_found' };
    if (seen.has(line.stockItemId)) return { refused: 'duplicate_use' };
    seen.add(line.stockItemId);
    if (line.quantity <= 0) return { refused: 'invalid_quantity' };
    const refused = checkStockQuantity(line.quantity, unit);
    if (refused) return { refused };
  }
  const note = prepareStockText(input.note);
  if ('refused' in note) return note;
  const noteRefused = checkReasonNote(input.reason, note.text);
  if (noteRefused) return { refused: noteRefused };
  return {
    lines: input.lines.map((line) => ({ stockItemId: line.stockItemId, quantity: -line.quantity })),
    reason: input.reason,
    note: note.text,
  };
}
