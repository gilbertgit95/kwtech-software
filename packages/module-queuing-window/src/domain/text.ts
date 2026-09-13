/**
 * Text that ends up on a screen in a public room: a window name, a line name, a
 * staff nickname.
 *
 * ⚠ CONTROL AND INVISIBLE FORMATTING CHARACTERS ARE REFUSED, not stripped. A
 * right-to-left override turns "Window 3" into something else on the TV, and a
 * zero-width space makes two names that look identical different rows.
 * Stripping silently would store something other than what was typed. The
 * cost: `\p{Cf}` includes the zero-width joiner inside some emoji sequences, so
 * a family emoji is refused. Acceptable for a label on a TV.
 */
const CONTROL_OR_INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export type DisplayTextRefusal = 'empty' | 'too_long' | 'invisible_characters';

/**
 * The text as it will be stored, or why it is refused.
 *
 * NFC-normalised, whitespace runs collapsed to one space, then trimmed. The
 * collapse runs BEFORE the character check, so a pasted tab or newline becomes
 * a space rather than a refusal.
 *
 * ⚠ LENGTH IN CODE POINTS, not `String.length`, which counts UTF-16 units: an
 * emoji is two, and a cap in units halves what somebody may type in emoji.
 */
export function prepareDisplayText(
  raw: string,
  maxCodePoints: number,
): { text: string } | { refused: DisplayTextRefusal } {
  const text = raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (text.length === 0) return { refused: 'empty' };
  if (CONTROL_OR_INVISIBLE.test(text)) return { refused: 'invisible_characters' };
  if ([...text].length > maxCodePoints) return { refused: 'too_long' };
  return { text };
}
