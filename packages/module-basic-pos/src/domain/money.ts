import type { PosDiscount, PosRefusal } from '../types.js';

/**
 * Prices, quantities, discounts and the ONE function that adds up an order
 * (POS-PLAN §3, D16). The till and the server both call `computeOrderTotals`,
 * and the server's answer is the one stored: a total the browser computed is
 * a suggestion, never a fact.
 *
 * ⚠ CENTAVOS, INTEGERS, EVERYWHERE. See `types.ts`.
 */

/** The dearest single price or cost: ₱1,000,000.00. Past this it is a typo, not an item. */
export const POS_PRICE_MAX = 100_000_000;

/** The most of one thing on one line. Whole units only (guard rules): a negative quantity would be a hidden refund. */
export const POS_QUANTITY_MAX = 9999;

/** 100%, in basis points. */
export const POS_PERCENT_FULL = 10_000;

/** A price as stored, or why it is refused: whole centavos, ₱0 to `POS_PRICE_MAX`. ₱0 is a free item, and allowed. */
export function checkPosPrice(value: number): PosRefusal | null {
  if (!Number.isSafeInteger(value) || value < 0 || value > POS_PRICE_MAX) return 'invalid_price';
  return null;
}

/** A unit cost, or why it is refused. Null is "not entered", and allowed (D15). */
export function checkPosCost(value: number | null): PosRefusal | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > POS_PRICE_MAX) return 'invalid_cost';
  return null;
}

/** A line quantity, or why it is refused: a whole number from 1 to `POS_QUANTITY_MAX`. */
export function checkPosQuantity(value: number): PosRefusal | null {
  if (!Number.isSafeInteger(value) || value < 1 || value > POS_QUANTITY_MAX) return 'invalid_quantity';
  return null;
}

/**
 * A discount as given, or why it is refused. An amount is whole centavos, a
 * percent whole basis points up to 100%. ZERO IS REFUSED: "no discount" is the
 * absence of one, not a ₱0 row with a reason and a name on it.
 */
export function checkPosDiscount(discount: PosDiscount): PosRefusal | null {
  if (!Number.isSafeInteger(discount.value) || discount.value <= 0) return 'invalid_discount';
  if (discount.kind === 'percent' && discount.value > POS_PERCENT_FULL) return 'invalid_discount';
  if (discount.kind === 'amount' && discount.value > POS_PRICE_MAX * POS_QUANTITY_MAX) return 'invalid_discount';
  return null;
}

/**
 * `basisPoints` of `amount`, rounded HALF UP to the centavo (D16).
 *
 * ⚠ BIGINT, because the product does not fit: the dearest line (₱1M × 9999)
 * times 10,000 basis points is ~10^16, past `Number.MAX_SAFE_INTEGER` (~9×10^15),
 * where integer arithmetic silently loses the last digits.
 */
export function percentOf(amount: number, basisPoints: number): number {
  const scaled = BigInt(amount) * BigInt(basisPoints);
  return Number((scaled + BigInt(POS_PERCENT_FULL / 2)) / BigInt(POS_PERCENT_FULL));
}

/**
 * What a discount takes off `base`, in centavos. ⚠ NEVER MORE THAN `base`: a
 * ₱100 discount on a ₱15 line takes ₱15, so nothing is ever sold below ₱0.
 *
 * ⚠ A FIXED AMOUNT COMES OFF THE WHOLE LINE, not each unit (D16): ₱100 off 100
 * magnets at ₱15 is ₱1,400, not ₱0.
 */
export function discountAmount(base: number, discount: PosDiscount | null): number {
  if (!discount) return 0;
  const off = discount.kind === 'amount' ? discount.value : percentOf(base, discount.value);
  return Math.min(off, base);
}

/** One line as `computeOrderTotals` needs it. */
export interface PosTotalsLineInput {
  unitPrice: number;
  quantity: number;
  discount: PosDiscount | null;
}

