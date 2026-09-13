import { type DisplayTextRefusal, prepareDisplayText } from './text.js';

/** Long enough for "Enrollment desk 2", short enough for a TV row. */
export const MAX_WINDOW_NAME_CODE_POINTS = 32;

export function prepareWindowName(raw: string): { text: string } | { refused: DisplayTextRefusal } {
  return prepareDisplayText(raw, MAX_WINDOW_NAME_CODE_POINTS);
}

/**
 * The key a window name is unique on, per workspace.
 *
 * ⚠ NFKC, not NFC, and case-folded. "Window 3", "window  3" and a full-width
 * "Ｗｉｎｄｏｗ ３" are one window. Two rows a person cannot tell apart on a TV
 * would send a customer to whichever one they guessed.
 */
export function windowNameKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

/**
 * Whether a window calls from a line. NO rows means ALL lines, so a site with
 * one line configures nothing.
 */
export function windowServesLine(servedLineIds: readonly string[], lineId: string): boolean {
  return servedLineIds.length === 0 || servedLineIds.includes(lineId);
}
