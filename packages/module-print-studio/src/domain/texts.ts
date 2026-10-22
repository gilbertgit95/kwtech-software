import type { StudioRefusal } from '../types.js';
import type { StudioSize } from './layout.js';
import { isWholeNumber, UNITS_PER_INCH } from './units.js';

/**
 * Text on a layout (the operator, 2026-10-22, issue #12): a shop name, "cut
 * here", a line under a photo. Placed, styled and dragged in the layout
 * editor, and PRINTED AS IT IS wherever the layout is used — the Print screen
 * draws it and offers no way to change it.
 *
 * ⚠ THE SAME `x` / `y` AS A CELL: units from the PRINTABLE AREA's top left,
 * so a wider margin moves the text with the cells. The point is the top left
 * of the text's first line.
 *
 * ⚠ THE DOMAIN DOES NOT KNOW HOW WIDE A TEXT IS. That is a question for the
 * browser's font (`render/texts.ts` measures it), so what is saved is checked
 * by where the text STARTS: inside the printable area. The editor keeps the
 * whole text inside by measuring it; the renderer cuts anything past the
 * printable area, which the printer could not reach anyway.
 */
export interface StudioText {
  /** Made by the editor, to tell texts apart while they are dragged. Not a key into anything. */
  id: string;
  /** What is printed. Lines are separated by `\n`. */
  text: string;
  x: number;
  y: number;
  /** The font size, in units — like every length here. The editor shows it in points (`textPoints`). */
  size: number;
  font: StudioFontKey;
  weight: StudioFontWeight;
  italic: boolean;
  /** A line under each line of text. */
  underline: boolean;
  /** A line through each line of text. */
  strike: boolean;
  /** The ink, as `#rrggbb` in lower case (`STUDIO_TEXT_COLOR_PATTERN`). */
  color: string;
}

/**
 * The fonts offered. Only ones every shop computer already has (Windows ships
 * all of them, and a Mac all but Tahoma, which falls back to a sans): a font
 * the browser must download could draw on the screen and not yet in the
 * result, or the other way round. Each falls back to its generic family.
 *
 * Not the written document's `STUDIO_FONTS` (`custom-document.ts`): that is a
 * list of names for canvas-editor, which falls back by itself; a layout's text
 * is drawn here, by the studio, and carries its fallbacks with it.
 */
export const STUDIO_TEXT_FONTS = [
  { key: 'arial', label: 'Arial', family: 'Arial, Helvetica, sans-serif' },
  { key: 'verdana', label: 'Verdana', family: 'Verdana, Geneva, sans-serif' },
  { key: 'tahoma', label: 'Tahoma', family: 'Tahoma, Verdana, sans-serif' },
  { key: 'trebuchet', label: 'Trebuchet MS', family: '"Trebuchet MS", Helvetica, sans-serif' },
  { key: 'times', label: 'Times New Roman', family: '"Times New Roman", Times, serif' },
  { key: 'georgia', label: 'Georgia', family: 'Georgia, "Times New Roman", serif' },
  { key: 'courier', label: 'Courier New', family: '"Courier New", Courier, monospace' },
  { key: 'impact', label: 'Impact', family: 'Impact, "Arial Black", sans-serif' },
] as const;

export type StudioFontKey = (typeof STUDIO_TEXT_FONTS)[number]['key'];

/**
 * How heavy the letters are — what the operator called "font width". Four
 * steps, not a number: a system font has only a few weights, and a step it
 * lacks is drawn as the nearest one anyway.
 */
export type StudioFontWeight = 'light' | 'regular' | 'semibold' | 'bold';

export const STUDIO_FONT_WEIGHTS = [
  'light',
  'regular',
  'semibold',
  'bold',
] as const satisfies readonly StudioFontWeight[];

/** Each weight as CSS reads it, for the canvas and the SVG alike. */
export const STUDIO_FONT_WEIGHT_CSS: Record<StudioFontWeight, number> = {
  light: 300,
  regular: 400,
  semibold: 600,
  bold: 700,
};

