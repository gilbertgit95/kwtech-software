import { NEUTRAL_LIGHTING, type StudioLighting } from '../../domain/adjust.js';
import { planFill, type StudioFillPlan, type StudioPageFill, usedPhotoIds } from '../../domain/fill.js';
import type { StudioRect, StudioSize } from '../../domain/layout.js';
import { DEFAULT_FRAME, FULL_CROP, type StudioCrop, type StudioFrame } from '../../domain/slot-fit.js';
import { STUDIO_BLURRY_DPI, UNITS_PER_INCH } from '../../domain/units.js';

/**
 * The work in progress on the Print screen, as plain data: which photo is in
 * which cell, how each cell frames its photo, and how each photo was edited.
 *
 * ⚠ NONE OF THIS IS EVER SAVED OR SENT. It lives in the component's state and
 * goes when the person presses Done or closes the page (PRINT-STUDIO-PLAN
 * decision 8).
 */

/** What was done to a PHOTO. Every cell holding it follows. */
export interface StudioPhotoEdit {
  crop: StudioCrop;
  flipH: boolean;
  flipV: boolean;
  lighting: StudioLighting;
}

export const NO_PHOTO_EDIT: StudioPhotoEdit = {
  crop: FULL_CROP,
  flipH: false,
  flipV: false,
  lighting: NEUTRAL_LIGHTING,
};

/** How each cell of each page frames its photo, keyed by `frameKey`. An absent key is the default frame. */
export type StudioFrames = Readonly<Record<string, StudioFrame>>;

export function frameKey(page: number, cell: number): string {
  return `${page}:${cell}`;
}

export function frameOf(frames: StudioFrames, page: number, cell: number): StudioFrame {
  return frames[frameKey(page, cell)] ?? DEFAULT_FRAME;
}

export function withFrame(frames: StudioFrames, page: number, cell: number, frame: StudioFrame): StudioFrames {
  return { ...frames, [frameKey(page, cell)]: frame };
}

/**
 * One cell of one page — what a selection is made of.
 *
 * ⚠ SEVERAL CELLS CAN BE SELECTED, and every action on the panel applies to
 * all of them (the operator, 2026-10-05). A selection may span pages: "every
 * cell with this photo" reaches the photo wherever it was placed.
 */
export interface StudioCellRef {
  page: number;
  cell: number;
}

export function hasCell(selection: readonly StudioCellRef[], ref: StudioCellRef): boolean {
  return selection.some((one) => one.page === ref.page && one.cell === ref.cell);
}

/**
 * A cell added to the selection, or taken out if it was in — what a
 * Ctrl-click does. Added LAST, so the cell just pressed is the one the panel
 * shows the frame of.
 */
export function toggleCell(selection: readonly StudioCellRef[], ref: StudioCellRef): StudioCellRef[] {
  const without = selection.filter((one) => one.page !== ref.page || one.cell !== ref.cell);
  return without.length === selection.length ? [...selection, ref] : without;
}

/**
 *   photo — every cell, on every page, holding the SAME photo as `at`.
 *   all   — every filled cell on every page.
 */
export type StudioSelectKind = 'photo' | 'all';

/**
 * The cells a quick selection picks, with `at` kept last so it stays the one
 * the panel shows. Empty when `at` holds no photo: "the same photo as an empty
 * cell" is nothing.
 */
export function cellsLike(
  pages: readonly StudioPageFill[],
  kind: StudioSelectKind,
  at: StudioCellRef,
): StudioCellRef[] {
  const chosen = pages[at.page]?.[at.cell] ?? null;
  if (chosen === null) return [];

  const others: StudioCellRef[] = [];
  for (let page = 0; page < pages.length; page += 1) {
    const fill = pages[page] ?? [];
    for (let cell = 0; cell < fill.length; cell += 1) {
      const photo = fill[cell] ?? null;
      if (photo === null || (page === at.page && cell === at.cell)) continue;
      if (kind === 'all' || photo === chosen) others.push({ page, cell });
    }
  }
  return [...others, at];
}

/** The selected cells that hold a photo — the ones a framing change has anything to change in. */
export function filledCells(pages: readonly StudioPageFill[], selection: readonly StudioCellRef[]): StudioCellRef[] {
  return selection.filter((ref) => (pages[ref.page]?.[ref.cell] ?? null) !== null);
}

