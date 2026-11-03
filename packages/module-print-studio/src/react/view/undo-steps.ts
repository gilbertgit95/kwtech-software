import type { StudioBackground } from '../../domain/background.js';
import { filledCellCount, planFill, type StudioPageFill } from '../../domain/fill.js';
import {
  borderOf,
  type StudioBorder,
  type StudioLayoutSpec,
  type StudioOrientation,
  type StudioPagePatch,
  type StudioRect,
} from '../../domain/layout.js';
import { pruneFrames, type StudioCellRef, type StudioFrames, type StudioPhotoEdit } from './work.js';

/**
 * What one step of undo holds on each screen, and what each step is called
 * (issue #52). The history itself is `domain/undo.ts`; this is what goes in it.
 */

// ── the Print screen ─────────────────────────────────────────────────────────

/**
 * Everything on the Print screen that Undo takes back, in ONE snapshot, so a
 * step restores all of it together.
 *
 * ⚠ PHOTOS ARE HELD BY ID, NEVER COPIED. The decoded photos live beside the
 * history (the screen's pool) and a snapshot only names them. A hundred steps
 * cost a hundred small objects, not a hundred bitmaps.
 *
 * Not in it, because none of it is a change to the sheet: the selection, the
 * page shown, the view's zoom, the photo picked in the tray, the copies and
 * the calibration.
 */
export interface StudioPrintSheet {
  /** The layout as adjusted for this print, or null while it is as chosen. */
  adjusted: StudioLayoutSpec | null;
  guides: boolean;
  border: StudioBorder;
  /** The paper and the way round picked for this print; null is as the layout says (`printPage`). */
  paperValue: string | null;
  orientationValue: StudioOrientation | null;
  /** The photos in the tray, in the order they were added. */
  photoIds: readonly string[];
  pages: StudioPageFill[];
  frames: StudioFrames;
  edits: ReadonlyMap<string, StudioPhotoEdit>;
  /** The picture behind every page, by its photo's id. */
  background: { photoId: string; placement: StudioBackground } | null;
}

/** The sheet as a layout starts it: the layout's own border and paper, and every cell empty. */
export function newPrintSheet(spec: StudioLayoutSpec): StudioPrintSheet {
  return {
    adjusted: null,
    guides: spec.guides,
    border: borderOf(spec),
    paperValue: null,
    orientationValue: null,
    photoIds: [],
    pages: planFill(spec.cells, [], 'manual').pages,
    frames: {},
    edits: new Map(),
    background: null,
  };
}

/** Start over: no photos and no background, with this print's layout, border and paper kept. */
export function clearedPrintSheet(sheet: StudioPrintSheet, cells: readonly StudioRect[]): StudioPrintSheet {
  return {
    ...sheet,
    photoIds: [],
    pages: planFill(cells, [], 'manual').pages,
    frames: {},
    edits: new Map(),
    background: null,
  };
}

/** Every photo a snapshot refers to: the tray's and the background's. A photo none refers to can be released. */
export function printSheetPhotoIds(sheet: StudioPrintSheet): string[] {
  return sheet.background ? [...sheet.photoIds, sheet.background.photoId] : [...sheet.photoIds];
}

/**
 * Photos added to the tray. ⚠ THE FIRST PHOTOS FILL THE SHEET BY THEMSELVES,
 * as they always have, and in the same step, so one Undo takes back the
 * upload and the filling together: one photo into every cell, several one
 * each. Once anything has been placed, adding photos never rearranges it.
 */
export function withAddedPhotos(
  sheet: StudioPrintSheet,
  ids: readonly string[],
  cells: readonly StudioRect[],
): { sheet: StudioPrintSheet; dropped: number } {
  if (ids.length === 0) return { sheet, dropped: 0 };
  const photoIds = [...sheet.photoIds, ...ids];
  if (filledCellCount(sheet.pages) > 0) return { sheet: { ...sheet, photoIds }, dropped: 0 };
  const plan = planFill(cells, photoIds, photoIds.length === 1 ? 'same' : 'sequence');
  return { sheet: { ...sheet, photoIds, pages: plan.pages, frames: {} }, dropped: plan.dropped };
}

/** A photo taken out of the tray and every cell it was in. Its edit is kept, for an Undo that brings it back. */
export function withoutPhoto(sheet: StudioPrintSheet, photoId: string): StudioPrintSheet {
  const pages = sheet.pages.map((page) => page.map((id) => (id === photoId ? null : id)));
  return {
    ...sheet,
    photoIds: sheet.photoIds.filter((id) => id !== photoId),
    pages,
    frames: pruneFrames(sheet.frames, pages),
  };
}

/**
 * The selection after an undo or a redo: only cells that are still there.
 * An Undo can take away a page or a layout's cells. A selection that still
 * named them would act on nothing. Returns the same array when nothing went,
 * so a state set with it does not re-render.
 */
export function keptSelection(
  selection: StudioCellRef[],
  pages: readonly StudioPageFill[],
  cellCount: number,
): StudioCellRef[] {
  const kept = selection.filter((ref) => ref.page < pages.length && ref.cell < cellCount);
  return kept.length === selection.length ? selection : kept;
}

/**
 * Which cells a change to the selection acts on, as part of a gesture's key,
 * so a held zoom on these photos and then on others is two steps, not one.
 */
export function selectionKey(refs: readonly StudioCellRef[]): string {
  return refs.map((ref) => `${ref.page}:${ref.cell}`).join(',');
}

/**
 * What a change from the photo panel is called, and the gesture it belongs
 * to. A slider (the lighting, the crop) is a gesture: moving it is one step.
 * A flip is a press, a step by itself, so two quick flips are two undos.
 */
export function photoEditStep(
  before: StudioPhotoEdit,
  after: StudioPhotoEdit,
): { label: string; gesture: 'lighting' | 'crop' | null } {
  if (before.flipH !== after.flipH || before.flipV !== after.flipV) {
    const lighting = before.lighting !== after.lighting || before.crop !== after.crop;
    // Both at once is the panel's reset, which puts everything back.
    return lighting ? { label: 'reset edits', gesture: null } : { label: 'flip', gesture: null };
  }
  if (before.crop !== after.crop && before.lighting !== after.lighting) return { label: 'reset edits', gesture: null };
  if (before.crop !== after.crop) return { label: 'crop', gesture: 'crop' };
  return { label: 'colour', gesture: 'lighting' };
}

// ── the layout editor ────────────────────────────────────────────────────────

/** What a change to the page in the layout editor is called. */
export function pageChangeLabel(patch: StudioPagePatch): string {
  if (patch.paper) return 'paper';
  if (patch.orientation) return 'orientation';
  return 'margins';
}

/** What Undo and Redo say: "Undo: zoom", or that there is nothing. */
export function undoButtonLabel(kind: 'undo' | 'redo', label: string | null): string {
  const verb = kind === 'undo' ? 'Undo' : 'Redo';
  return label === null ? `Nothing to ${verb.toLowerCase()}` : `${verb}: ${label}`;
}
