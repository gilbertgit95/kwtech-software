/**
 * The lighting tools (PRINT-STUDIO-PLAN decision 9): brightness, contrast,
 * saturation, warmth, and black and white.
 *
 * ⚠ ARITHMETIC ON PIXELS, NOT A CANVAS FILTER. `CanvasRenderingContext2D.filter`
 * is not implemented in every browser, and where it is missing it is ignored
 * silently — the preview would show an adjustment the result file does not
 * have. Doing the sums here means the preview and the result run the same
 * code, and the sums can be tested without a browser.
 *
 * Deliberately basic. Retouching, curves and backgrounds are done in other
 * software, by the operator's decision.
 */

/** Each slider runs −100 to 100, with 0 meaning "leave it alone". */
export interface StudioLighting {
  brightness: number;
  contrast: number;
  saturation: number;
  /** Positive is warmer (towards orange), negative cooler (towards blue). */
  warmth: number;
  grayscale: boolean;
}

export const NEUTRAL_LIGHTING: StudioLighting = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  grayscale: false,
};

export const STUDIO_LIGHTING_MIN = -100;
export const STUDIO_LIGHTING_MAX = 100;

/** Lighting as it arrives from sliders, with every value inside the range and whole. */
export function clampLighting(lighting: StudioLighting): StudioLighting {
  return {
    brightness: clampSlider(lighting.brightness),
    contrast: clampSlider(lighting.contrast),
    saturation: clampSlider(lighting.saturation),
    warmth: clampSlider(lighting.warmth),
    grayscale: lighting.grayscale,
  };
}

/** Whether the lighting changes nothing, so the renderer can skip the pass over every pixel. */
export function isNeutralLighting(lighting: StudioLighting): boolean {
  return (
    lighting.brightness === 0 &&
    lighting.contrast === 0 &&
    lighting.saturation === 0 &&
    lighting.warmth === 0 &&
    !lighting.grayscale
  );
}

/**
 * How far full brightness moves a channel, of 255. Under half the range, so
 * +100 lightens a photo strongly without turning it into a white rectangle.
 */
const BRIGHTNESS_REACH = 110;

/** How far full warmth moves red up and blue down, of 255. */
const WARMTH_REACH = 40;

/** The weights of red, green and blue in how bright a colour looks (Rec. 601). */
const LUMA_RED = 0.299;
const LUMA_GREEN = 0.587;
const LUMA_BLUE = 0.114;

/**
 * The per-channel part of the lighting — brightness, contrast and warmth — as
 * three 256-entry tables: `red[value]` is what a red channel of `value` becomes.
 *
 * Tables because these three depend on one channel at a time. A sheet is
 * millions of pixels; a lookup per channel is the difference between a slider
 * that follows the hand and one that lags it.
 */
export function lightingTables(lighting: StudioLighting): { red: Uint8Array; green: Uint8Array; blue: Uint8Array } {
  const clean = clampLighting(lighting);
  const lift = (clean.brightness / 100) * BRIGHTNESS_REACH;
  // 0 flattens to mid grey, 1 leaves contrast alone, 2 doubles it.
  const slope = clean.contrast >= 0 ? 1 + clean.contrast / 100 : 1 + clean.contrast / 200;
  const warm = (clean.warmth / 100) * WARMTH_REACH;

  const red = new Uint8Array(256);
  const green = new Uint8Array(256);
  const blue = new Uint8Array(256);
  for (let value = 0; value < 256; value += 1) {
    // Contrast pivots on mid grey, so it darkens shadows as it lightens highlights.
    const base = (value - 128) * slope + 128 + lift;
    red[value] = toByte(base + warm);
    green[value] = toByte(base);
    blue[value] = toByte(base - warm);
  }
  return { red, green, blue };
}

/**
 * Apply lighting to RGBA pixels.
 *
 * ⚠ IN PLACE. The one function in this domain that changes its argument: the
 * buffer for an A4 sheet is 35 MB, and a copy per slider movement is what
 * would run the tab out of memory. Callers hand it pixels they own.
 *
 * Alpha is left alone.
 */
export function adjustPixels(pixels: Uint8ClampedArray | Uint8Array, lighting: StudioLighting): void {
  const clean = clampLighting(lighting);
  if (isNeutralLighting(clean)) return;

  const tables = lightingTables(clean);
  // 0 is grey, 1 leaves colour alone, 2 doubles its distance from grey.
  const colour = clean.grayscale ? 0 : 1 + clean.saturation / 100;

  for (let at = 0; at + 3 < pixels.length; at += 4) {
    const red = tables.red[pixels[at] ?? 0] ?? 0;
    const green = tables.green[pixels[at + 1] ?? 0] ?? 0;
    const blue = tables.blue[pixels[at + 2] ?? 0] ?? 0;
    if (colour === 1) {
      pixels[at] = red;
      pixels[at + 1] = green;
      pixels[at + 2] = blue;
      continue;
    }
    const grey = red * LUMA_RED + green * LUMA_GREEN + blue * LUMA_BLUE;
    pixels[at] = toByte(grey + (red - grey) * colour);
    pixels[at + 1] = toByte(grey + (green - grey) * colour);
    pixels[at + 2] = toByte(grey + (blue - grey) * colour);
  }
}

function clampSlider(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(Math.max(Math.round(value), STUDIO_LIGHTING_MIN), STUDIO_LIGHTING_MAX);
}

function toByte(value: number): number {
  return Math.min(Math.max(Math.round(value), 0), 255);
}
