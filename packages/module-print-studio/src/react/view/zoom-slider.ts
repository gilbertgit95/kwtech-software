/**
 * The photo zoom slider's scale: where its thumb is for a zoom, and back.
 *
 * ⚠ PROPORTIONAL, NOT LINEAR. Each step multiplies the zoom by the same
 * amount, so the slider is as fine at 100% as at 400%. On a straight scale a
 * pixel of the mouse was three or four points of zoom, and the first quarter
 * of the track, where nearly all framing is done, could not be set to a
 * chosen percent at all (seen 2026-10-07).
 */

/** How many places the thumb has. More than the track has pixels, so the arrow keys are finer than the mouse. */
export const ZOOM_SLIDER_STEPS = 400;

/** The zoom at a place on the slider, to the thousandth, from `min` at 0 to `max` at the last step. */
export function zoomAtSlider(position: number, min: number, max: number): number {
  const share = Math.min(Math.max(position / ZOOM_SLIDER_STEPS, 0), 1);
  return Math.round(min * (max / min) ** share * 1000) / 1000;
}

/** The place on the slider nearest a zoom. One outside `min`…`max` rests at that end. */
export function sliderAtZoom(zoom: number, min: number, max: number): number {
  const share = Math.log(zoom / min) / Math.log(max / min);
  // ⚠ NaN (a zoom of 0, or none) is the low end, not a thumb the browser puts in the middle.
  if (Number.isNaN(share)) return 0;
  return Math.round(Math.min(Math.max(share, 0), 1) * ZOOM_SLIDER_STEPS);
}
