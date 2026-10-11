import type { StudioLayoutPaper, StudioMargins, StudioOrientation, StudioSize } from './layout.js';
import { findStudioPaper, STUDIO_PAPER_MAX, STUDIO_PAPER_MIN } from './papers.js';
import { inches, isWholeNumber, mm, UNITS_PER_INCH } from './units.js';

/*
 * A document WRITTEN in the studio (the operator, 2026-10-11: "an additional
 * option to create a custom document"), on the PDF side of the Print screen.
 *
 * The editor is `@hufe921/canvas-editor`, which measures everything in CSS
 * pixels; this file is where those meet the studio's units. The document is
 * turned into a PDF and printed exactly as a chosen PDF is, so nothing past
 * "make a PDF" is new.
 *
 * ⚠ IT STAYS IN THE BROWSER, like everything else here: it is kept only as a
 * FILE the person downloads (`.kwdoc`) and opens again later. Nothing is
 * uploaded or stored.
 */

/** A CSS pixel is 1/96 inch: the editor's unit for page sizes, margins and font sizes. */
export const STUDIO_EDITOR_DPI = 96;

/** A typographic point is 1/72 inch. Font sizes are SHOWN in points, as in Word and Google Docs. */
const POINTS_PER_INCH = 72;

/** Units to editor pixels. Whole pixels: the editor lays rows out on them. */
export function toEditorPixels(units: number): number {
  return Math.round((units * STUDIO_EDITOR_DPI) / UNITS_PER_INCH);
}

/** Editor pixels back to units, for a margin dragged on the editor's ruler. `toEditorPixels` of the result is the same pixel. */
export function fromEditorPixels(pixels: number): number {
  return Math.round((pixels * UNITS_PER_INCH) / STUDIO_EDITOR_DPI);
}

/** A font size in points to the editor's pixels. Not rounded: 11 pt is 14.67 px, and the editor draws fractions. */
export function pointsToEditorPixels(points: number): number {
  return (points * STUDIO_EDITOR_DPI) / POINTS_PER_INCH;
}

/** The editor's pixels to points, for showing: to the nearest half point, so 14.67 px reads 11. */
export function editorPixelsToPoints(pixels: number): number {
  return Math.round(((pixels * POINTS_PER_INCH) / STUDIO_EDITOR_DPI) * 2) / 2;
}

/**
 * The sizes in the font size list, in points: Google Docs' own, then the
 * large ones a shop's signs and posters need. Any other may still be typed.
 */
export const STUDIO_FONT_SIZES = [
  8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96, 120, 144, 200, 300, 400,
] as const;
/**
 * The size + or − goes to, in points: the next size in the list, up or down,
 * as Word's "grow font" does — a step of 1 pt is invisible on 100 pt letters,
 * and read as + not working (the operator, 2026-10-11). Below the list's
 * smallest it steps by 1, down to the minimum; past either end it stays.
 * A size between two of the list's goes to the nearer one in that direction.
 */
export function nextFontSize(points: number, direction: 1 | -1): number {
  if (direction === 1) {
    const larger = STUDIO_FONT_SIZES.find((size) => size > points);
    if (larger !== undefined) return larger;
    return Math.min(STUDIO_FONT_SIZE_MAX, points);
  }
  const smaller = [...STUDIO_FONT_SIZES].reverse().find((size) => size < points);
  if (smaller !== undefined) return smaller;
  return Math.max(STUDIO_FONT_SIZE_MIN, Math.ceil(points) - 1);
}

/** The smallest and largest font size that may be typed, in points. */
export const STUDIO_FONT_SIZE_MIN = 1;
export const STUDIO_FONT_SIZE_MAX = 400;

/**
 * The fonts offered. Fonts are the COMPUTER's: none is downloaded, so these
 * are the ones a Windows computer has (the shops' computers). A document
 * written with one a computer lacks shows the browser's fallback there.
 */
export const STUDIO_FONTS = [
  'Arial',
  'Calibri',
  'Cambria',
  'Comic Sans MS',
  'Courier New',
  'Georgia',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
] as const;

/** A new document's font and size: Arial 11 pt, as Google Docs starts. */
export const STUDIO_DEFAULT_FONT = 'Arial';
export const STUDIO_DEFAULT_FONT_POINTS = 11;

/** How a background picture covers the page: all of it (edges may be cut), or as much as fits whole. */
export type StudioBackgroundFit = 'cover' | 'contain';

/** The page a document is written on: everything about it but its words. */
export interface StudioDocumentSetup {
  paper: StudioLayoutPaper;
  orientation: StudioOrientation;
  /** Where the text may go, as on the sheet the person sees. Units. */
  margins: StudioMargins;
  /** A picture behind every page, as a `data:image/…` URL, or null for plain white paper. */
  background: string | null;
  backgroundFit: StudioBackgroundFit;
  /** A number at the foot of every page. Off by default, as in Google Docs. */
  pageNumbers: boolean;
}

