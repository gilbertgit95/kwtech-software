/**
 * A service's price as a person reads and types it, and as it is kept — whole
 * centavos. The point of sale's rule, copied structurally: a module never
 * imports another, and the two must print a peso the same way.
 *
 * A price here is SHOWN, never charged: no money is taken when booking
 * (BOOKING-PLAN D4).
 */

const PESO = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `150000` → `₱1,500.00`. */
export function formatPrice(centavos: number): string {
  return PESO.format(centavos / 100);
}

/**
 * A typed amount → centavos, or null when it is not an amount. Accepts "1500",
 * "1,500", "1500.5" and "₱1,500.50"; refuses a third decimal, a negative, and
 * anything that is not a number.
 *
 * ⚠ Parsed from the TEXT, never through a float: "0.29" must be 29 centavos,
 * and `0.29 * 100` is 28.999999999999996.
 */
export function parsePrice(text: string): number | null {
  const cleaned = text.replace(/[₱,\s]/gu, '');
  const match = /^(\d{1,7})(?:\.(\d{0,2}))?$/u.exec(cleaned);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/** Centavos as the text an input starts with: `150000` → `1500.00`. Null: an empty box. */
export function priceInputValue(centavos: number | null): string {
  return centavos === null ? '' : (centavos / 100).toFixed(2);
}