/**
 * A text's colour: any `#rrggbb`, as a colour picker gives it. Any colour,
 * not a short list (the operator, 2026-10-22): a shop matches a customer's
 * brand, and white over a dark photo is a real caption.
 */
export const STUDIO_TEXT_COLOR_PATTERN = /^#[0-9a-f]{6}$/u;

/** The colours offered with one press, before the picker: black first, the colour of a new text. */
export const STUDIO_TEXT_SWATCHES = ['#000000', '#ffffff', '#6b7280', '#dc2626', '#2563eb', '#16a34a'] as const;

/**
 * The most texts one layout holds. As many as anyone wants (the operator,
 * 2026-10-22), so far past any real sheet — a full A4 of 12 pt lines is about
 * 60 — and never shown as a limit. It exists only because the spec is JSON a
 * client sends, and an unbounded list is an unbounded row.
 */
export const STUDIO_TEXTS_MAX = 1000;
/** The most characters in one text, and the most lines. */
export const STUDIO_TEXT_CHARS_MAX = 500;
export const STUDIO_TEXT_LINES_MAX = 20;
/** A line's height as a multiple of the font size: the same on the screen and on paper. */
export const STUDIO_TEXT_LINE_HEIGHT = 1.2;

/** Typographic points in one inch. */
const POINTS_PER_INCH = 72;

/** Points, as typed, to units. Rounded: 12 pt is 423 units. */
export function textUnits(points: number): number {
  return Math.round((points * UNITS_PER_INCH) / POINTS_PER_INCH);
}

/** Units to points, for showing: one decimal, so a saved 12 pt reads 12 and not 11.99. */
export function textPoints(units: number): number {
  return Math.round((units * POINTS_PER_INCH * 10) / UNITS_PER_INCH) / 10;
}

/** The smallest and largest a text may be: 4 pt (still legible on a label) to 200 pt (a sign's headline). */
export const STUDIO_TEXT_SIZE_MIN = textUnits(4);
export const STUDIO_TEXT_SIZE_MAX = textUnits(200);

/** The font family a text is drawn in, as CSS reads it. */
export function fontFamilyOf(font: StudioFontKey): string {
  return STUDIO_TEXT_FONTS.find((one) => one.key === font)?.family ?? STUDIO_TEXT_FONTS[0].family;
}

/** The lines of a text, as they are drawn. */
export function textLines(text: Pick<StudioText, 'text'>): string[] {
  return text.text.split('\n');
}

/** How tall a text is, in units: its lines at the line height. */
export function textHeight(text: Pick<StudioText, 'text' | 'size'>): number {
  return Math.round(textLines(text).length * text.size * STUDIO_TEXT_LINE_HEIGHT);
}

/** A new text: 12 pt Arial at the printable area's top left, or where it is asked for. */
export function newText(id: string, at: { x: number; y: number } = { x: 0, y: 0 }): StudioText {
  return {
    id,
    text: 'Text',
    x: at.x,
    y: at.y,
    size: textUnits(12),
    font: 'arial',
    weight: 'regular',
    italic: false,
    underline: false,
    strike: false,
    color: STUDIO_TEXT_SWATCHES[0],
  };
}

/**
 * Where a copy of a text starts (the operator, 2026-10-22): at the text's
 * BOTTOM LEFT corner plus `offset` — under its last line, on the same left
 * edge, so pressing Copy again stacks lines down the sheet. Cells copy to the
 * right (`duplicateCell`); a text is read downwards.
 *
 * Not yet kept inside the area: the caller pulls it in with `placeText`, which
 * needs the copy's measured width.
 */
export function textCopyPosition(
  text: Pick<StudioText, 'x' | 'y' | 'text' | 'size'>,
  offset: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number } {
  return { x: text.x + offset.x, y: text.y + textHeight(text) + offset.y };
}

