import type { StockRefusal } from '../types.js';

/**
 * Every piece of text the stock app keeps — a name, a code, a supplier, a
 * note — passes through here, so the server stores what the form showed and
 * two names that look the same are the same (principle 5).
 *
 * The same rules as the point of sale's `preparePosLine` and `preparePosCode`,
 * copied structurally: a module never imports another (PLAN §9).
 */

/**
 * Control and invisible formatting characters, refused in a line. A stock
 * item's name is read off a count sheet: a zero-width space would make two
 * items that look the same different, and a count typed against the wrong one.
 */
const CONTROL_OR_INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** A line as stored and compared: NFC, whitespace runs as one space, trimmed. */
export function normalizeStockLine(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/**
 * A line as it will be stored, or null when refused: empty (unless allowed),
 * longer than `max` code points, or carrying a control or invisible character.
 */
export function prepareStockLine(raw: string, max: number, options: { allowEmpty?: boolean } = {}): string | null {
  const line = normalizeStockLine(raw);
  if (line.length === 0 && !options.allowEmpty) return null;
  if (CONTROL_OR_INVISIBLE.test(line)) return null;
  if ([...line].length > max) return null;
  return line;
}

/** In code points. */
export const STOCK_NAME_MAX = 120;
export const STOCK_CODE_MAX = 40;
export const STOCK_TEXT_MAX = 200;

/** A stock item's or a category's name. */
export function prepareStockName(raw: string): { name: string } | { refused: StockRefusal } {
  const name = prepareStockLine(raw, STOCK_NAME_MAX);
  if (name === null) return { refused: 'invalid_name' };
  return { name };
}

/**
 * The store's own short code ("PAPER-4R"), upper case with no spaces, or null
 * for none. Unique per store, as the POS's codes are, so a code typed on a
 * count sheet finds exactly one item.
 */
export function prepareStockCode(raw: string): { code: string | null } | { refused: StockRefusal } {
  const code = normalizeStockLine(raw).replace(/\s+/gu, '').toUpperCase();
  if (code.length === 0) return { code: null };
  if (code.length > STOCK_CODE_MAX) return { refused: 'invalid_code' };
  if (!/^[\p{L}\p{N}\-_./]+$/u.test(code)) return { refused: 'invalid_code' };
  return { code };
}

/** Optional text (a supplier, a reference, a note), or null for none, or why it is refused. */
export function prepareStockText(raw: string | null | undefined): { text: string | null } | { refused: StockRefusal } {
  if (raw == null) return { text: null };
  const text = prepareStockLine(raw, STOCK_TEXT_MAX, { allowEmpty: true });
  if (text === null) return { refused: 'invalid_text' };
  return { text: text.length === 0 ? null : text };
}