/** The selection, less any cell on a page that is no longer there. */
export function pruneSelection(selection: readonly StudioCellRef[], pages: readonly StudioPageFill[]): StudioCellRef[] {
  return selection.filter((ref) => ref.cell < (pages[ref.page]?.length ?? 0));
}

/** One photo put in several cells at once, or all of them emptied with null. */
export function setCellsPhoto(
  pages: readonly StudioPageFill[],
  refs: readonly StudioCellRef[],
  photoId: string | null,
): StudioPageFill[] {
  return pages.map((fill, page) => fill.map((current, cell) => (hasCell(refs, { page, cell }) ? photoId : current)));
}

/** One frame given to several cells at once. */
export function withFrames(frames: StudioFrames, targets: readonly StudioCellRef[], frame: StudioFrame): StudioFrames {
  const next: Record<string, StudioFrame> = { ...frames };
  for (const target of targets) next[frameKey(target.page, target.cell)] = frame;
  return next;
}

/**
 * The frames that still belong to something after the pages changed: a frame
 * for a cell that is now empty, or on a page that is gone, is dropped — so a
 * photo placed there later starts centred rather than inheriting a stranger's
 * zoom.
 */
export function pruneFrames(frames: StudioFrames, pages: readonly StudioPageFill[]): StudioFrames {
  const kept: Record<string, StudioFrame> = {};
  for (const [key, frame] of Object.entries(frames)) {
    const [page, cell] = key.split(':').map(Number);
    if (page === undefined || cell === undefined) continue;
    if (pages[page]?.[cell]) kept[key] = frame;
  }
  return kept;
}

/**
 * The frames after one page is taken out: that page's are dropped, and every
 * later page's move down one — a frame is keyed by its page's NUMBER, and the
 * pages after the removed one each just became the one before.
 */
export function removePageFrames(frames: StudioFrames, removedPage: number): StudioFrames {
  const kept: Record<string, StudioFrame> = {};
  for (const [key, frame] of Object.entries(frames)) {
    const [page, cell] = key.split(':').map(Number);
    if (page === undefined || cell === undefined || page === removedPage) continue;
    kept[frameKey(page > removedPage ? page - 1 : page, cell)] = frame;
  }
  return kept;
}

/**
 * What a layout made on the Print screen for ONE print is called: on the
 * screen, in the print history and as the result's file name. It has no name
 * of its own because nobody is asked for one (the operator, 2026-10-09: a
 * layout used once should not have to be made, named and kept).
 */
export const STUDIO_ONCE_LAYOUT_NAME = 'One-time layout';

/**
 * The name a print goes under. A saved layout or a preset that was adjusted
 * for this print says so: the history must not claim the sheet was the saved
 * layout when its cells were moved for the day.
 */
export function printLayoutName(name: string, adjusted: boolean): string {
  return adjusted ? `${name}, adjusted` : name;
}

/** The pages after a layout was adjusted under them, and whether the arrangement survived as it was. */
export interface StudioRefit extends StudioFillPlan {
  /** True when every photo is still in the cell it was in, so each cell's frame still belongs to its photo. */
  kept: boolean;
}

/**
 * The photos placed, carried over to a layout whose cells were just changed
 * for this print, so adjusting a layout never costs the photos already chosen.
 *
 *   - The same NUMBER of cells (one was moved or resized): nothing moves.
 *     A page names its cells by index, and every index still has a cell.
 *   - Otherwise, when no page mixed photos (the same photo in every cell, or
 *     one customer per page): each page keeps its photo, in every new cell.
 *   - Otherwise: the photos in use, one per cell in reading order, as when
 *     they were first added.
 *
 * ⚠ ONLY PHOTOS THAT WERE PLACED come back. One taken out of every cell by
 * hand stays in the tray; putting it back on the sheet would undo that.
 */
export function refitPages(pages: readonly StudioPageFill[], cells: readonly StudioRect[]): StudioRefit {
  if (pages.length > 0 && pages.every((page) => page.length === cells.length)) {
    return { pages: pages.map((page) => [...page]), dropped: 0, kept: true };
  }
  const used = usedPhotoIds(pages);
  if (used.length === 0) return { ...planFill(cells, [], 'manual'), kept: false };

  const perPage = pages.map((page) => usedPhotoIds([page]));
  if (perPage.every((photos) => photos.length <= 1)) {
    const refilled = perPage.map((photos): StudioPageFill => cells.map(() => photos[0] ?? null));
    return { pages: refilled, dropped: 0, kept: false };
  }
  return { ...planFill(cells, used, 'sequence'), kept: false };
}

