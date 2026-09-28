/**
 * The two kinds of text this module stores, each prepared ONE way: a LINE (a
 * board, column or task title, a checklist item) and a BLOCK (a description, a
 * comment). Every field names its kind and its cap, rather than restating the
 * rule — two copies of a normalising rule drift, and then two titles that look
 * the same are different (principle 5).
 */

/**
 * Control and invisible formatting characters, refused in a LINE.
 *
 * A line is what other members see on a shared board. A right-to-left override
 * makes it read as something else, and a zero-width space makes two column
 * names that look the same different — the queue's `prepareDisplayText`
 * reasoning. The same cost: an emoji sequence with a zero-width joiner is
 * refused.
 */
const CONTROL_OR_INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * A line as it is stored and compared: NFC, whitespace runs as one space,
 * trimmed. Exported because the editor must compare what it would SEND by the
 * same rule, or autosave resends "Hello " forever once "Hello" is stored.
 */
export function normalizeTaskLine(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/**
 * A line as it will be stored, or null when refused: empty (unless allowed),
 * longer than `max` code points, or carrying a control or invisible character.
 * The collapse runs first, so a pasted newline becomes a space, not a refusal.
 */
export function prepareTaskLine(raw: string, max: number, options: { allowEmpty?: boolean } = {}): string | null {
  const line = normalizeTaskLine(raw);
  if (line.length === 0 && !options.allowEmpty) return null;
  if (CONTROL_OR_INVISIBLE.test(line)) return null;
  if ([...line].length > max) return null;
  return line;
}

/**
 * A block as it will be stored, or null when refused. NFC-normalised and
 * otherwise KEPT AS TYPED: newlines and indentation mean something.
 *
 * ⚠ NUL IS REFUSED, not stripped. Postgres `text` cannot store `\u0000` at all,
 * so letting it through fails the write with a driver error instead of a
 * reason; stripping it would store something other than what was sent.
 */
export function prepareTaskBlock(raw: string, max: number, options: { allowEmpty?: boolean } = {}): string | null {
  const block = raw.normalize('NFC');
  if (block.includes('\u0000')) return null;
  if (block.trim().length === 0 && !options.allowEmpty) return null;
  if ([...block].length > max) return null;
  return block;
}
