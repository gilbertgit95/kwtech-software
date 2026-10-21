/**
 * Money as a person reads and types it, and as stock keeps it — whole
 * centavos. Pure, so every screen prints a peso the same way and a typed cost
 * is parsed ONE way. The books' helpers, copied structurally.
 */

const PESO = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `150000` → `₱1,500.00`. */
export function formatPeso(centavos: number): string {
  return PESO.format(centavos / 100);
}

/**
 * A typed amount → centavos, or null when it is not an amount. Accepts
 * "4.20", "1,500", "₱1,500.50"; refuses a third decimal and a negative.
 *
 * ⚠ Parsed from the TEXT, never through a float: "0.29" must be 29 centavos,
 * and `0.29 * 100` is 28.999999999999996.
 */
export function parsePeso(text: string): number | null {
  const cleaned = text.replace(/[₱,\s]/gu, '');
  const match = /^(\d{1,7})(?:\.(\d{0,2}))?$/u.exec(cleaned);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/** Centavos as the text an input starts with: `420` → `4.20`; null → empty. */
export function pesoInputValue(centavos: number | null): string {
  return centavos === null ? '' : (centavos / 100).toFixed(2);
}