/**
 * How far the sheet on screen can be enlarged: 1 is "fits the panel", and each
 * step up shows it larger, scrolling inside the panel. For placing cells and
 * photos precisely — it changes nothing about the layout or the result.
 */
export const STUDIO_VIEW_ZOOMS = [1, 1.5, 2, 3, 4, 6] as const;

/** The next zoom step up (`direction` 1) or down (−1) from where the view is. Stops at either end. */
export function stepViewZoom(zoom: number, direction: 1 | -1): number {
  const steps: readonly number[] = STUDIO_VIEW_ZOOMS;
  if (direction === 1) return steps.find((step) => step > zoom + 0.001) ?? steps[steps.length - 1] ?? 1;
  return [...steps].reverse().find((step) => step < zoom - 0.001) ?? steps[0] ?? 1;
}

/**
 * The resolution to draw the on-screen preview at, in dots per inch: enough
 * for the sheet to be about `targetPixels` wide. The result is always drawn at
 * 300; the preview only has to look right at the size it is shown.
 */
export function previewDpi(sheet: StudioSize, targetPixels: number): number {
  const widthInches = sheet.width / UNITS_PER_INCH;
  if (!(widthInches > 0)) return 72;
  return Math.min(Math.max(targetPixels / widthInches, 24), 300);
}

/** Whether a photo will print soft in its cell, said only when it will. */
export function blurryWarning(dpi: number): string | null {
  if (!(dpi < STUDIO_BLURRY_DPI)) return null;
  return `This photo has only ${Math.round(dpi)} dots per inch at this size and may print blurry. Use a larger photo, or a smaller cell.`;
}

/**
 * The name the result file is saved under: the layout's name made safe for a
 * file system, or "print" when nothing usable is left.
 *
 * ⚠ NO DATE AND NO CUSTOMER NAME ARE ADDED. The file lands in the computer's
 * Downloads folder, outside this app's reach; the less it says, the less is
 * left lying there.
 */
export function resultFileName(layoutName: string): string {
  const safe = layoutName
    .normalize('NFKD')
    .replace(/[^\w\s×x.-]/gu, '')
    .replace(/×/gu, 'x')
    .trim()
    .replace(/\s+/gu, '-')
    .slice(0, 60)
    .replace(/^[-.]+|[-.]+$/gu, '');
  return `${safe || 'print'}.pdf`;
}

/**
 * The file types the photo picker offers. HEIC by extension too: browsers often give it no type.
 *
 * ⚠ `.jfif` IS THE MOST COMMON FILE THE SHOP GETS (the operator, 2026-10-06): it is what a photo downloaded from
 * Messenger is saved as. It is a JPEG under another extension, and often arrives with no type at all, so it is named
 * here and matched by extension in `isPhotoFile` — drop it from either and most customers' photos are refused. ⚠ A GIF IS A STILL HERE: the browser decodes its first frame, and that is what prints.
 */
export const STUDIO_PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.jfif,.heic,.heif';

/** Whether a file is one the studio can lay out as a photo. */
export function isPhotoFile(file: { name: string; type: string }): boolean {
  if (/^image\/(jpeg|png|webp|gif|heic|heif)$/iu.test(file.type)) return true;
  return /\.(jpe?g|jfif|png|webp|gif|heic|heif)$/iu.test(file.name);
}

export function isHeicFile(file: { name: string; type: string }): boolean {
  return /^image\/hei[cf]$/iu.test(file.type) || /\.hei[cf]$/iu.test(file.name);
}

export function isPdfFile(file: { name: string; type: string }): boolean {
  return file.type === 'application/pdf' || /\.pdf$/iu.test(file.name);
}

/**
 * The largest photo the studio loads, in pixels. 80 megapixels is past any
 * phone or camera a shop sees; beyond it a decoded photo alone is hundreds of
 * megabytes, and the tab dies without saying why.
 */
export const STUDIO_PHOTO_PIXELS_MAX = 80_000_000;

/** The most photos held at once. Each is a decoded bitmap in memory. */
export const STUDIO_PHOTOS_MAX = 200;
