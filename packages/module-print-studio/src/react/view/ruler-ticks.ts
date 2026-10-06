import { UNITS_PER_INCH, UNITS_PER_MM } from '../../domain/units.js';

/**
 * The rulers along the top and left of the sheet on screen, as data: where
 * each tick goes and which ones carry a number.
 *
 * Measured from the PAPER's top left, the way a ruler laid on the printed
 * sheet would read. They are a guide on the screen only: nothing here is
 * printed.
 */

/** What the rulers count in. `cm` ticks the same millimetres as `mm` and numbers them in centimetres. */
export type StudioRulerUnit = 'mm' | 'cm' | 'in';

export const STUDIO_RULER_UNITS = ['mm', 'cm', 'in'] as const satisfies readonly StudioRulerUnit[];

export const STUDIO_RULER_UNIT_LABELS: Readonly<Record<StudioRulerUnit, string>> = {
  mm: 'Millimetres',
  cm: 'Centimetres',
  in: 'Inches',
};

export interface StudioRulerTick {
  /** In units from the paper's edge. */
  at: number;
  /** How long it is drawn: a numbered step, a half step, or the smallest mark. */
  level: 'major' | 'mid' | 'minor';
  label?: string;
}

/** Closer than this many screen pixels and a level of ticks is a grey smear, so it is left out. */
const TICK_GAP_MIN_PX = 4;

/** A number needs about this much room, in screen pixels, not to run into the next. */
const LABEL_GAP_MIN_PX = 26;

/** Every how many major steps a number is written, smallest first. */
const LABEL_EVERY = [1, 2, 5, 10, 20] as const;

/**
 * The ticks along a length (in units), for a ruler drawn at `pixelsPerUnit`
 * screen pixels per unit. The closer the sheet is looked at, the finer it gets:
 * fitted, an A4's millimetres are too close to draw; zoomed in, they show.
 */
export function rulerTicks(length: number, unit: StudioRulerUnit, pixelsPerUnit: number): StudioRulerTick[] {
  if (!(length > 0) || !(pixelsPerUnit > 0)) return [];
  // Steps in units: millimetres, half-centimetres, centimetres; or eighths, halves and inches.
  const major = unit === 'in' ? UNITS_PER_INCH : 10 * UNITS_PER_MM;
  const mid = major / 2;
  const minor = unit === 'in' ? UNITS_PER_INCH / 8 : UNITS_PER_MM;
  const showMinor = minor * pixelsPerUnit >= TICK_GAP_MIN_PX;
  const showMid = mid * pixelsPerUnit >= TICK_GAP_MIN_PX;
  const every = LABEL_EVERY.find((step) => step * major * pixelsPerUnit >= LABEL_GAP_MIN_PX) ?? 50;

  const ticks: StudioRulerTick[] = [];
  const perMajor = Math.round(major / minor);
  // Counted in minor steps, so an inch's eighths add up exactly instead of drifting by a float each step.
  for (let step = 0; step * minor <= length + 0.001; step += 1) {
    const at = step * minor;
    if (step % perMajor === 0) {
      const count = step / perMajor;
      const tick: StudioRulerTick = { at, level: 'major' };
      if (count % every === 0) tick.label = rulerNumber(count, unit);
      ticks.push(tick);
      continue;
    }
    if (step % (perMajor / 2) === 0) {
      if (showMid) ticks.push({ at, level: 'mid' });
      continue;
    }
    if (showMinor) ticks.push({ at, level: 'minor' });
  }
  return ticks;
}

/** The number written at the `count`th major tick: 10, 20… in millimetres; 1, 2… in centimetres and inches. */
function rulerNumber(count: number, unit: StudioRulerUnit): string {
  return String(unit === 'mm' ? count * 10 : count);
}

/**
 * Where the pointer is along a ruler, for the tag that follows it: a length
 * in units from the paper's edge, in the ruler's unit, without the unit (the
 * ruler's corner names it). To a tenth of a millimetre, a hundredth of a
 * centimetre or of an inch — finer than a hand can point, coarser than noise.
 */
export function rulerReading(units: number, unit: StudioRulerUnit): string {
  const value = unit === 'in' ? units / UNITS_PER_INCH : units / UNITS_PER_MM / (unit === 'cm' ? 10 : 1);
  const digits = unit === 'mm' ? 1 : 2;
  // `+ 0` turns a −0 (a hair left of the edge, rounded) into 0.
  return (Number(value.toFixed(digits)) + 0).toFixed(digits);
}
