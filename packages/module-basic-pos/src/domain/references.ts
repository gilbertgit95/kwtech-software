import { normalizePosLine, POS_LABEL_MAX, preparePosLine } from './text.js';

/**
 * A store's order reference options (issue #30): "Table 1" … "Table 12",
 * "Take-out", "Pickup", the shortcuts the Reference and Hold dialogs offer.
 *
 * ⚠ ONLY SHORTCUTS. A picked option is stored as the order's `label`, text
 * like any typed one (`preparePosLabel`), so receipts, the Orders list and
 * search need nothing new, and nothing on the server checks that a label is
 * one of these. A flat list, in the store's order: no "Table 1–20" ranges.
 */

/** How many options a store keeps. A till shows them all in one list; more than this is no longer a shortcut. */
export const POS_REFERENCE_OPTIONS_MAX = 50;

/**
 * Two references are the same when they differ only in case or spacing:
 * "table 3" and "Table  3" are one table. What the duplicate check, the
 * matching in the till and the "on hold" flag all compare.
 */
export function posReferenceKey(raw: string): string {
  return normalizePosLine(raw).toLocaleLowerCase();
}

/**
 * The options as stored, or every problem at once (as `validateKeymap`, so
 * the Settings tab shows them all): each one a valid label, none empty, no
 * two the same after `posReferenceKey`, and no more than the cap.
 */
export function validateReferenceOptions(
  raw: readonly string[],
): { options: readonly string[] } | { refused: readonly string[] } {
  const problems: string[] = [];
  const options: string[] = [];
  const seen = new Set<string>();
  for (const [index, text] of raw.entries()) {
    const option = preparePosLine(text, POS_LABEL_MAX);
    if (option === null) {
      problems.push(
        normalizePosLine(text) === ''
          ? `Option ${index + 1} is empty.`
          : `“${text}”: at most ${POS_LABEL_MAX} characters, and no hidden or control characters.`,
      );
      continue;
    }
    const key = posReferenceKey(option);
    if (seen.has(key)) {
      problems.push(`“${option}” is in the list twice.`);
      continue;
    }
    seen.add(key);
    options.push(option);
  }
  if (raw.length > POS_REFERENCE_OPTIONS_MAX) {
    problems.push(`At most ${POS_REFERENCE_OPTIONS_MAX} options.`);
  }
  return problems.length > 0 ? { refused: problems } : { options };
}

/**
 * Stored options, never trusted as typed: the JSON read back is filtered to
 * what still passes, rather than refused whole. A rule tightened since
 * (a lower cap) costs a till the options that broke it, never all of them.
 */
export function readReferenceOptions(stored: unknown): readonly string[] {
  if (!Array.isArray(stored)) return [];
  const options: string[] = [];
  const seen = new Set<string>();
  for (const value of stored) {
    if (typeof value !== 'string') continue;
    const option = preparePosLine(value, POS_LABEL_MAX);
    if (option === null || seen.has(posReferenceKey(option))) continue;
    seen.add(posReferenceKey(option));
    options.push(option);
    if (options.length === POS_REFERENCE_OPTIONS_MAX) break;
  }
  return options;
}

/**
 * The options that match what is typed, in the store's order: every one
 * holding the typed text, ignoring case and spacing. Nothing typed matches
 * them all.
 */
export function matchReferenceOptions(options: readonly string[], typed: string): readonly string[] {
  const key = posReferenceKey(typed);
  if (key === '') return options;
  return options.filter((option) => posReferenceKey(option).includes(key));
}

/**
 * What is saved for a typed reference: the option's own spelling when the
 * text IS an option but for case or spacing ("table 3" → "Table 3"), so the
 * same table is written one way all day. Anything else is kept as typed.
 */
export function snapToReferenceOption(options: readonly string[], typed: string): string {
  const key = posReferenceKey(typed);
  if (key === '') return typed;
  return options.find((option) => posReferenceKey(option) === key) ?? typed;
}

/**
 * The references orders on hold carry, as `posReferenceKey`s, for the "on
 * hold" flag. The order on the till is left out even when it is a resumed
 * held one: its own reference is not another order's.
 *
 * ⚠ A HINT, NEVER A LOCK. A flagged option stays selectable: a table whose
 * earlier order was never closed must not be locked out until it is.
 */
export function heldReferenceKeys(
  held: readonly { id: string; label: string | null }[],
  currentOrderId: string | null,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const order of held) {
    if (order.id === currentOrderId || !order.label) continue;
    keys.add(posReferenceKey(order.label));
  }
  return keys;
}