/**
 * Where a text of this size may start so all of it stays in the printable
 * area: the wanted point, pulled back inside. A text larger than the area
 * starts at its top left and runs off — the renderer cuts it.
 */
export function placeText(area: StudioSize, box: StudioSize, to: { x: number; y: number }): { x: number; y: number } {
  const x = Math.min(Math.max(Math.round(to.x), 0), Math.max(area.width - box.width, 0));
  const y = Math.min(Math.max(Math.round(to.y), 0), Math.max(area.height - box.height, 0));
  return { x, y };
}

/**
 * Texts written for an area of one size, on an area of another.
 *
 * `scale` (a percent layout) keeps each one's share of the area, as its cells
 * do; without it the text stays where it was (a fixed layout). Either way
 * ⚠ THE START IS PULLED BACK INSIDE THE NEW AREA: on a smaller paper a text
 * moves in rather than falling off the page unseen. The font size never
 * changes — a 12 pt line is 12 pt on any paper.
 */
export function textsOnArea(
  texts: readonly StudioText[],
  from: StudioSize,
  to: StudioSize,
  scale: boolean,
): StudioText[] {
  const canScale = scale && from.width > 0 && from.height > 0;
  return texts.map((text) => {
    const x = canScale ? Math.round((text.x * to.width) / from.width) : text.x;
    const y = canScale ? Math.round((text.y * to.height) / from.height) : text.y;
    return { ...text, ...placeText(to, { width: 0, height: 0 }, { x, y }) };
  });
}

/**
 * Whether these texts may be saved on an area of this size: not too many,
 * none empty, and each starting inside the area. Run by the editor after every
 * change and by the server through `prepareLayoutSpec` — one rule.
 */
export function checkTexts(texts: readonly StudioText[], area: StudioSize): StudioRefusal | null {
  if (texts.length > STUDIO_TEXTS_MAX) return 'too_many_texts';
  for (const text of texts) {
    if (text.text.trim().length === 0) return 'text_empty';
    if (text.x > area.width || text.y > area.height) return 'text_outside';
  }
  return null;
}

/**
 * One text as it arrives in a spec, rebuilt from known fields, or null when it
 * is not one. Lines are kept; within a line, control and invisible formatting
 * characters are dropped, as in every other text the studio stores.
 */
export function readText(value: unknown): StudioText | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { id, text, x, y, size, font, weight, italic, underline, strike, color } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !/^[\w-]{1,64}$/u.test(id)) return null;
  if (typeof text !== 'string' || typeof italic !== 'boolean') return null;
  if (typeof underline !== 'boolean' || typeof strike !== 'boolean') return null;
  // Compared in lower case, and stored that way, so one colour is one value in a row.
  const ink = typeof color === 'string' ? color.toLowerCase() : null;
  if (ink === null || !STUDIO_TEXT_COLOR_PATTERN.test(ink)) return null;
  if (!isWholeNumber(x) || !isWholeNumber(y) || x < 0 || y < 0) return null;
  if (!isWholeNumber(size) || size < STUDIO_TEXT_SIZE_MIN || size > STUDIO_TEXT_SIZE_MAX) return null;
  if (!STUDIO_TEXT_FONTS.some((one) => one.key === font)) return null;
  if (!(STUDIO_FONT_WEIGHTS as readonly unknown[]).includes(weight)) return null;
  const lines = text
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.replace(/[\p{Cc}\p{Cf}]/gu, ' ').trimEnd());
  if (lines.length > STUDIO_TEXT_LINES_MAX) return null;
  const clean = lines.join('\n');
  if ([...clean].length > STUDIO_TEXT_CHARS_MAX) return null;
  return {
    id,
    text: clean,
    x,
    y,
    size,
    // Narrowed by the two checks above.
    font: font as StudioFontKey,
    weight: weight as StudioFontWeight,
    italic,
    underline,
    strike,
    color: ink,
  };
}
