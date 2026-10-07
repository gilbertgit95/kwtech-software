import { inches, mm, toInches, toMm } from '../../domain/units.js';

/**
 * Lengths as people type and read them.
 *
 * The domain holds whole hundredths of a millimetre; a person types "35",
 * "1.5 in" or "2"" into a box. This is the one place the two meet, so a field
 * in the editor and a field in calibration read a length the same way.
 */

export type StudioUnit = 'mm' | 'in';

export const STUDIO_UNITS = ['mm', 'in'] as const satisfies readonly StudioUnit[];

/**
 * A typed length as units, or null when it is not a length.
 *
 * A bare number is in `unit`. A unit typed after it wins — "1 in" in a
 * millimetre field is an inch, because that is what the person meant. A comma
 * is read as a decimal point ("35,5"), as it is typed on many keyboards.
 * Negative and non-finite values are not lengths.
 */
export function parseLength(text: string, unit: StudioUnit): number | null {
  const match = /^\s*(\d+(?:[.,]\d+)?|[.,]\d+)\s*(mm|in|inch|inches|")?\s*$/iu.exec(text);
  if (!match) return null;
  const value = Number((match[1] ?? '').replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  const typed = (match[2] ?? '').toLowerCase();
  const asInches = typed === '' ? unit === 'in' : typed !== 'mm';
  return asInches ? inches(value) : mm(value);
}

/** A length as the text of an input: the number only, without trailing zeros. */
export function lengthText(units: number, unit: StudioUnit): string {
  const value = unit === 'mm' ? toMm(units) : toInches(units);
  return String(Number(value.toFixed(unit === 'mm' ? 2 : 3)));
}

/**
 * A length as a percentage of another, as the text of an input: a cell 102 mm
 * wide on an area 204 mm wide reads "50". Two decimals, no trailing zeros.
 */
export function percentText(units: number, of: number): string {
  if (!(of > 0)) return '0';
  return String(Number(((units / of) * 100).toFixed(2)));
}

/**
 * A typed percentage of a length as units, or null when it is not one.
 *
 * "50", "50%" and "33,33 %" are read. ⚠ ROUNDED TO A WHOLE UNIT, like every
 * length here: a third of 204 mm is stored as 6800 units and shown again as
 * 33.33, not as a fraction that never ends.
 */
export function parsePercent(text: string, of: number): number | null {
  const match = /^\s*(\d+(?:[.,]\d+)?|[.,]\d+)\s*%?\s*$/u.exec(text);
  if (!match) return null;
  const value = Number((match[1] ?? '').replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  return Math.round((value / 100) * of);
}

/** A scale in ten-thousandths as a percentage: 10050 reads "100.5". */
export function scaleText(scale: number): string {
  return String(Number((scale / 100).toFixed(2)));
}
