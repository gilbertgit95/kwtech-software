import { BOOKS_PERCENT_FULL } from '../../domain/balances.js';

/**
 * Money as a person reads and types it, and as the books keep it — whole
 * centavos. Pure, so every screen prints a peso the same way and a typed amount
 * is parsed ONE way. The point of sale's helpers, copied structurally.
 */

const PESO = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `150000` → `₱1,500.00`. Negative amounts keep their sign: `-₱15.00`. */
export function formatPeso(centavos: number): string {
  return PESO.format(centavos / 100);
}

/** A change with its sign always shown: `+₱1,500.00`, `-₱15.00`, and `₱0.00` for none. */
export function formatSignedPeso(centavos: number): string {
  if (centavos === 0) return formatPeso(0);
  return centavos > 0 ? `+${formatPeso(centavos)}` : formatPeso(centavos);
}

/**
 * A typed amount → centavos, or null when it is not an amount. Accepts
 * "1500", "1,500", "1500.5", "₱1,500.50" and " 15 "; refuses a third decimal,
 * a negative, and anything that is not a number — rather than rounding what
 * was typed into something that was not.
 *
 * ⚠ Parsed from the TEXT, never through a float: "0.29" must be 29 centavos,
 * and `0.29 * 100` is 28.999999999999996. Ten digits of pesos at most; the
 * server's cap (`BOOKS_AMOUNT_MAX`, ₱1,000,000,000) says the rest.
 */
export function parsePeso(text: string): number | null {
  const cleaned = text.replace(/[₱,\s]/gu, '');
  const match = /^(\d{1,10})(?:\.(\d{0,2}))?$/u.exec(cleaned);
  if (!match) return null;
  const pesos = Number(match[1]);
  const fraction = (match[2] ?? '').padEnd(2, '0');
  return pesos * 100 + Number(fraction);
}

/** Centavos as the text an input starts with: `150000` → `1500.00`. */
export function pesoInputValue(centavos: number): string {
  return (centavos / 100).toFixed(2);
}

/** Basis points → "12.5%". */
export function formatPercent(basisPoints: number): string {
  const percent = basisPoints / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0+$/u, '')}%`;
}

/** A typed percentage → basis points, or null: "10" → 1000, "12.5" → 1250. Up to two decimals, at most 100. */
export function parsePercent(text: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{0,2}))?$/u.exec(text.replace(/[%\s]/gu, ''));
  if (!match) return null;
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return basisPoints > BOOKS_PERCENT_FULL ? null : basisPoints;
}

/** Basis points as the text a percentage input starts with: `5000` → `50`. */
export function percentInputValue(basisPoints: number | null): string {
  if (basisPoints === null) return '';
  return formatPercent(basisPoints).replace('%', '');
}
