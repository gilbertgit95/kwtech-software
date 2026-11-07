/**
 * MONEY IS AN INTEGER IN THE CURRENCY'S SMALLEST UNIT (centavos), never a float
 * (PLATFORM-BILLING-PLAN §4 "Prorated plan changes"). 0.1 + 0.2 is not 0.3, and
 * a bill whose lines do not add up to its total is the first thing an
 * accountant finds.
 */

/** An amount in centavos. May be negative on a bill line (a credit) or a balance (owed). */
export type Centavos = number;

/** Throws on a non-integer amount: a float reaching a bill is a bug upstream, not a rounding to hide. */
export function assertCentavos(value: number, what = 'An amount'): Centavos {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${what} must be whole centavos, not ${value}.`);
  return value;
}

/**
 * `amount × part ÷ whole`, rounded ONCE, half up (away from zero for a negative
 * amount, so a credit and a charge of the same size round alike).
 *
 * Integer arithmetic throughout: `(2·a·p + w) ÷ 2w`, floored. The alternative —
 * `Math.round(a * p / w)` — goes through a float, which is exact for these
 * sizes today and wrong the day a price is large enough.
 */
export function prorate(amount: Centavos, part: number, whole: number): Centavos {
  assertCentavos(amount);
  if (!Number.isInteger(part) || !Number.isInteger(whole) || whole <= 0 || part < 0) {
    throw new RangeError(`Cannot prorate over ${part} of ${whole} days.`);
  }
  const sign = amount < 0 ? -1 : 1;
  const numerator = 2n * BigInt(Math.abs(amount)) * BigInt(part) + BigInt(whole);
  return sign * Number(numerator / (2n * BigInt(whole)));
}