/** One line added up. */
export interface PosLineTotals {
  /** Unit price × quantity. */
  gross: number;
  /** What the line's own discount took off. */
  discount: number;
  /** Gross − discount: the line's total as printed. */
  total: number;
  /** The line's share of the ORDER discount (`allocateByWeight`), so refunds and per-item reports see what was really paid. */
  orderDiscountShare: number;
  /** Total − its share of the order discount: what the customer actually paid for this line. */
  net: number;
}

/** An order added up. */
export interface PosOrderTotals {
  lines: readonly PosLineTotals[];
  /** Σ gross, before any discount. */
  gross: number;
  /** Σ line discounts. */
  lineDiscounts: number;
  /** Σ line totals: what the order discount applies to. */
  subtotal: number;
  /** What the order discount took off the subtotal. */
  orderDiscount: number;
  /** Subtotal − order discount: what the customer owes. Never below 0. */
  total: number;
}

/**
 * Adds up an order: each line (price × quantity − its discount), then the
 * order discount on the sum of the lines (D16: the order discount applies
 * AFTER line discounts).
 *
 * The order discount is also spread over the lines (`orderDiscountShare`), by
 * each line's total, to the centavo — so a refund of one line gives back what
 * the customer really paid for it, and a report by item agrees with the day's
 * total exactly.
 */
export function computeOrderTotals(
  lines: readonly PosTotalsLineInput[],
  orderDiscount: PosDiscount | null,
): PosOrderTotals {
  const lineParts = lines.map((line) => {
    const gross = line.unitPrice * line.quantity;
    const discount = discountAmount(gross, line.discount);
    return { gross, discount, total: gross - discount };
  });
  const gross = sum(lineParts.map((line) => line.gross));
  const lineDiscounts = sum(lineParts.map((line) => line.discount));
  const subtotal = sum(lineParts.map((line) => line.total));
  const orderOff = discountAmount(subtotal, orderDiscount);
  const shares = allocateByWeight(
    orderOff,
    lineParts.map((line) => line.total),
  );
  return {
    lines: lineParts.map((line, index) => {
      const orderDiscountShare = shares[index] ?? 0;
      return { ...line, orderDiscountShare, net: line.total - orderDiscountShare };
    }),
    gross,
    lineDiscounts,
    subtotal,
    orderDiscount: orderOff,
    total: subtotal - orderOff,
  };
}

/**
 * Splits `amount` centavos over `weights` in proportion, so the parts sum to
 * `amount` EXACTLY (largest remainder: everyone gets the floor of their share,
 * and the centavos left over go to the largest remainders, earlier lines first
 * on a tie). A part is never larger than its weight when `amount ≤ Σ weights`.
 *
 * Rounding each share on its own would not do: three lines sharing ₱1.00 get
 * 33 + 33 + 33 = 99 centavos, and the report is a centavo off the till.
 */
export function allocateByWeight(amount: number, weights: readonly number[]): number[] {
  const total = sum(weights);
  if (amount === 0 || total === 0) return weights.map(() => 0);
  const exact = weights.map((weight) => {
    const scaled = BigInt(amount) * BigInt(weight);
    return { floor: Number(scaled / BigInt(total)), remainder: Number(scaled % BigInt(total)) };
  });
  const parts = exact.map((part) => part.floor);
  let left = amount - sum(parts);
  const byRemainder = exact.map((part, index) => ({ index, remainder: part.remainder })).filter((p) => p.remainder > 0);
  byRemainder.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of byRemainder) {
    if (left === 0) break;
    parts[index] = (parts[index] ?? 0) + 1;
    left -= 1;
  }
  return parts;
}

/**
 * Whether a discount survives an edit made by somebody who may NOT give
 * discounts (POS-PLAN guard rules).
 *
 * ⚠ A FIXED AMOUNT DOES NOT. ₱100 off 100 magnets is fair; the same ₱100 after
 * the quantity drops to 7 makes them free, and the person who dropped it could
 * not have given that discount themselves. A percentage scales with what it is
 * applied to, so it stays. The service applies this to the edited line's own
 * discount and, on any change to the lines, to the order discount.
 */
export function discountSurvivesEdit(discount: PosDiscount | null, editorMayDiscount: boolean): boolean {
  if (!discount) return true;
  if (editorMayDiscount) return true;
  return discount.kind === 'percent';
}

function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}
