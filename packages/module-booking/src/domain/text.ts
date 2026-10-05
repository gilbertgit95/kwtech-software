/**
 * The two kinds of text this module stores, each prepared ONE way: a LINE (a
 * service's or resource's name, a customer's name, a reason) and a BLOCK (a
 * booking's note). `module-task`'s rule, copied structurally: a module never
 * imports another, and two copies of a normalising rule inside ONE module are
 * what drift (principle 5).
 */

/**
 * Control and invisible formatting characters, refused in a LINE.
 *
 * A line is what everybody at the desk reads. A right-to-left override makes a
 * name read as something else, and a zero-width space makes two services that
 * look the same different.
 */
const CONTROL_OR_INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** A line as it is stored and compared: NFC, whitespace runs as one space, trimmed. */
export function normalizeBookingLine(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/**
 * A line as it will be stored, or null when refused: empty (unless allowed),
 * longer than `max` code points, or carrying a control or invisible character.
 * The collapse runs first, so a pasted newline becomes a space, not a refusal.
 */
export function prepareBookingLine(raw: string, max: number, options: { allowEmpty?: boolean } = {}): string | null {
  const line = normalizeBookingLine(raw);
  if (line.length === 0 && !options.allowEmpty) return null;
  if (CONTROL_OR_INVISIBLE.test(line)) return null;
  if ([...line].length > max) return null;
  return line;
}

/**
 * A block as it will be stored, or null when refused. NFC-normalised and
 * otherwise KEPT AS TYPED: a note's line breaks mean something.
 *
 * ⚠ NUL IS REFUSED, not stripped. Postgres `text` cannot store `\u0000` at all,
 * so letting it through fails the write with a driver error instead of a
 * reason; stripping it would store something other than what was sent.
 */
export function prepareBookingBlock(raw: string, max: number): string | null {
  const block = raw.normalize('NFC');
  if (block.includes('\u0000')) return null;
  if ([...block].length > max) return null;
  return block.trim().length === 0 ? '' : block;
}