/** A new document's margins: an inch all round, Word's and Google Docs' default. */
export const STUDIO_DOCUMENT_MARGIN_DEFAULT = inches(1);
/** The widest a margin may be. */
export const STUDIO_DOCUMENT_MARGIN_MAX = mm(100);
/** What the margins must leave for the text, across and down. Less and the editor cannot lay a row out. */
export const STUDIO_DOCUMENT_TEXT_MIN = mm(20);

/** Why page settings cannot be used. */
export type StudioDocumentSetupRefusal = 'margin_out_of_range' | 'no_room_for_text';

/**
 * Whether the margins fit the paper. `null` when they do.
 *
 * ⚠ CHECKED ON THE SHEET AS TURNED: a margin that fits A4 upright may leave no
 * room for the text across it in landscape, and the other way round.
 */
export function checkDocumentSetup(
  setup: Pick<StudioDocumentSetup, 'paper' | 'orientation' | 'margins'>,
): StudioDocumentSetupRefusal | null {
  const { top, right, bottom, left } = setup.margins;
  for (const margin of [top, right, bottom, left]) {
    if (!isWholeNumber(margin) || margin < 0 || margin > STUDIO_DOCUMENT_MARGIN_MAX) return 'margin_out_of_range';
  }
  const sheet = documentSheet(setup);
  if (sheet.width - left - right < STUDIO_DOCUMENT_TEXT_MIN) return 'no_room_for_text';
  if (sheet.height - top - bottom < STUDIO_DOCUMENT_TEXT_MIN) return 'no_room_for_text';
  return null;
}

/** The sheet as turned, in units. (The same rule as `sheetSize`, which takes a whole layout spec.) */
export function documentSheet(setup: Pick<StudioDocumentSetup, 'paper' | 'orientation'>): StudioSize {
  if (setup.orientation === 'portrait') return { width: setup.paper.width, height: setup.paper.height };
  return { width: setup.paper.height, height: setup.paper.width };
}

/** A new document's page: the paper given, upright, an inch of margin, no background. */
export function defaultDocumentSetup(paper: StudioLayoutPaper): StudioDocumentSetup {
  const margin = STUDIO_DOCUMENT_MARGIN_DEFAULT;
  return {
    paper,
    orientation: 'portrait',
    margins: { top: margin, right: margin, bottom: margin, left: margin },
    background: null,
    backgroundFit: 'cover',
    pageNumbers: false,
  };
}

/** What the file says it is. Anything else is not one of these files. */
export const STUDIO_DOCUMENT_FORMAT = 'kwtech-studio-document';
/** The version this code writes. A newer one is refused rather than half read. */
export const STUDIO_DOCUMENT_VERSION = 1;
/** The saved file's extension. Its content is JSON. */
export const STUDIO_DOCUMENT_EXTENSION = '.kwdoc';
/** The longest document name kept. */
export const STUDIO_DOCUMENT_NAME_MAX = 120;
/** A new document's name. */
export const STUDIO_DOCUMENT_UNTITLED = 'Untitled document';

/**
 * A written document as saved to a file.
 *
 * `content` is the editor's own data (`IEditorData`: its header, body and
 * footer as element lists), kept as the editor gave it. The studio does not
 * read it; the editor does, and the editor is what checks it.
 */
export interface StudioDocumentFile {
  format: typeof STUDIO_DOCUMENT_FORMAT;
  version: typeof STUDIO_DOCUMENT_VERSION;
  name: string;
  setup: StudioDocumentSetup;
  content: StudioDocumentContent;
}

/** The editor's data, as far as the studio needs to know it: a body that is a list. */
export interface StudioDocumentContent {
  main: unknown[];
  header?: unknown[];
  footer?: unknown[];
}

/** Why a file could not be opened. Each has a sentence (`STUDIO_DOCUMENT_FILE_MESSAGES`). */
export type StudioDocumentFileRefusal = 'not_a_document' | 'newer_version' | 'damaged';

export const STUDIO_DOCUMENT_FILE_MESSAGES: Record<StudioDocumentFileRefusal, string> = {
  not_a_document: 'That file is not a document saved from the print studio.',
  newer_version: 'That document was saved by a newer version of the print studio. Reload the page and try again.',
  damaged: 'That document could not be opened. The file may be damaged.',
};

/** The document's name as kept: trimmed, at most `STUDIO_DOCUMENT_NAME_MAX` characters, never empty. */
export function documentName(name: string): string {
  const trimmed = name.trim().slice(0, STUDIO_DOCUMENT_NAME_MAX);
  return trimmed === '' ? STUDIO_DOCUMENT_UNTITLED : trimmed;
}

