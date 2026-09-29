import type { PosRefusal } from '../types.js';

/**
 * Every piece of text the POS stores, each prepared ONE way and capped
 * (POS-PLAN guard rules, "input limits"). A field names its kind and its cap
 * rather than restating the rule — two copies of a normalising rule drift, and
 * then two codes that look the same are different (principle 5).
 *
 * The same rules as module-task's `prepareTaskLine`, copied structurally: a
 * module never imports another, and the helper moves to module-kit only when a
 * third copy appears.
 */

/**
 * Control and invisible formatting characters, refused in a line.
 *
 * A name or a note is printed on a receipt and shown to other cashiers. A
 * right-to-left override makes it read as something else, and a zero-width
 * space makes two codes that look the same different.
 */
const CONTROL_OR_INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** A line as stored and compared: NFC, whitespace runs as one space, trimmed. */
export function normalizePosLine(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/**
 * A line as it will be stored, or null when refused: empty (unless allowed),
 * longer than `max` code points, or carrying a control or invisible character.
 * The collapse runs first, so a pasted newline becomes a space, not a refusal.
 */
export function preparePosLine(raw: string, max: number, options: { allowEmpty?: boolean } = {}): string | null {
  const line = normalizePosLine(raw);
  if (line.length === 0 && !options.allowEmpty) return null;
  if (CONTROL_OR_INVISIBLE.test(line)) return null;
  if ([...line].length > max) return null;
  return line;
}

/** In code points. */
export const POS_NAME_MAX = 120;
export const POS_CODE_MAX = 40;
export const POS_NOTE_MAX = 200;
export const POS_LABEL_MAX = 40;
export const POS_CONTACT_MAX = 120;
export const POS_REASON_MAX = 200;

/** A name (item, variant, category, customer) as stored, or why it is refused. Never empty. */
export function preparePosName(raw: string): { name: string } | { refused: PosRefusal } {
  const name = preparePosLine(raw, POS_NAME_MAX);
  return name === null ? { refused: 'invalid_name' } : { name };
}

/**
 * A code (SKU) as stored — UPPER CASE, no spaces — or null for "no code", or
 * why it is refused.
 *
 * ⚠ ONE SPELLING PER CODE. Upper-cased and space-free on the way in, so
 * "lam-a4", "LAM-A4" and "LAM A4" cannot be three codes for one sheet, and the
 * uniqueness check compares like with like. Letters, digits, `-`, `_`, `.` and
 * `/` only: what a label printer or a barcode can carry.
 */
export function preparePosCode(raw: string): { code: string | null } | { refused: PosRefusal } {
  const code = normalizePosLine(raw).replace(/\s+/gu, '').toUpperCase();
  if (code.length === 0) return { code: null };
  if (code.length > POS_CODE_MAX) return { refused: 'invalid_code' };
  if (!/^[\p{L}\p{N}\-_./]+$/u.test(code)) return { refused: 'invalid_code' };
  return { code };
}

/** A line note ("no ice"), or null for none, or why it is refused (D11). */
export function preparePosNote(raw: string): { note: string | null } | { refused: PosRefusal } {
  const note = preparePosLine(raw, POS_NOTE_MAX, { allowEmpty: true });
  if (note === null) return { refused: 'invalid_note' };
  return { note: note.length === 0 ? null : note };
}

/** A held order's label ("table 3"), or null for none, or why it is refused (D8). */
export function preparePosLabel(raw: string): { label: string | null } | { refused: PosRefusal } {
  const label = preparePosLine(raw, POS_LABEL_MAX, { allowEmpty: true });
  if (label === null) return { refused: 'invalid_label' };
  return { label: label.length === 0 ? null : label };
}

/** A customer contact (a phone number or an email, free text), or null for none, or why it is refused. */
export function preparePosContact(raw: string): { contact: string | null } | { refused: PosRefusal } {
  const contact = preparePosLine(raw, POS_CONTACT_MAX, { allowEmpty: true });
  if (contact === null) return { refused: 'invalid_contact' };
  return { contact: contact.length === 0 ? null : contact };
}

/**
 * A reason (a discount's, a cancellation's, a refund's, a void's) as stored,
 * or why it is refused. Required wherever it is asked for: a reason is what
 * makes a lowered or cancelled sale explainable afterwards.
 */
export function preparePosReason(raw: string): { reason: string } | { refused: PosRefusal } {
  const reason = preparePosLine(raw, POS_REASON_MAX, { allowEmpty: true });
  if (reason === null) return { refused: 'invalid_reason' };
  if (reason.length === 0) return { refused: 'reason_required' };
  return { reason };
}
