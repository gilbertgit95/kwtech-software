import { type DisplayTextRefusal, prepareDisplayText } from './text.js';

/** Long enough for "Enrollment and records", short enough for a TV row. */
export const MAX_LINE_NAME_CODE_POINTS = 40;

/** Four digits. A queue past 9999 in one cycle is a different product. */
export const MAX_TICKET_NUMBER = 9999;

/** Zero-padding, up to the four digits a number can have. */
export const MAX_PAD_TO = 4;

const PREFIX = /^[A-Z0-9]{1,3}$/;

export type PrefixRefusal = 'empty' | 'too_long' | 'invalid_characters';

/**
 * A line's prefix, stored upper case: `c` and `C` are one line.
 *
 * ⚠ A–Z AND 0–9 ONLY, at most three. It is read aloud ("C, zero four two") and
 * typed on nothing, so a letter that has no spoken name in the TV's voice, or a
 * dash that reads as "minus", is a customer who never hears their number.
 */
export function preparePrefix(raw: string): { prefix: string } | { refused: PrefixRefusal } {
  const prefix = raw.trim().toUpperCase();
  if (prefix.length === 0) return { refused: 'empty' };
  if ([...prefix].length > 3) return { refused: 'too_long' };
  if (!PREFIX.test(prefix)) return { refused: 'invalid_characters' };
  return { prefix };
}

export function prepareLineName(raw: string): { text: string } | { refused: DisplayTextRefusal } {
  return prepareDisplayText(raw, MAX_LINE_NAME_CODE_POINTS);
}

export type LineShapeRefusal =
  | 'not_whole_numbers'
  | 'start_below_zero'
  | 'end_not_after_start'
  | 'end_too_large'
  | 'pad_out_of_range';

/**
 * Whether a line's range and padding make sense, or the first reason they do
 * not.
 *
 * ⚠ `endNumber` MUST BE AFTER `startNumber`. A range of one number would make
 * every Call next wrap, and Call next skips numbers already called in a cycle,
 * so it would call the same number once per cycle forever.
 */
export function checkLineShape(shape: {
  startNumber: number;
  endNumber: number;
  padTo: number;
}): LineShapeRefusal | null {
  const { startNumber, endNumber, padTo } = shape;
  if (!Number.isInteger(startNumber) || !Number.isInteger(endNumber) || !Number.isInteger(padTo)) {
    return 'not_whole_numbers';
  }
  if (startNumber < 0) return 'start_below_zero';
  if (endNumber <= startNumber) return 'end_not_after_start';
  if (endNumber > MAX_TICKET_NUMBER) return 'end_too_large';
  if (padTo < 0 || padTo > MAX_PAD_TO) return 'pad_out_of_range';
  return null;
}

/**
 * "C-042". Snapshotted onto the ticket at the call, so editing a line's prefix
 * or padding later never rewrites what a customer was told.
 */
export function formatTicketLabel(prefix: string, number: number, padTo: number): string {
  return `${prefix}-${String(number).padStart(padTo, '0')}`;
}