/** The file name a document is saved under: its name, without what Windows refuses in one. */
export function documentFileName(name: string): string {
  const safe = documentName(name)
    .replace(/[\\/:*?"<>|]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return `${safe === '' ? STUDIO_DOCUMENT_UNTITLED : safe}${STUDIO_DOCUMENT_EXTENSION}`;
}

/** Whether a chosen file looks like a saved document, by its name (browsers give it no type). */
export function isDocumentFileName(name: string): boolean {
  return name.toLowerCase().endsWith(STUDIO_DOCUMENT_EXTENSION);
}

/**
 * A saved file, read back: rebuilt from the fields this code knows, every one
 * checked, or the reason it cannot be opened.
 *
 * ⚠ THE FILE IS ANYBODY'S: it may have been edited by hand or made by
 * something else. The page settings are rebuilt here so a bad margin or paper
 * never reaches the editor; a built-in paper takes its size from the studio's
 * own list, not the file's. The background must be an image held IN the file
 * (`data:image/…`): a web address would make the browser fetch it from
 * somewhere when the document opens.
 */
export function prepareDocumentFile(value: unknown): StudioDocumentFile | { refused: StudioDocumentFileRefusal } {
  if (!isRecord(value) || value.format !== STUDIO_DOCUMENT_FORMAT) return { refused: 'not_a_document' };
  if (typeof value.version !== 'number') return { refused: 'damaged' };
  if (value.version > STUDIO_DOCUMENT_VERSION) return { refused: 'newer_version' };
  if (value.version !== STUDIO_DOCUMENT_VERSION) return { refused: 'damaged' };

  const setup = prepareSetup(value.setup);
  const content = prepareContent(value.content);
  if (!setup || !content) return { refused: 'damaged' };
  return {
    format: STUDIO_DOCUMENT_FORMAT,
    version: STUDIO_DOCUMENT_VERSION,
    name: documentName(typeof value.name === 'string' ? value.name : ''),
    setup,
    content,
  };
}

function prepareSetup(value: unknown): StudioDocumentSetup | null {
  if (!isRecord(value)) return null;
  const paper = preparePaper(value.paper);
  const margins = prepareMargins(value.margins);
  if (!paper || !margins) return null;
  if (value.orientation !== 'portrait' && value.orientation !== 'landscape') return null;
  const setup: StudioDocumentSetup = {
    paper,
    orientation: value.orientation,
    margins,
    background: typeof value.background === 'string' && isImageDataUrl(value.background) ? value.background : null,
    backgroundFit: value.backgroundFit === 'contain' ? 'contain' : 'cover',
    pageNumbers: value.pageNumbers === true,
  };
  return checkDocumentSetup(setup) === null ? setup : null;
}

function preparePaper(value: unknown): StudioLayoutPaper | null {
  if (!isRecord(value)) return null;
  const builtIn = typeof value.key === 'string' ? findStudioPaper(value.key) : undefined;
  if (builtIn) return { key: builtIn.key, label: builtIn.label, width: builtIn.width, height: builtIn.height };
  const { width, height } = value;
  if (!isWholeNumber(width) || !isWholeNumber(height)) return null;
  if (width > height || width < STUDIO_PAPER_MIN || height > STUDIO_PAPER_MAX) return null;
  const label =
    typeof value.label === 'string' && value.label.trim() !== '' ? value.label.trim().slice(0, 60) : 'Custom';
  return { key: null, label, width, height };
}

function prepareMargins(value: unknown): StudioMargins | null {
  if (!isRecord(value)) return null;
  const { top, right, bottom, left } = value;
  if (!isWholeNumber(top) || !isWholeNumber(right) || !isWholeNumber(bottom) || !isWholeNumber(left)) return null;
  return { top, right, bottom, left };
}

function prepareContent(value: unknown): StudioDocumentContent | null {
  if (!isRecord(value) || !Array.isArray(value.main)) return null;
  const content: StudioDocumentContent = { main: value.main };
  if (Array.isArray(value.header)) content.header = value.header;
  if (Array.isArray(value.footer)) content.footer = value.footer;
  return content;
}

/** A picture held in the text itself. Never a web address: see `prepareDocumentFile`. */
export function isImageDataUrl(value: string): boolean {
  return /^data:image\/(png|jpeg|webp|gif);base64,/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The size a picture goes into the document at, in editor pixels: its own
 * size at the editor's 96 dpi, made smaller to fit inside the margins when it
 * is larger, its shape kept. A phone photo is thousands of pixels across, and
 * placed at its own size it would run far off the page.
 */
export function fitImageToPage(
  image: { width: number; height: number },
  room: { width: number; height: number },
): { width: number; height: number } {
  if (image.width <= 0 || image.height <= 0) return { width: 1, height: 1 };
  const scale = Math.min(1, room.width / image.width, room.height / image.height);
  return { width: Math.max(1, Math.round(image.width * scale)), height: Math.max(1, Math.round(image.height * scale)) };
}

/**
 * The line spacings offered. The editor adds `spacing × 8 px` under each row
 * (its `defaultBasicRowMarginHeight`), so 1 is its ordinary spacing, not
 * Word's "single".
 */
export const STUDIO_LINE_SPACINGS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

/** The pages are drawn for the PDF at this resolution: as sharp as text on an office printer. */
export const STUDIO_DOCUMENT_PRINT_DPI = 300;
