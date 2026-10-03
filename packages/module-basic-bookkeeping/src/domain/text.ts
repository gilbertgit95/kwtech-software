import type { BooksRefusal } from '../types.js';

/**
 * Every piece of text the books keep — a name, a note, a reference — passes
 * through here, so the server stores what the form showed and two names that
 * look the same are the same (principle 5).
 *
 * The same rules as the point of sale's `preparePosLine`, copied structurally:
 * a module never imports another (PLAN §9).
 */

/**
 * Control and invisible formatting characters, refused in a line. A name is
 * printed on a statement and shown to the other partners: a right-to-left
 * override makes it read as something else, and a zero-width space makes two
 * investors who look the same different.
 */
const CONTROL_OR_INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** A line as stored and compared: NFC, whitespace runs as one space, trimmed. */
export function normalizeBooksLine(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/**
 * A line as it will be stored, or null when refused: empty (unless allowed),
 * longer than `max` code points, or carrying a control or invisible character.
 */
export function prepareBooksLine(raw: string, max: number, options: { allowEmpty?: boolean } = {}): string | null {
  const line = normalizeBooksLine(raw);
  if (line.length === 0 && !options.allowEmpty) return null;
  if (CONTROL_OR_INVISIBLE.test(line)) return null;
  if ([...line].length > max) return null;
  return line;
}

/** In code points. */
export const BOOKS_NAME_MAX = 120;
export const BOOKS_TEXT_MAX = 200;
export const BOOKS_CATEGORY_MAX = 60;

/**
 * A name (an investor, a borrower) as stored, and the key that makes two names
 * the same person — lower-cased, so "Maria" and "maria" cannot both invest.
 */
export function prepareBooksName(raw: string): { name: string; nameKey: string } | { refused: BooksRefusal } {
  const name = prepareBooksLine(raw, BOOKS_NAME_MAX);
  if (name === null) return { refused: 'invalid_name' };
  return { name, nameKey: name.toLocaleLowerCase('en') };
}

/** Optional text (a note, a contact, a reference, a description), or null for none, or why it is refused. */
export function prepareBooksText(raw: string | null | undefined): { text: string | null } | { refused: BooksRefusal } {
  if (raw == null) return { text: null };
  const text = prepareBooksLine(raw, BOOKS_TEXT_MAX, { allowEmpty: true });
  if (text === null) return { refused: 'invalid_text' };
  return { text: text.length === 0 ? null : text };
}

/** A reason (a void's), required wherever it is asked for: it is what makes a removed entry explainable. */
export function prepareBooksReason(raw: string): { reason: string } | { refused: BooksRefusal } {
  const reason = prepareBooksLine(raw, BOOKS_TEXT_MAX, { allowEmpty: true });
  if (reason === null) return { refused: 'invalid_text' };
  if (reason.length === 0) return { refused: 'reason_required' };
  return { reason };
}
