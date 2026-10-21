import { formatStockQuantity, stockUnitLabel } from '../../domain/quantities.js';
import type {
  StockAdjustReason,
  StockItemKind,
  StockLevel,
  StockMoveKind,
  StockUnit,
  StockWasteReason,
} from '../../types.js';

/**
 * The words the screens use for stock's data, in one place, so the list, the
 * history and a form never call one thing two names.
 */

/** The tone of a status chip, mapped to theme tokens by `StatusChip`. */
export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export const KIND_LABEL: Readonly<Record<StockItemKind, string>> = {
  for_sale: 'For sale',
  material: 'Material',
};

export const UNIT_LABEL: Readonly<Record<StockUnit, string>> = {
  piece: 'Pieces',
  sheet: 'Sheets',
  pack: 'Packs',
  ml: 'Millilitres (ml)',
  l: 'Litres (l)',
  g: 'Grams (g)',
  kg: 'Kilograms (kg)',
  m: 'Metres (m)',
};

export const LEVEL_LABEL: Readonly<Record<StockLevel, { label: string; tone: StatusTone }>> = {
  ok: { label: 'In stock', tone: 'success' },
  low: { label: 'Low', tone: 'warning' },
  out: { label: 'Out', tone: 'danger' },
  negative: { label: 'Count is off', tone: 'danger' },
};

/** What each movement is called in an item's history. */
export const MOVE_LABEL: Readonly<Record<StockMoveKind, string>> = {
  opening: 'Opening stock',
  received: 'Received',
  used: 'Sold or used in a sale',
  returned: 'Back from a void or refund',
  adjustment: 'Adjusted',
  wasted: 'Wasted',
  count: 'Stock take',
};

export const ADJUST_REASON_LABEL: Readonly<Record<StockAdjustReason, string>> = {
  damaged_in_storage: 'Damaged in storage',
  lost: 'Lost or missing',
  used_in_house: 'Used in-house',
  found: 'Found',
  correction: 'Correction',
  other: 'Other',
};

export const WASTE_REASON_LABEL: Readonly<Record<StockWasteReason, string>> = {
  misprint: 'Misprint',
  damaged_while_making: 'Damaged while making',
  damaged_in_storage: 'Damaged in storage',
  reprint: 'Reprint for the customer',
  other: 'Other',
};

/** A reason as stored (either kind of reason), as people read it; unknown text is shown as it is. */
export function reasonLabel(reason: string | null): string | null {
  if (reason === null) return null;
  return (
    (ADJUST_REASON_LABEL as Readonly<Record<string, string>>)[reason] ??
    (WASTE_REASON_LABEL as Readonly<Record<string, string>>)[reason] ??
    reason
  );
}

/** Thousandths with the unit: "12 sheets", "1.5 m", "-2 pieces". */
export function quantityText(quantity: number, unit: StockUnit): string {
  return `${formatStockQuantity(quantity)} ${stockUnitLabel(unit, quantity)}`;
}

/** A movement's quantity with its sign always shown: "+500 sheets", "-2 pieces". */
export function signedQuantityText(quantity: number, unit: StockUnit): string {
  return quantity > 0 ? `+${quantityText(quantity, unit)}` : quantityText(quantity, unit);
}

/**
 * When a movement happened, in the WORKSPACE's zone (typescript rules, "Days,
 * times and time zones"): "Oct 21, 2026, 2:05 PM".
 */
export function whenText(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Who made a movement: their name, "a team member", or the point of sale for a sale. */
export function whoText(move: { createdById: string | null; createdByName: string | null }): string {
  if (move.createdById === null) return 'Point of sale';
  return move.createdByName ?? 'A team member';
}
