import type { StudioRefusal } from '../types.js';
import { cleanText, type StudioRect, type StudioSize } from './layout.js';
import { isWholeNumber, mm } from './units.js';

/**
 * Correcting for a printer that does not print at exactly 100%
 * (PRINT-STUDIO-PLAN decision 21).
 *
 * Printers and print dialogs scale slightly and shift the page: a 1 × 1 comes
 * out a millimetre large, or a millimetre to the left. The person prints the
 * ruler page, measures two lines with a real ruler, and types in what they
 * read. From that comes a scale per axis and an offset, saved as a named
 * profile ("Epson L3210, 4R") and applied when a result is made.
 *
 * ⚠ SCALE IS STORED IN TEN-THOUSANDTHS (`10000` is exactly 100%), a whole
 * number like every length here, so a profile round-trips through the
 * database and JSON without drifting.
 */

export interface StudioCalibration {
  /** Ten-thousandths. 10000 prints as drawn; 10100 draws 1% larger to make up for a printer that shrinks. */
  scaleX: number;
  scaleY: number;
  /** Hundredths of a millimetre. Positive moves everything right (X) or down (Y). */
  offsetX: number;
  offsetY: number;
}

export const SCALE_ONE = 10000;

export const NO_CALIBRATION: StudioCalibration = { scaleX: SCALE_ONE, scaleY: SCALE_ONE, offsetX: 0, offsetY: 0 };

/**
 * A printer more than 10% out is not miscalibrated, it is on "fit to page" —
 * and a correction that large would hide that instead of fixing it.
 */
export const STUDIO_SCALE_MIN = 9000;
export const STUDIO_SCALE_MAX = 11000;

/** The furthest a profile may shift the page: 10 mm either way. */
export const STUDIO_OFFSET_MAX = mm(10);

export const STUDIO_CALIBRATION_NAME_MAX = 60;

/** The length of each ruler line on the test page: 100 mm, easy to read off any ruler. */
export const STUDIO_RULER_LENGTH = mm(100);

/**
 * How long the ruler page's lines are on a printable area of this size: 100 mm
 * where there is room, else as many whole centimetres as fit (a 2R is too small
 * for 100), and never under 20 mm. The page prints the length beside each
 * line, and the calibration form compares the measurement to this same number.
 */
export function rulerLengthFor(area: StudioSize): number {
  const room = Math.min(area.width, area.height) - mm(20);
  return Math.max(Math.min(STUDIO_RULER_LENGTH, Math.floor(room / mm(10)) * mm(10)), mm(20));
}

/**
 * The scale that makes up for a measurement: a line drawn as `expected` that
 * measured `measured` on paper. A printer that shrinks to 99% needs everything
 * drawn at 1/0.99.
 *
 * Null when the measurement is not a usable number, or is so far out that it
 * is a wrong setting rather than a printer's tolerance.
 */
export function scaleFromMeasurement(expected: number, measured: number): number | null {
  if (!(expected > 0) || !(measured > 0)) return null;
  const scale = Math.round((expected / measured) * SCALE_ONE);
  if (scale < STUDIO_SCALE_MIN || scale > STUDIO_SCALE_MAX) return null;
  return scale;
}

/** A profile off the wire, checked. The only way one reaches the database. */
export function prepareCalibration(value: unknown): { calibration: StudioCalibration } | { refused: StudioRefusal } {
  if (typeof value !== 'object' || value === null) return { refused: 'invalid_calibration' };
  const { scaleX, scaleY, offsetX, offsetY } = value as Record<string, unknown>;
  if (!isScale(scaleX) || !isScale(scaleY) || !isOffset(offsetX) || !isOffset(offsetY)) {
    return { refused: 'invalid_calibration' };
  }
  return { calibration: { scaleX, scaleY, offsetX, offsetY } };
}

export function prepareCalibrationName(value: unknown): { name: string } | { refused: StudioRefusal } {
  if (typeof value !== 'string') return { refused: 'invalid_name' };
  const name = cleanText(value);
  if (name.length === 0 || [...name].length > STUDIO_CALIBRATION_NAME_MAX) return { refused: 'invalid_name' };
  return { name };
}

/**
 * Where a rectangle is drawn once the profile is applied.
 *
 * ⚠ SCALED ABOUT THE SHEET'S CENTRE, then shifted. Scaling from the top left
 * would push the whole layout towards one corner as the correction grows;
 * about the centre the error is shared by both edges, which is how a printer
 * that scales makes it in the first place.
 */
export function applyCalibration(rect: StudioRect, sheet: StudioSize, calibration: StudioCalibration): StudioRect {
  const centreX = sheet.width / 2;
  const centreY = sheet.height / 2;
  const scaleX = calibration.scaleX / SCALE_ONE;
  const scaleY = calibration.scaleY / SCALE_ONE;
  return {
    x: centreX + (rect.x - centreX) * scaleX + calibration.offsetX,
    y: centreY + (rect.y - centreY) * scaleY + calibration.offsetY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  };
}

/** Whether a profile changes anything. */
export function isNoCalibration(calibration: StudioCalibration): boolean {
  return (
    calibration.scaleX === SCALE_ONE &&
    calibration.scaleY === SCALE_ONE &&
    calibration.offsetX === 0 &&
    calibration.offsetY === 0
  );
}

function isScale(value: unknown): value is number {
  return isWholeNumber(value) && value >= STUDIO_SCALE_MIN && value <= STUDIO_SCALE_MAX;
}

function isOffset(value: unknown): value is number {
  return isWholeNumber(value) && Math.abs(value) <= STUDIO_OFFSET_MAX;
}
