/**
 * THE PHONE'S PERIOD PICKER (issue #72, the operator's feedback 2026-11-05:
 * the full screen's picker is a desktop control on a phone). The rules its
 * range calendar follows, kept here so they are tested; the periods
 * themselves — the presets, their days, the arrows, the custom range's
 * limits — are the full screen's (`view/reports.ts`).
 *
 * A custom range is picked with two taps on one calendar, as phones do it:
 * the first day, then the last.
 */

/** A custom range being picked: either end may still be missing. Days are `YYYY-MM-DD`, the WORKSPACE's. */
export interface RangeDraft {
  fromDay: string | null;
  toDay: string | null;
}

/**
 * The range after a tap on `day`.
 *
 * - With no first day yet, or a range already whole, the tap starts again
 *   from that day: a third tap is a new range, never a puzzle about which end
 *   moved.
 * - With a first day and no last, a tap on or after it ends the range; a tap
 *   before it moves the start there instead, so the range is never backwards.
 */
export function tapRangeDay(draft: RangeDraft, day: string): RangeDraft {
  if (draft.fromDay === null || draft.toDay !== null) return { fromDay: day, toDay: null };
  if (day < draft.fromDay) return { fromDay: day, toDay: null };
  return { fromDay: draft.fromDay, toDay: day };
}

/** How a day reads in the range calendar: an end of the range, inside it, both ends at once, or not in it. */
export type RangeCell = 'start' | 'end' | 'single' | 'inside' | null;

export function rangeCell(day: string, draft: RangeDraft): RangeCell {
  const { fromDay, toDay } = draft;
  if (fromDay === null) return null;
  if (toDay === null || fromDay === toDay) return day === fromDay ? 'single' : null;
  if (day === fromDay) return 'start';
  if (day === toDay) return 'end';
  if (day > fromDay && day < toDay) return 'inside';
  return null;
}

/** What the custom range's button says: the next tap to make, or the days it will show. */
export function rangeStep(draft: RangeDraft): 'first' | 'last' | 'ready' {
  if (draft.fromDay === null) return 'first';
  if (draft.toDay === null) return 'last';
  return 'ready';
}
