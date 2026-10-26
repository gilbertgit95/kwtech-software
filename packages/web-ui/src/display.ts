/**
 * How big things are on screen: the text size and the spacing a person chose
 * (issue #20), like a phone's Settings → Display → Font size.
 *
 * ── one knob each, because Tailwind already sizes from two roots ──────────
 *
 * Every size in these stylesheets is a `rem` (`text-sm` is `0.875rem`) or a
 * multiple of `--spacing` (`p-3` is `calc(var(--spacing) * 3)`). So:
 *
 *   - **Text size** is the root font size. Text, and everything measured in
 *     `rem` with it — the spacing unit, control heights, the container-query
 *     breakpoints — grows together, which is what keeps a larger page
 *     proportioned. A sub-app also stacks sooner, which is right: a bigger
 *     page has room for fewer columns.
 *   - **Spacing** is `--spacing` alone: padding, gaps and control heights
 *     around text of the same size.
 *
 * The alternative — a scale per component — would mean every module reading a
 * setting, and the one that forgot would be the screen that does not grow.
 *
 * ⚠ PRINT IS NOT SCALED. Receipts, price lists and studio pages are physical
 * sizes in their own documents; a larger screen must never print a larger
 * receipt. Their HTML is built separately and never carries these attributes.
 *
 * Headless, like the palette runtime: safe to import from a Server Component,
 * and the browser function guards on `document` itself.
 */

/** Smallest to largest. The root font size each one sets is in base.css. */
export const TEXT_SIZES = ['small', 'normal', 'large', 'larger', 'largest'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

/** Tightest to roomiest. The `--spacing` each one sets is in base.css. */
export const SPACINGS = ['compact', 'comfortable', 'roomy'] as const;
export type Spacing = (typeof SPACINGS)[number];

export const DEFAULT_TEXT_SIZE: TextSize = 'normal';
export const DEFAULT_SPACING: Spacing = 'comfortable';

/** What the Display page calls each step. */
export const TEXT_SIZE_LABELS: Readonly<Record<TextSize, string>> = {
  small: 'Small',
  normal: 'Normal',
  large: 'Large',
  larger: 'Larger',
  largest: 'Largest',
};

export const SPACING_LABELS: Readonly<Record<Spacing, string>> = {
  compact: 'Compact',
  comfortable: 'Comfortable',
  roomy: 'Roomy',
};

export interface DisplayPreferences {
  textSize: TextSize;
  spacing: Spacing;
}

export const DEFAULT_DISPLAY: DisplayPreferences = { textSize: DEFAULT_TEXT_SIZE, spacing: DEFAULT_SPACING };

/** The attributes on `<html>` the stylesheet keys off. One source, so a rename cannot half-land. */
export const TEXT_SIZE_ATTRIBUTE = 'data-text-size';
export const SPACING_ATTRIBUTE = 'data-spacing';

/**
 * This browser's copy of the last sizes applied here, so pages outside the
 * signed-in shell (sign-in, the bare pages) open at them too. The ACCOUNT's
 * setting is the real one: the shell applies it on every page and overwrites
 * this copy (`displayApplyScript`).
 */
export const DISPLAY_STORAGE_KEY = 'kwtech_display';

export function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && (TEXT_SIZES as readonly string[]).includes(value);
}

export function isSpacing(value: unknown): value is Spacing {
  return typeof value === 'string' && (SPACINGS as readonly string[]).includes(value);
}

/**
 * Applies the sizes now and remembers them on this browser.
 *
 * The attributes ARE the switch, as with the palette: every step is already
 * in the stylesheet, so this resizes instantly with no reload and no React
 * re-render. Storage failure is ignored on purpose — the sizes still apply
 * for this visit.
 */
export function applyDisplay(display: DisplayPreferences): void {
  if (typeof document === 'undefined') return;
  const textSize = isTextSize(display.textSize) ? display.textSize : DEFAULT_TEXT_SIZE;
  const spacing = isSpacing(display.spacing) ? display.spacing : DEFAULT_SPACING;
  const root = document.documentElement;
  root.setAttribute(TEXT_SIZE_ATTRIBUTE, textSize);
  root.setAttribute(SPACING_ATTRIBUTE, spacing);
  try {
    localStorage.setItem(DISPLAY_STORAGE_KEY, `${textSize} ${spacing}`);
  } catch {
    // No storage available; the sizes stand for this visit.
  }
}

/**
 * The script that applies this browser's stored sizes BEFORE the first paint,
 * for every page. Inline and undeferred, for the reason `palettePreloadScript`
 * gives: anything later resizes a page somebody is already looking at.
 *
 * The valid steps are baked in from the lists above, so an edited stored
 * value matches nothing and is ignored. No user input is interpolated.
 */
export function displayPreloadScript(): string {
  const key = JSON.stringify(DISPLAY_STORAGE_KEY);
  const sizes = JSON.stringify(TEXT_SIZES);
  const spacings = JSON.stringify(SPACINGS);
  const sizeAttribute = JSON.stringify(TEXT_SIZE_ATTRIBUTE);
  const spacingAttribute = JSON.stringify(SPACING_ATTRIBUTE);
  return `try{var d=(localStorage.getItem(${key})||'').split(' '),r=document.documentElement;if(${sizes}.indexOf(d[0])>-1)r.setAttribute(${sizeAttribute},d[0]);if(${spacings}.indexOf(d[1])>-1)r.setAttribute(${spacingAttribute},d[1])}catch(e){}`;
}

/**
 * The script the signed-in shell renders with the ACCOUNT's sizes, so they
 * apply before the shell paints — on a shared till, the person signed in now,
 * not whoever used it last — and become this browser's copy.
 *
 * ⚠ The values are checked against the lists, never interpolated as given:
 * they come from the API, and anything else falls back to the default.
 */
export function displayApplyScript(
  // Plain strings, not the unions: what the API sent is checked here, never assumed.
  display: { textSize?: string; spacing?: string } | null | undefined,
): string {
  const textSize = isTextSize(display?.textSize) ? display.textSize : DEFAULT_TEXT_SIZE;
  const spacing = isSpacing(display?.spacing) ? display.spacing : DEFAULT_SPACING;
  const key = JSON.stringify(DISPLAY_STORAGE_KEY);
  return `(function(){var r=document.documentElement;r.setAttribute(${JSON.stringify(TEXT_SIZE_ATTRIBUTE)},${JSON.stringify(textSize)});r.setAttribute(${JSON.stringify(SPACING_ATTRIBUTE)},${JSON.stringify(spacing)});try{localStorage.setItem(${key},${JSON.stringify(`${textSize} ${spacing}`)})}catch(e){}})()`;
}
