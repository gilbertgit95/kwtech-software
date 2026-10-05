/**
 * Lengths, and the one place they are converted.
 *
 * ⚠ EVERY LENGTH IN THIS MODULE IS A WHOLE NUMBER OF HUNDREDTHS OF A
 * MILLIMETRE (PRINT-STUDIO-PLAN decision 18). Not millimetres as decimals, and
 * not inches: photo sizes are named in inches and margins in millimetres, and
 * with floats "does this cell touch that one" fails on the 15th digit —
 * 3 × 25.4 is not 76.2 in binary. In hundredths an inch is exactly 2540, so
 * every built-in size is an integer and every overlap check is integer
 * arithmetic.
 *
 * A layout is also converted to pixels (the preview and the rendered sheet) and
 * to PDF points (the result file). Doing each of those here, once, is what
 * keeps a 1×1 the same size in all three.
 */

/** Hundredths of a millimetre in one millimetre. */
export const UNITS_PER_MM = 100;

/** Hundredths of a millimetre in one inch. Exact: an inch is 25.4 mm by definition. */
export const UNITS_PER_INCH = 2540;

/** PDF points in one inch. */
const POINTS_PER_INCH = 72;

/**
 * The resolution a sheet is rendered at, in dots per inch. 300 is what photo
 * labs print at; above it the file grows fourfold for a difference nobody sees
 * on an ID photo.
 */
export const STUDIO_RENDER_DPI = 300;

/**
 * Below this a photo in a cell is warned about as likely to print blurry.
 * Half the render resolution: the point where enlargement becomes visible at
 * arm's length.
 */
export const STUDIO_BLURRY_DPI = 150;

/** Millimetres, as typed, to units. Rounded: a typed 12.345 mm is 12.35. */
export function mm(value: number): number {
  return Math.round(value * UNITS_PER_MM);
}

/** Inches, as typed, to units. */
export function inches(value: number): number {
  return Math.round(value * UNITS_PER_INCH);
}

/** Units to millimetres, for showing. */
export function toMm(units: number): number {
  return units / UNITS_PER_MM;
}

/** Units to inches, for showing. */
export function toInches(units: number): number {
  return units / UNITS_PER_INCH;
}

/**
 * Units to whole pixels at a resolution.
 *
 * ⚠ Rounded PER EDGE by callers that draw rectangles (`right - left`, never
 * `round(width)`), or two cells that touch in units leave a one-pixel seam or
 * overlap in pixels.
 */
export function toPixels(units: number, dpi: number = STUDIO_RENDER_DPI): number {
  return Math.round((units * dpi) / UNITS_PER_INCH);
}

/** Units to PDF points. Not rounded: a PDF takes fractions, and the page size must be exact. */
export function toPoints(units: number): number {
  return (units * POINTS_PER_INCH) / UNITS_PER_INCH;
}

/**
 * A length for a person: millimetres with up to two decimals and no trailing
 * zeros, or inches likewise. `2540` reads "25.4 mm" or "1 in".
 */
export function formatLength(units: number, unit: 'mm' | 'in'): string {
  const value = unit === 'mm' ? toMm(units) : toInches(units);
  const digits = unit === 'mm' ? 2 : 3;
  return `${Number(value.toFixed(digits))} ${unit}`;
}

/** A width and height for a person: "4 × 6 in". */
export function formatSize(width: number, height: number, unit: 'mm' | 'in'): string {
  const w = unit === 'mm' ? Number(toMm(width).toFixed(2)) : Number(toInches(width).toFixed(3));
  const h = unit === 'mm' ? Number(toMm(height).toFixed(2)) : Number(toInches(height).toFixed(3));
  return `${w} × ${h} ${unit}`;
}

/** Whether a value off the wire is a whole, finite number — the only kind of length there is. */
export function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}
