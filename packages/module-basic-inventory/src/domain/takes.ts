import type { StockDelta, StockQuantity, StockRefusal } from '../types.js';
import { isStockQuantity } from './quantities.js';

/**
 * Stock takes: the shelf counted, the difference shown, then confirmed
 * (INVENTORY-PLAN §2).
 *
 * ⚠ COMPARED AT CONFIRMATION, NOT WHEN THE SHEET WAS OPENED. A sale between
 * opening the sheet and confirming it is already in on hand; comparing with
 * the count as it was when the sheet opened would write that sale back.
 */

/** One line of a count sheet: the item and what was typed (null: not counted, left alone). */
export interface StockTakeCount {
  stockItemId: string;
  counted: StockQuantity | null;
}

/** One line as the sheet shows it before confirming. */
export interface StockTakeDifference {
  stockItemId: string;
  onHand: StockQuantity;
  counted: StockQuantity;
  /** counted − on hand: positive, the shelf has more than the history says. */
  difference: StockQuantity;
}

/** Why a typed count is refused, or null. Zero is a count (the shelf is empty); below zero is not. */
export function checkStockCount(counted: StockQuantity): StockRefusal | null {
  if (!isStockQuantity(counted) || counted < 0) return 'invalid_quantity';
  return null;
}

/**
 * Each counted line against on hand now. Lines nobody counted are left out:
 * an untouched line means "not counted", never "none on the shelf".
 */
export function planTakeDifferences(
  counts: readonly StockTakeCount[],
  onHand: ReadonlyMap<string, StockQuantity>,
): StockTakeDifference[] {
  const differences: StockTakeDifference[] = [];
  for (const line of counts) {
    if (line.counted === null) continue;
    const now = onHand.get(line.stockItemId) ?? 0;
    differences.push({
      stockItemId: line.stockItemId,
      onHand: now,
      counted: line.counted,
      difference: line.counted - now,
    });
  }
  return differences;
}

/** What confirming writes: one `count` movement per line that differs, and none for a line that matched. */
export function takeMoves(differences: readonly StockTakeDifference[]): StockDelta[] {
  return differences
    .filter((line) => line.difference !== 0)
    .map((line) => ({ stockItemId: line.stockItemId, quantity: line.difference }));
}
