'use client';

import { cn } from '@kwtech/web-ui/react';
import {
  ArrowDownToLine,
  ChevronDown,
  GripVertical,
  ImagePlus,
  Images,
  LayoutTemplate,
  PencilRuler,
  Plus,
  Rows3,
  Square,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  type DragEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { newBackground, type StudioBackground } from '../../domain/background.js';
import { NO_CALIBRATION } from '../../domain/calibration.js';
import {
  addPage,
  filledCellCount,
  fillFromCell,
  planFill,
  type StudioFillMode,
  type StudioPageFill,
  setCellPhoto,
  usedPhotoIds,
} from '../../domain/fill.js';
import {
  borderOf,
  cellOnSheet,
  layoutOnPage,
  printableArea,
  type StudioBorder,
  type StudioLayoutSpec,
  type StudioOrientation,
  sheetSize,
} from '../../domain/layout.js';
import { readingOrder } from '../../domain/place.js';
import {
  DEFAULT_FRAME,
  effectiveDpi,
  frameFlip,
  keepInCell,
  mirrorFrame,
  panFrame,
  resetFrame,
  type StudioFrame,
  type StudioTurn,
  setFreePlacement,
  turnFrame,
  zoomFrameBy,
} from '../../domain/slot-fit.js';
import { undoStates } from '../../domain/undo.js';
import { drawSheet, sheetPixels } from '../render/draw-sheet.js';
import { loadPhoto, releasePhoto, type StudioPhoto } from '../render/photos.js';
import { makeLayoutResult, type StudioResult } from '../render/result.js';
import type { StudioAppState } from '../studio-state.js';
import { useMarquee } from '../use-marquee.js';
import { useStudioData } from '../use-studio-data.js';
import { useStudioKeys } from '../use-studio-keys.js';
import { useUndo } from '../use-undo.js';
import { type PrintKeyContext, printKeyAction, printShortcutBar } from '../view/keys.js';
import { marqueeSelection } from '../view/marquee.js';
import {
  cannotTurnNote,
  otherPaperNote,
  printPage,
  type StudioPrintPage,
  tooSmallPapersWarning,
} from '../view/print-paper.js';
import { paperName, plural } from '../view/summary.js';
import {
  clearedPrintSheet,
  keptSelection,
  newPrintSheet,
  photoEditStep,
  printSheetPhotoIds,
  selectionKey,
  withAddedPhotos,
  withoutPhoto,
} from '../view/undo-steps.js';
import {
  blurryWarning,
  cellsLike,
  filledCells,
  frameOf,
  hasCell,
  NO_PHOTO_EDIT,
  photoBatches,
  previewDpi,
  printLayoutName,
  pruneFrames,
  refitPages,
  removePageFrames,
  resultFileName,
  STUDIO_PHOTO_ACCEPT,
  STUDIO_PHOTOS_MAX,
  type StudioCellRef,
  type StudioFrames,
  type StudioPhotoEdit,
  type StudioPhotoTag,
  setCellsPhoto,
  tagUpload,
  toggleCell,
  withFrame,
  withFrames,
} from '../view/work.js';
import { BackgroundCard, BackgroundMover } from './background-controls.js';
import { BorderControls, borderSummary } from './border-controls.js';
import { buttonClass, INPUT_CLASS } from './controls.js';
import { Alert, StudioSplit } from './layout.js';
import { LayoutEditor, onceEditorTarget } from './layout-editor.js';
import type { ChosenLayout } from './layouts-section.js';
import { OutputBar, type StudioOutputCommands } from './output-bar.js';
import { Pager } from './pager.js';
import { isEdited, PhotoPanel } from './photo-tools.js';
import { SelectionBar } from './selection-bar.js';
import { RulerMenu, useRulerUnit } from './sheet-rulers.js';
import { fitWidth, SheetFrame } from './sheet-view.js';
import { ShortcutBar } from './shortcut-bar.js';
import { UndoButtons } from './undo-buttons.js';

/** How wide, in pixels, the on-screen sheet is drawn. Sharp on a large monitor, quick to redraw as a photo is dragged. */
const PREVIEW_PIXELS = 1000;

/** What a photo is carried as while it is dragged from the tray onto a cell. */
const DRAG_TYPE = 'application/x-kwtech-studio-photo';

/** What a whole batch is carried as while it is dragged from the tray onto the sheet: its batch number. */
const BATCH_DRAG_TYPE = 'application/x-kwtech-studio-batch';

/** How far the pointer must travel, in pixels, before a press on a cell is a drag of its photo and not a click. */
const DRAG_START = 4;

/**
 * The selection's outline on the sheet. ⚠ LITERAL, like the paper under it: the
 * theme's own primary is nearly white on a dark theme and vanishes on a photo.
 */
const SELECTED = '#2563eb';

/**
 * Putting photos into a layout, and getting the result out
 * (PRINT-STUDIO-PLAN §3, "Using a layout").
 *
 * ## ⚠ NOTHING HERE LEAVES THE BROWSER
 *
 * The photos are decoded into this component's memory, the sheets are drawn on
 * a canvas, and the result is a PDF built in the tab. No file is uploaded and
 * none is written to any browser storage. When the component goes — Start
 * over, a change of layout, or the page closing — every photo is released.
 *
 * ## How it is meant to feel (the operator, 2026-10-05: "more user friendly")
 *
 *   - ADD PHOTOS AND IT FILLS. The first photos added go straight into the
 *     cells: one photo into every cell, several one per cell. The arrange
 *     buttons are for changing that, not for getting started.
 *   - THE HAND ON THE PHOTO. Drag a photo inside its cell to move it; the
 *     toolbar above the sheet zooms and turns. Whatever is selected moves
 *     together.
 *   - ONE PRESS TO GET IT OUT. Download and Print make the result themselves.
 *
 * ## One renderer
 *
 * The sheet on screen is `drawSheet`, the same function that draws the result
 * at 300 dpi. Real buttons laid over it take the clicks, the drags and the
 * drops.
 */
export function PhotoStudio({
  state,
  layout,
  onChangeLayout,
  modeSwitch,
}: {
  state: StudioAppState;
  layout: ChosenLayout;
  onChangeLayout: () => void;
  /** The photos-or-document switch, drawn at the top of the settings so it takes no row above the sheet. */
  modeSwitch: ReactNode;
}) {
  /*
   * ⚠ EVERYTHING UNDO TAKES BACK IS ONE SNAPSHOT (issue #52, `StudioPrintSheet`): the photos in the tray and in
   * the cells, each cell's frame, each photo's edits, the border, the paper, the background and the layout as
   * adjusted for this print. One step restores all of it together, so the sheet, its preview and the PDF can
   * never disagree after an Undo. Changed only through `change`, which names the step.
   *
   * The layout as ADJUSTED FOR THIS PRINT, or null while it is as chosen: one customer wants the ID package with
   * a 2 × 2 more. The cells are changed here, in the editor, and the saved layout is never touched (the operator,
   * 2026-10-09). The border and the paper are for THIS print too: they start as the layout says and can be
   * changed without touching it. A fixed layout's cells stay exactly where they were drawn on another paper; a
   * percent layout's are resized to the page (`layoutOnPage`).
   * ⚠ ONLY A PAGE THE CELLS FIT ON CAN BE CHOSEN (`checkLayoutOnPaper`); the rest are shown, disabled, with the
   * reason said under them. Null, or a pick that no longer fits, is as the layout says (`printPage`).
   */
  const work = useUndo(() => newPrintSheet(layout.spec));
  const { change } = work;
  const sheetState = work.present;
  const { adjusted, guides, border, paperValue, orientationValue, pages, frames, edits } = sheetState;
  const [adjusting, setAdjusting] = useState(false);
  const chosen = adjusted ?? layout.spec;
  // ⚠ A layout that was adjusted is no longer the saved one: the history gets no id for it, and a name that says so.
  const layoutId = adjusted ? null : layout.id;
  const layoutName = printLayoutName(layout.name, adjusted !== null && !layout.once);

  const printOn = useMemo(
    () => printPage(chosen, 'mm', paperValue, orientationValue),
    [chosen, paperValue, orientationValue],
  );
  /** The layout as it prints now: its cells on this print's page, with this print's border. */
  const spec = useMemo(
    () => ({
      ...layoutOnPage(chosen, { paper: printOn.paper, orientation: printOn.orientation }),
      guides,
      border,
    }),
    [chosen, printOn, guides, border],
  );
  const cells = spec.cells;
  const sheet = useMemo(() => sheetSize(spec), [spec]);

  /**
   * Every photo decoded on this screen, by id: the tray's, the background's, and any an Undo could bring back.
   * ⚠ A photo is released only once NO step of the history names it (the effect below): one removed from the
   * tray stays decoded while an Undo can still put it back, and goes when that step falls off the history.
   */
  const pool = useRef(new Map<string, StudioPhoto>());
  const photos = useMemo(() => sheetState.photoIds.flatMap((id) => pool.current.get(id) ?? []), [sheetState.photoIds]);
  /** Which upload each photo came in and its number in that selection (`StudioPhotoTag`), shown in the tray. */
  const [photoTags, setPhotoTags] = useState<ReadonlyMap<string, StudioPhotoTag>>(new Map());
  /**
   * The next upload's batch number. Never reused while the photos are held; 1 again after Start over.
   * ⚠ A REF, taken the moment an upload finishes reading: two uploads read at once (a drop while the last is
   * still reading) must never be given one number, which a state read when each began would do.
   */
  const nextBatch = useRef(1);
  const [pageIndex, setPageIndex] = useState(0);
  /**
   * The selected cells, on any page; the last is the one pressed last, and the one the toolbar shows.
   * Every action on the toolbar applies to all of them.
   */
  const [selection, setSelection] = useState<StudioCellRef[]>([]);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [calibrationId, setCalibrationId] = useState('');
  const [copies, setCopies] = useState(1);
  const [result, setResult] = useState<StudioResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** How closely the sheet is being looked at. 1 fits the panel. */
  const [viewZoom, setViewZoom] = useState(1);
  const [rulerUnit, setRulerUnit] = useRulerUnit();
  /*
   * A picture behind every page, for THIS print (the operator, 2026-10-22): decoded like a photo and held like
   * one, never part of the layout. Its place is in sheet coordinates, so it stays put when the paper changes.
   * While `movingBackground` is on, a layer over the sheet takes the presses and the photos are held still.
   */
  const backgroundPhoto = sheetState.background ? pool.current.get(sheetState.background.photoId) : undefined;
  const background = useMemo(
    () =>
      sheetState.background && backgroundPhoto
        ? { photo: backgroundPhoto, placement: sheetState.background.placement }
        : null,
    [sheetState.background, backgroundPhoto],
  );
  const [movingWanted, setMovingBackground] = useState(false);
  const movingBackground = movingWanted && background !== null;
  /*
   * An Undo that takes the picture away ends moving it FOR GOOD: a Redo that brings the picture back must not
   * bring back the layer that takes every press on the sheet (CodeRabbit on #56).
   */
  const hasBackground = sheetState.background !== null;
  useEffect(() => {
    if (!hasBackground) setMovingBackground(false);
  }, [hasBackground]);
  const [loadingBackground, setLoadingBackground] = useState(false);

  const loadCalibrations = useCallback(() => state.client.calibrations(state.scope), [state.client, state.scope]);
  const calibrations = useStudioData(loadCalibrations, 'Could not load the calibration profiles.');
  const calibration = calibrations.data?.find((profile) => profile.id === calibrationId) ?? NO_CALIBRATION;

  const photoMap = useMemo(() => new Map(photos.map((photo) => [photo.id, photo])), [photos]);
  // ⚠ The photo picked in the tray only while it is IN the tray: an Undo can take it out again.
  const pickedId = activePhotoId !== null && photoMap.has(activePhotoId) ? activePhotoId : null;
  const page = pages[pageIndex] ?? [];
  const primary = selection[selection.length - 1] ?? null;
  const cellPhotoId = primary ? (pages[primary.page]?.[primary.cell] ?? null) : null;
  // The photo the adjustments act on: the selected cell's, else the one picked in the tray.
  const toolPhoto = photoMap.get(cellPhotoId ?? pickedId ?? '') ?? null;
  const filled = filledCellCount(pages);
  const filledSelection = filledCells(pages, selection);

  /** The sheet as last rendered or changed, for an upload that finishes after another (`addFiles`). */
  const latestSheet = useRef(sheetState);
  latestSheet.current = sheetState;

  /*
   * ⚠ A PHOTO GOES ONLY WHEN NOTHING CAN BRING IT BACK: none of the history's steps names it. Run after every
   * change, undo and redo. A photo is put in the pool in the same moment the change naming it is made
   * (`addFiles`, `chooseBackground`), so this never sees a photo that is about to be named.
   */
  useEffect(() => {
    const named = new Set(undoStates(work.history).flatMap(printSheetPhotoIds));
    const gone: string[] = [];
    for (const [id, photo] of pool.current) {
      if (named.has(id)) continue;
      releasePhoto(photo);
      pool.current.delete(id);
      gone.push(id);
    }
    if (gone.length === 0) return;
    setPhotoTags((current) => {
      const next = new Map(current);
      for (const id of gone) next.delete(id);
      return next;
    });
  }, [work.history]);

  // ⚠ Every photo is released when the studio goes, whatever made it go.
  useEffect(() => {
    const held = pool.current;
    return () => {
      for (const photo of held.values()) releasePhoto(photo);
      held.clear();
    };
  }, []);

  /*
   * An Undo can take away a page, or the cells of an adjusted layout: the page shown and the selection are kept
   * to what is still there. Any change that removes them does the same, so this is the one place it happens.
   */
  useEffect(() => {
    if (pageIndex > pages.length - 1) setPageIndex(Math.max(pages.length - 1, 0));
    setSelection((current) => keptSelection(current, pages, cells.length));
  }, [pages, pageIndex, cells.length]);

  /*
   * ⚠ A RESULT IS OF THE ARRANGEMENT IT WAS MADE FROM. Change a photo, a frame,
   * the copies or the calibration and the file no longer matches the screen, so
   * it is dropped rather than left to be downloaded as if it did.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the dependencies ARE the arrangement; the effect only reacts to them
  useEffect(() => {
    setResult(null);
  }, [pages, frames, edits, copies, calibration, spec, background]);

  // ── the sheet on screen ───────────────────────────────────────────────────

  const canvas = useRef<HTMLCanvasElement>(null);
  /** The layer of buttons over the sheet: its size on screen is what a drag's pixels are measured against. */
  const overlay = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    // One frame later, so a photo dragged fast redraws once per frame, not once per event.
    const handle = requestAnimationFrame(() => {
      // Looked at closer, it is drawn finer — up to the result's own 300 dpi — so a zoomed photo is not a blur.
      const dpi = previewDpi(sheet, PREVIEW_PIXELS * viewZoom);
      const size = sheetPixels(spec, dpi);
      element.width = size.width;
      element.height = size.height;
      const context = element.getContext('2d');
      if (!context) return;
      drawSheet(context, {
        spec,
        page: pages[pageIndex] ?? [],
        pageIndex,
        frames,
        photos: photoMap,
        edits,
        calibration,
        dpi,
        usePreview: true,
        background,
      });
    });
    return () => cancelAnimationFrame(handle);
  }, [spec, sheet, pages, pageIndex, frames, photoMap, edits, calibration, viewZoom, background]);

  // ── the background picture ────────────────────────────────────────────────

  /** A picture chosen for the background: it fills the printable area, and is ready to be moved. */
  async function chooseBackground(file: File) {
    setLoadingBackground(true);
    setError(null);
    try {
      const photo = await loadPhoto(file);
      // The picture it replaces stays in the pool while an Undo could put it back.
      pool.current.set(photo.id, photo);
      const placement = newBackground({ width: photo.width, height: photo.height }, printableArea(spec));
      change('background', (current) => ({ ...current, background: { photoId: photo.id, placement } }));
      setMovingBackground(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `“${file.name}” could not be read.`);
    } finally {
      setLoadingBackground(false);
    }
  }

  function removeBackground() {
    change('remove background', (current) => ({ ...current, background: null }));
    setMovingBackground(false);
  }

  /** The picture moved, resized or faded: a drag or a slider is one step (`background` is its gesture). */
  function placeBackground(placement: StudioBackground) {
    change(
      'move background',
      (current) => (current.background ? { ...current, background: { ...current.background, placement } } : current),
      'background',
    );
  }

  // ── photos ────────────────────────────────────────────────────────────────

  async function addFiles(files: readonly File[]) {
    if (files.length === 0) return;
    setLoading(true);
    setError(null);
    const added: StudioPhoto[] = [];
    /** Each added photo's place in the files as chosen: its number in this batch. */
    const chosenAt: { id: string; index: number }[] = [];
    const problems: string[] = [];
    const room = STUDIO_PHOTOS_MAX - latestSheet.current.photoIds.length;
    // In order, one at a time: each decode holds a full-size bitmap, and a dozen at once is a dozen in memory.
    for (const [index, file] of files.slice(0, Math.max(room, 0)).entries()) {
      try {
        const photo = await loadPhoto(file);
        added.push(photo);
        chosenAt.push({ id: photo.id, index });
      } catch (caught) {
        problems.push(caught instanceof Error ? caught.message : `“${file.name}” could not be read.`);
      }
    }
    // One upload is one batch; an upload where nothing could be read makes none, so batch numbers have no gap.
    if (added.length > 0) {
      const batch = nextBatch.current;
      nextBatch.current += 1;
      setPhotoTags((current) => new Map([...current, ...tagUpload(chosenAt, batch)]));
    }
    if (files.length > room) problems.push(`Only ${STUDIO_PHOTOS_MAX} photos can be held at once.`);
    if (added.length > 0) {
      const ids = added.map((photo) => photo.id);
      for (const photo of added) pool.current.set(photo.id, photo);
      /*
       * ⚠ ONTO THE SHEET AS IT IS NOW, not as it was when this began: an upload dropped while another was still
       * reading finishes after it, and adding to the older sheet would throw the first upload's photos away.
       * The first photos fill the empty sheet in the same step (`withAddedPhotos`): one Undo takes both back.
       */
      const { sheet: next, dropped } = withAddedPhotos(latestSheet.current, ids, cells);
      latestSheet.current = next;
      change(added.length === 1 ? 'add photo' : 'add photos', (current) => withAddedPhotos(current, ids, cells).sheet);
      if (dropped > 0) problems.push(`${plural(dropped, 'photo')} did not fit in 50 pages.`);
      if (pickedId === null) setActivePhotoId(ids[0] ?? null);
    }
    setError(problems.length > 0 ? problems.join(' ') : null);
    setLoading(false);
  }

  /** Out of the tray and every cell. ⚠ NOT RELEASED HERE: an Undo can bring it back (the pool's effect). */
  function removePhoto(photo: StudioPhoto) {
    change('remove photo', (current) => withoutPhoto(current, photo.id));
  }

  // ── filling ───────────────────────────────────────────────────────────────

  function fill(mode: StudioFillMode) {
    const ids = mode === 'same' ? [pickedId ?? photos[0]?.id ?? ''].filter(Boolean) : photos.map((photo) => photo.id);
    const plan = planFill(cells, ids, mode);
    // A new arrangement: nobody's old zoom carries over to a different photo.
    change(mode === 'manual' ? 'empty every cell' : 'arrange', (current) => ({
      ...current,
      pages: plan.pages,
      frames: {},
    }));
    setPageIndex(0);
    setSelection([]);
    setError(
      plan.dropped > 0
        ? `${plural(plan.dropped, 'photo')} did not fit: a result has at most ${plural(plan.pages.length, 'page')}.`
        : null,
    );
  }

  /**
   * A batch's photos, in the order they were chosen, into the empty cells
   * from a cell onwards (`fillFromCell`). Dropped on a cell, from that cell
   * (the operator, 2026-10-22); dropped elsewhere on the sheet, or by its
   * Place button, from the selected cell, else the first cell of the page in
   * view. The page its first photo went on is shown.
   */
  function placeBatch(batch: number, from: StudioCellRef | null = null) {
    const ids = photoBatches(photos, photoTags)
      .find((group) => group.batch === batch)
      ?.photos.map((entry) => entry.photo.id);
    if (!ids || ids.length === 0) return;
    const start = from ?? primary ?? { page: pageIndex, cell: readingOrder(cells)[0] ?? 0 };
    const plan = fillFromCell(cells, pages, ids, start);
    change('place batch', (current) => ({ ...current, pages: plan.pages }));
    if (plan.firstPage !== null) setPageIndex(plan.firstPage);
    setSelection([]);
    setError(
      plan.dropped > 0
        ? `${plural(plan.dropped, 'photo')} of batch ${batch} did not fit: a result has at most 50 pages.`
        : null,
    );
  }

  /** The batch a drop carries, or null for any other drag. */
  function droppedBatch(event: DragEvent): number | null {
    if (!event.dataTransfer.types.includes(BATCH_DRAG_TYPE)) return null;
    const batch = Number(event.dataTransfer.getData(BATCH_DRAG_TYPE));
    return Number.isInteger(batch) && batch >= 1 ? batch : null;
  }

  /** A batch dropped on the sheet but on no cell (a margin, a gap): from the start of the page in view. */
  function dropBatch(event: DragEvent) {
    const batch = droppedBatch(event);
    if (batch === null) return;
    event.preventDefault();
    placeBatch(batch, { page: pageIndex, cell: readingOrder(cells)[0] ?? 0 });
  }

  function place(cellIndex: number, photoId: string | null) {
    change(photoId === null ? 'empty cell' : 'put photo', (current) => {
      const next = setCellPhoto(current.pages, pageIndex, cellIndex, photoId);
      // A different photo starts centred: the last one's zoom is not its own.
      const framed = pruneFrames(withFrame(current.frames, pageIndex, cellIndex, DEFAULT_FRAME), next);
      return { ...current, pages: next, frames: framed };
    });
  }

  /** One photo into every selected cell, or all of them emptied. Each starts centred again. One step for all. */
  function placeInSelection(photoId: string | null) {
    change(photoId === null ? 'empty cells' : 'put photo', (current) => {
      const next = setCellsPhoto(current.pages, selection, photoId);
      return {
        ...current,
        pages: next,
        frames: pruneFrames(withFrames(current.frames, selection, DEFAULT_FRAME), next),
      };
    });
  }

  /**
   * A plain press selects that cell alone — and, when it is empty, puts the
   * photo picked in the tray into it. With Ctrl, ⌘ or Shift held it only adds
   * the cell to the selection or takes it out: building a selection must not
   * fill cells on the way.
   */
  function pressCell(cellIndex: number, adding: boolean) {
    const ref = { page: pageIndex, cell: cellIndex };
    if (adding) {
      setSelection((current) => toggleCell(current, ref));
      return;
    }
    setSelection([ref]);
    if (!page[cellIndex] && pickedId) place(cellIndex, pickedId);
  }

  function dropOnCell(event: DragEvent, cellIndex: number) {
    // A whole batch, from this cell onwards. ⚠ Stopped here, or the sheet under the cell takes the drop as well.
    const batch = droppedBatch(event);
    if (batch !== null) {
      event.preventDefault();
      event.stopPropagation();
      placeBatch(batch, { page: pageIndex, cell: cellIndex });
      return;
    }
    const photoId = event.dataTransfer.getData(DRAG_TYPE);
    if (!photoId || !photoMap.has(photoId)) return;
    event.preventDefault();
    place(cellIndex, photoId);
    setSelection([{ page: pageIndex, cell: cellIndex }]);
  }

  /**
   * Change the frame of every selected cell that holds a photo, each from its own: ONE step for all of them.
   * `gesture` joins a slider's or a held key's changes into that step; it is keyed by the cells, so the same
   * zoom on other photos is a step of its own.
   */
  function reframe(label: string, update: (frame: StudioFrame) => StudioFrame, gesture?: string) {
    const targets = filledSelection;
    change(
      label,
      (current) => {
        let next = current.frames;
        for (const ref of targets) {
          next = withFrame(next, ref.page, ref.cell, update(frameOf(current.frames, ref.page, ref.cell)));
        }
        return { ...current, frames: next };
      },
      gesture === undefined ? undefined : `${gesture}:${selectionKey(targets)}`,
    );
  }
  /**
   * Every selected photo turned a quarter the way it will LOOK (`turnFrame`): each by its own mirroring, the
   * photo's flip and its cell's mirror together, since a mirror reverses a turn.
   */
  function turnSelection(toward: StudioTurn) {
    const targets = filledSelection;
    change('turn', (current) => {
      let next = current.frames;
      for (const ref of targets) {
        const edit = current.edits.get(current.pages[ref.page]?.[ref.cell] ?? '') ?? NO_PHOTO_EDIT;
        const frame = frameOf(current.frames, ref.page, ref.cell);
        next = withFrame(next, ref.page, ref.cell, turnFrame(frame, toward, photoFlip(edit, frame)));
      }
      return { ...current, frames: next };
    });
  }

  // ── dragging a photo inside its cell ──────────────────────────────────────

  /**
   * A drag in progress: where it began, the sheet units one screen pixel was
   * then, the cell pressed, the frames it began from, and whether it has moved
   * enough to count.
   */
  const drag = useRef<{
    x: number;
    y: number;
    unitsPerPixel: number;
    pressed: number;
    targets: StudioCellRef[];
    from: StudioFrames;
    moved: boolean;
    /** This drag's gesture: every move of it is one undo step, however long the hand rests (`untimed`). */
    gesture: string;
  } | null>(null);
  /** Counts drags, so each has a gesture key of its own and two drags in a row are two steps. */
  const drags = useRef(0);
  /** Set when a press turned into a drag, so the click that follows it is not also a selection. */
  const dragged = useRef(false);

  function beginDrag(event: ReactPointerEvent<HTMLButtonElement>, cellIndex: number) {
    dragged.current = false;
    // With Alt held a drag draws a selection rectangle, even from a photo (`useMarquee`).
    if (event.button !== 0 || event.altKey || !page[cellIndex]) return;
    const ref = { page: pageIndex, cell: cellIndex };
    // Dragging a cell that is part of the selection moves the whole selection; any other cell moves alone.
    const targets = hasCell(selection, ref) ? filledSelection : [ref];
    /*
     * Measured on the SHEET, not the button: a freely placed photo's button is
     * the photo, not its cell, so its size says nothing about the cell's.
     */
    const sheetBox = overlay.current?.getBoundingClientRect();
    if (!sheetBox || !(sheetBox.width > 0)) return;
    drags.current += 1;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      unitsPerPixel: sheet.width / sheetBox.width,
      pressed: cellIndex,
      targets,
      from: frames,
      moved: false,
      gesture: `drag:${drags.current}`,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function duringDrag(event: ReactPointerEvent<HTMLButtonElement>, cellIndex: number) {
    const current = drag.current;
    if (!current) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.moved && Math.hypot(dx, dy) < DRAG_START) return;
    if (!current.moved) {
      current.moved = true;
      dragged.current = true;
      // A drag on an unselected cell selects it, so the toolbar follows the hand.
      const ref = { page: pageIndex, cell: cellIndex };
      if (!hasCell(selection, ref)) setSelection([ref]);
    }
    const pressed = cells[current.pressed];
    if (!pressed) return;
    const across = dx * current.unitsPerPixel;
    const down = dy * current.unitsPerPixel;
    const moves: { ref: StudioCellRef; frame: StudioFrame }[] = [];
    for (const ref of current.targets) {
      const photo = photoMap.get(pages[ref.page]?.[ref.cell] ?? '');
      const cell = cells[ref.cell];
      if (!photo || !cell) continue;
      const edit = edits.get(photo.id) ?? NO_PHOTO_EDIT;
      const start = frameOf(current.from, ref.page, ref.cell);
      /*
       * Covering, the same movement as a share of the PRESSED cell for every
       * photo, each from where it started. Free, the same distance on the
       * sheet: the photo stays under the hand whatever its cell's size.
       */
      const move = start.free
        ? { dx: across / cell.width, dy: down / cell.height }
        : { dx: across / pressed.width, dy: down / pressed.height };
      // Mirrored — the photo's flip and this cell's mirror together — the photo still follows the hand.
      const moved = panFrame(photo, cell, start, move, edit.crop, photoFlip(edit, start));
      moves.push({ ref, frame: keepInCell(photo, cell, moved, edit.crop) });
    }
    change(
      'move photo',
      (sheetNow) => {
        let next = sheetNow.frames;
        for (const { ref, frame } of moves) next = withFrame(next, ref.page, ref.cell, frame);
        return { ...sheetNow, frames: next };
      },
      { key: current.gesture, untimed: true },
    );
  }

  function endDrag() {
    drag.current = null;
  }

  // ── a rectangle dragged over the sheet selects the cells it covers (issue #53) ──

  /** The cells of this page on the sheet, which is what the rectangle is measured in. */
  const cellsOnSheet = useMemo(() => cells.map((cell) => cellOnSheet(spec, cell)), [spec, cells]);
  /** The selection when the rectangle began: what an adding drag adds to, and what Esc puts back. */
  const marqueeBase = useRef<StudioCellRef[]>([]);
  const marquee = useMarquee({
    sheet,
    cells: cellsOnSheet,
    // The background picture being moved takes every press on the sheet.
    enabled: !movingBackground,
    onBegin: () => {
      marqueeBase.current = selection;
    },
    onCover: (covered, adding) => setSelection(marqueeSelection(marqueeBase.current, pageIndex, covered, adding)),
    onCancel: () => setSelection(marqueeBase.current),
    // A click on the paper, on no cell, lets go of the selection — unless it was meant to add to it.
    onPaperClick: (adding) => {
      if (!adding) setSelection([]);
    },
  });

  // ── pages ─────────────────────────────────────────────────────────────────

  function addOnePage() {
    const next = addPage(pages, cells.length);
    if (!next) return setError('A result can have at most 50 pages.');
    change('add page', (current) => ({ ...current, pages: next }));
    setPageIndex(next.length - 1);
  }

  function removeCurrentPage() {
    if (pages.length <= 1) return;
    const next = pages.filter((_page, at) => at !== pageIndex);
    const removed = pageIndex;
    change('remove page', (current) => ({
      ...current,
      pages: next,
      frames: removePageFrames(current.frames, removed),
    }));
    setPageIndex(Math.min(pageIndex, next.length - 1));
    // Page numbers after the removed one all moved: a selection made by number no longer means what it did.
    setSelection([]);
  }

  // ── the result ────────────────────────────────────────────────────────────

  async function make(): Promise<StudioResult> {
    const made = await makeLayoutResult({
      spec,
      pages,
      frames,
      photos: photoMap,
      edits,
      calibration,
      copies,
      background,
    });
    setResult(made);
    return made;
  }

  /**
   * Start over: the photos, the cells and the background go, with this print's layout, border and paper kept.
   * ⚠ IT ALSO ENDS THE UNDO HISTORY. Start over is how the photos are let go of; a history that could bring
   * them back would keep every one of them decoded. It was never undoable, and asks first (`OutputBar`).
   */
  function clearEverything() {
    work.reset(clearedPrintSheet(sheetState, cells));
    setMovingBackground(false);
    setPhotoTags(new Map());
    nextBatch.current = 1;
    setPageIndex(0);
    setSelection([]);
    setActivePhotoId(null);
    setResult(null);
    setError(null);
  }

  /**
   * The editor's cells taken for this print. It was opened on the layout AS IT
   * PRINTS NOW (this print's paper, way round and border), so those are part
   * of what comes back and the choices beside the sheet start again from it.
   * ⚠ THE PHOTOS STAY: they are refitted to the new cells (`refitPages`).
   */
  function applyAdjusted(next: StudioLayoutSpec) {
    const refit = refitPages(pages, next.cells);
    change('adjust layout', (current) => ({
      ...current,
      adjusted: next,
      guides: next.guides,
      border: borderOf(next),
      paperValue: null,
      orientationValue: null,
      pages: refit.pages,
      // Photos that moved to other cells start centred: a frame belongs to a photo IN a cell.
      frames: refit.kept ? current.frames : {},
    }));
    setPageIndex(Math.max(Math.min(pageIndex, refit.pages.length - 1), 0));
    setSelection([]);
    setError(refit.dropped > 0 ? `${plural(refit.dropped, 'photo')} did not fit in 50 pages.` : null);
    setAdjusting(false);
  }

  // ── shortcut keys ─────────────────────────────────────────────────────────

  const root = useRef<HTMLDivElement>(null);
  const output = useRef<StudioOutputCommands | null>(null);
  const keyContext: PrintKeyContext = {
    selected: selection.length,
    filledSelected: filledSelection.length,
    filled,
    photos: photos.length,
    pages: pages.length,
    pageIndex,
    canUndo: work.undoLabel !== null,
    canRedo: work.redoLabel !== null,
  };

  /**
   * Do what a key means right now. The ONE place a key becomes an act — the
   * keyboard and a click on the shortcut bar both come through here, so they
   * cannot disagree. Answers whether it did anything.
   */
  function performKey(key: string): boolean {
    // Esc during a rectangle gives the rectangle up and leaves the selection as it was — it does not also deselect.
    if (key === 'Escape' && marquee.cancel()) return true;
    // Esc ends moving the picture first: the photos are held still until then.
    if (movingBackground && key === 'Escape') {
      setMovingBackground(false);
      return true;
    }
    const action = printKeyAction(key, keyContext, state.keymap);
    if (!action) return false;
    switch (action.kind) {
      case 'empty':
        placeInSelection(null);
        break;
      case 'zoom':
        // A held key repeats: one step for as long as it is held.
        reframe('zoom', (frame) => zoomFrameBy(frame, action.by), 'zoom');
        break;
      case 'turn':
        turnSelection(action.toward);
        break;
      case 'reset':
        reframe('reset', resetFrame);
        break;
      case 'move':
        nudge(action.dx, action.dy);
        break;
      case 'select':
        selectByKey(action.what);
        break;
      case 'arrange':
        fill(action.mode);
        break;
      case 'page':
        setPageIndex(pageIndex + action.by);
        break;
      case 'output':
        output.current?.[action.how]();
        break;
      case 'undo':
        work.undo();
        break;
      case 'redo':
        work.redo();
        break;
    }
    return true;
  }

  /** The arrow keys: every selected photo moved inside its cell by the same share of it. */
  /** A run of nudges, held or pressed in quick succession, is one step (`nudge` is its gesture). */
  function nudge(dx: number, dy: number) {
    const targets = filledSelection;
    change(
      'move photo',
      (current) => {
        let next = current.frames;
        for (const ref of targets) {
          const photo = photoMap.get(current.pages[ref.page]?.[ref.cell] ?? '');
          const cell = cells[ref.cell];
          if (!photo || !cell) continue;
          const edit = current.edits.get(photo.id) ?? NO_PHOTO_EDIT;
          const from = frameOf(current.frames, ref.page, ref.cell);
          const moved = panFrame(photo, cell, from, { dx, dy }, edit.crop, photoFlip(edit, from));
          next = withFrame(next, ref.page, ref.cell, keepInCell(photo, cell, moved, edit.crop));
        }
        return { ...current, frames: next };
      },
      `nudge:${selectionKey(targets)}`,
    );
  }

  /**
   * Free placement on or off for every selected photo, each converted so it
   * stays where it is and as large as it is — only what it may do changes.
   */
  function setFree(free: boolean) {
    const targets = filledSelection;
    change('free placement', (current) => {
      let next = current.frames;
      for (const ref of targets) {
        const photo = photoMap.get(current.pages[ref.page]?.[ref.cell] ?? '');
        const cell = cells[ref.cell];
        if (!photo || !cell) continue;
        const edit = current.edits.get(photo.id) ?? NO_PHOTO_EDIT;
        const from = frameOf(current.frames, ref.page, ref.cell);
        const changed = setFreePlacement(photo, cell, from, free, edit.crop, photoFlip(edit, from));
        next = withFrame(next, ref.page, ref.cell, keepInCell(photo, cell, changed, edit.crop));
      }
      return { ...current, frames: next };
    });
  }

  /** A change from the photo panel: a slider is one step while it moves, a flip a step by itself (`photoEditStep`). */
  function editPhoto(photoId: string, edit: StudioPhotoEdit) {
    const step = photoEditStep(edits.get(photoId) ?? NO_PHOTO_EDIT, edit);
    change(
      step.label,
      (current) => ({ ...current, edits: new Map(current.edits).set(photoId, edit) }),
      step.gesture === null ? undefined : `${step.gesture}:${photoId}`,
    );
  }

  function selectByKey(what: 'photo' | 'all' | 'none') {
    if (what === 'none') return setSelection([]);
    // From the pressed cell when it has a photo; from any filled cell otherwise.
    const from = primary && cellPhotoId ? primary : firstFilled(pages);
    if (from) setSelection(cellsLike(pages, what, from));
  }

  useStudioKeys(root, performKey);

  const selectedPhoto = cellPhotoId ? photoMap.get(cellPhotoId) : undefined;
  const selectedCellSize = primary ? cells[primary.cell] : undefined;
  const selectedFrame = primary ? frameOf(frames, primary.page, primary.cell) : null;
  // The pressed cell, marked on the rulers while it is on the page shown.
  const selectedCell = primary && primary.page === pageIndex ? cells[primary.cell] : undefined;
  const selectedOnSheet = selectedCell ? cellOnSheet(spec, selectedCell) : null;
  const warning =
    selectedPhoto && selectedCellSize && selectedFrame
      ? blurryWarning(
          effectiveDpi(
            selectedPhoto,
            selectedCellSize,
            selectedFrame,
            (edits.get(selectedPhoto.id) ?? NO_PHOTO_EDIT).crop,
          ),
        )
      : null;

  return (
    <>
      {adjusting ? (
        <LayoutEditor
          state={state}
          target={onceEditorTarget(spec, layoutName)}
          purpose={{ kind: 'once', onUse: applyAdjusted }}
          onCancel={() => setAdjusting(false)}
        />
      ) : null}
      {/*
       * ⚠ HIDDEN, NOT UNMOUNTED, under the editor: the sheet's canvas is drawn by an effect that runs when the
       * arrangement changes, and one taken away and put back unchanged (Cancel) would come back blank. Hidden, the
       * shortcut keys go quiet by themselves (`useStudioKeys`).
       */}
      <div ref={root} className={adjusting ? 'hidden' : 'flex min-h-0 flex-1 flex-col gap-3'}>
        <Alert message={error} onDismiss={() => setError(null)} />

        <StudioSplit
          side={
            <>
              {/* ── photos, and how they go in ── */}
              {modeSwitch}
              <section className="flex flex-col gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold">{layoutName}</h3>
                  <p className="truncate text-xs text-muted-foreground">
                    {paperName(spec, 'mm')} · {plural(cells.length, 'cell')}
                  </p>
                </div>
                {/* Two acts that are easy to take for one another, so each says what it is: this layout's cells, or another layout. */}
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    title="Move, resize, add or remove cells for this print only. Your photos stay."
                    className={buttonClass('secondary', 'sm')}
                    onClick={() => setAdjusting(true)}
                  >
                    <PencilRuler aria-hidden="true" className="size-3.5" />
                    Adjust
                  </button>
                  <button
                    type="button"
                    title="Choose another layout. This starts over."
                    className={buttonClass('secondary', 'sm')}
                    onClick={onChangeLayout}
                  >
                    <LayoutTemplate aria-hidden="true" className="size-3.5" />
                    Change
                  </button>
                </div>
                {layout.once || adjusted ? (
                  <p className="text-xs text-muted-foreground">
                    {layout.once
                      ? 'For this print only. It is not saved.'
                      : 'Adjusted for this print only. The saved layout is as it was.'}
                  </p>
                ) : null}
              </section>
              <PaperChoice
                page={printOn}
                onPaper={(value) => change('paper', (current) => ({ ...current, paperValue: value }))}
                onOrientation={(value) => change('orientation', (current) => ({ ...current, orientationValue: value }))}
                otherPaperNote={otherPaperNote(chosen)}
              />
              {layout.foreign ? (
                <p className="-mt-1.5 px-1 text-xs text-muted-foreground">
                  Somebody else made this layout. Its margins were set for their printer and may not suit yours.
                </p>
              ) : null}

              <PhotoTray
                photos={photos}
                tags={photoTags}
                onPlaceBatch={placeBatch}
                activeId={pickedId}
                edits={edits}
                loading={loading}
                onPick={setActivePhotoId}
                onAdd={(files) => void addFiles(files)}
                onRemove={removePhoto}
              />

              {photos.length > 0 ? (
                <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
                  <h3 className="text-sm font-semibold">Arrange them</h3>
                  <div className="grid grid-cols-3 gap-1.5">
                    <FillTile
                      icon={Square}
                      label="Same photo"
                      hint="The picked photo in every cell"
                      onClick={() => fill('same')}
                    />
                    <FillTile
                      icon={Rows3}
                      label="One each"
                      hint="One photo per cell, in order"
                      onClick={() => fill('sequence')}
                    />
                    <FillTile
                      icon={Images}
                      label="Per page"
                      hint="Each photo fills a page of its own"
                      onClick={() => fill('per_page')}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Or drag a photo onto any cell. Press a photo above to pick which one “Same photo” uses.
                  </p>
                  {filled > 0 ? (
                    <button
                      type="button"
                      className={cn(buttonClass('ghost', 'sm'), 'self-start text-muted-foreground')}
                      onClick={() => fill('manual')}
                    >
                      <X aria-hidden="true" className="size-3.5" />
                      Empty every cell
                    </button>
                  ) : null}
                </section>
              ) : null}

              <BorderCard
                guides={guides}
                border={border}
                onGuides={(on) => change('guides', (current) => ({ ...current, guides: on }))}
                // A width slider or a colour being picked sends a change per movement: one step while it moves.
                onBorder={(next) => change('border', (current) => ({ ...current, border: next }), 'border')}
              />

              <BackgroundCard
                photo={background?.photo ?? null}
                placement={background?.placement ?? null}
                area={printableArea(spec)}
                sheet={sheet}
                moving={movingBackground}
                loading={loadingBackground}
                onChoose={(file) => void chooseBackground(file)}
                onRemove={removeBackground}
                onChange={placeBackground}
                onMoving={setMovingBackground}
              />

              {toolPhoto ? (
                <PhotoPanel
                  name={toolPhoto.name}
                  edit={edits.get(toolPhoto.id) ?? NO_PHOTO_EDIT}
                  onChange={(edit) => editPhoto(toolPhoto.id, edit)}
                />
              ) : null}
            </>
          }
          output={
            <OutputBar
              state={state}
              summary={
                filled > 0
                  ? `${plural(pages.length, 'page')} · ${plural(filled, 'photo')} placed`
                  : background
                    ? `${plural(pages.length, 'page')} · the background picture only`
                    : 'Nothing to print yet.'
              }
              copies={copies}
              onCopies={setCopies}
              calibrations={calibrations.data ?? []}
              calibrationId={calibrationId}
              onCalibration={setCalibrationId}
              // A background alone is something to print: a design on its own sheet.
              canMake={filled > 0 || background !== null}
              result={result}
              make={make}
              fileName={resultFileName(layoutName)}
              entry={(made) => ({
                kind: 'layout',
                layoutId,
                layoutName,
                paperLabel: paperName(spec, 'mm'),
                paperWidth: sheet.width,
                paperHeight: sheet.height,
                pages: made.pages,
                copies: made.copies,
                fileNames: [
                  ...usedPhotoIds(pages).flatMap((id) => photoMap.get(id)?.name ?? []),
                  ...(background ? [background.photo.name] : []),
                ],
              })}
              hasWork={photos.length > 0 || background !== null}
              onStartOver={clearEverything}
              onError={setError}
              commands={output}
            />
          }
          footer={
            <ShortcutBar entries={printShortcutBar(keyContext, state.keymap)} onPress={(key) => void performKey(key)} />
          }
        >
          {/* ── the sheet: one card, its toolbar a rail down the left edge and everything else of it the paper ── */}
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            <SelectionBar
              count={selection.length}
              filled={filledSelection.length}
              frame={selectedPhoto ? selectedFrame : null}
              warning={warning}
              pickedPhoto={photoMap.get(pickedId ?? '')?.name ?? null}
              // The slider and a held − / + send a zoom per movement: one step while they move.
              onZoom={(zoom) => reframe('zoom', (frame) => ({ ...frame, zoom }), 'zoom')}
              onTurn={turnSelection}
              onMirror={(axis, on) => reframe('mirror', (frame) => mirrorFrame(frame, axis, on))}
              onReset={() => reframe('reset', resetFrame)}
              onFree={setFree}
              onSelectSamePhoto={
                selectedPhoto && primary ? () => setSelection(cellsLike(pages, 'photo', primary)) : null
              }
              onSelectAll={() => {
                // From the pressed cell when it has a photo; from any filled cell otherwise.
                const from = selectedPhoto && primary ? primary : firstFilled(pages);
                if (from) setSelection(cellsLike(pages, 'all', from));
              }}
              onPut={() => placeInSelection(pickedId)}
              onClear={() => placeInSelection(null)}
              onDone={() => setSelection([])}
              idleHint={
                filled > 0
                  ? 'Press a photo on the sheet to zoom, turn or place it freely: its tools appear here. Drag it to move it.'
                  : 'Add photos on the left and they are placed for you.'
              }
            />

            {/* Around the whole view, so a rectangle can start in the grey beside the paper (`useMarquee`). */}
            <div ref={marquee.container} className="flex min-h-0 min-w-0 flex-1 bg-muted/30" {...marquee.handlers}>
              <SheetFrame
                zoom={viewZoom}
                onZoom={setViewZoom}
                tools={<RulerMenu unit={rulerUnit} onUnit={setRulerUnit} />}
                rulers={{ unit: rulerUnit, sheet, highlight: selectedOnSheet }}
                dock={
                  <>
                    {/* Undo and Redo, always there: disabled with nothing to take back, and saying what they would. */}
                    <UndoButtons
                      undoLabel={work.undoLabel}
                      redoLabel={work.redoLabel}
                      undoKey={state.keymap.undo}
                      redoKey={state.keymap.redo}
                      onUndo={work.undo}
                      onRedo={work.redo}
                    />
                    {pages.length > 1 || filled > 0 ? (
                      <>
                        <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
                        {/* The selection is kept across pages: it may span them ("every cell with this photo"). */}
                        <Pager count={pages.length} current={pageIndex} noun="Page" onChange={setPageIndex} />
                        <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
                        <button type="button" className={buttonClass('ghost', 'sm')} onClick={addOnePage}>
                          <Plus aria-hidden="true" className="size-3.5" />
                          Add a page
                        </button>
                        {pages.length > 1 ? (
                          <button
                            type="button"
                            aria-label={`Remove page ${pageIndex + 1}`}
                            title={`Remove page ${pageIndex + 1}`}
                            className={cn(buttonClass('ghost', 'sm'), 'px-2 text-destructive hover:bg-destructive/10')}
                            onClick={removeCurrentPage}
                          >
                            <Trash2 aria-hidden="true" className="size-3.5" />
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </>
                }
              >
                <section
                  data-studio-paper
                  aria-label="The sheet: drop a batch of photos here"
                  // No text picked and no picture menu while a finger rests to start a rectangle.
                  className="relative select-none shadow-md ring-1 ring-border [-webkit-touch-callout:none]"
                  style={{ width: fitWidth(sheet, viewZoom) }}
                  // A batch dropped on the sheet but on no cell; one dropped on a cell is that cell's (`dropOnCell`).
                  onDragOver={(event) => {
                    if (event.dataTransfer.types.includes(BATCH_DRAG_TYPE)) event.preventDefault();
                  }}
                  onDrop={dropBatch}
                >
                  <canvas ref={canvas} className="block h-auto w-full" />
                  {/*
                   * The cells, as real buttons laid over the drawing: each sits exactly on its cell, by
                   * percentages of the sheet, so the layer scales with the canvas under it.
                   */}
                  <ul
                    ref={overlay}
                    aria-label={`Page ${pageIndex + 1} of ${layoutName}`}
                    className="absolute inset-0 m-0 list-none p-0"
                  >
                    {cells.map((cell, index) => {
                      const photo = photoMap.get(page[index] ?? '');
                      const chosen = hasCell(selection, { page: pageIndex, cell: index });
                      const at = cellOnSheet(spec, cell);
                      return (
                        // Cells never overlap, so a cell's top left names it and no other.
                        <li key={`${cell.x}:${cell.y}`}>
                          <button
                            type="button"
                            aria-label={`Cell ${index + 1}${cell.label ? `, ${cell.label}` : ''}: ${photo ? photo.name : 'empty'}`}
                            aria-pressed={chosen}
                            // What a press landed on, for the selection rectangle (`useMarquee`).
                            data-studio-cell=""
                            data-filled={photo ? '' : undefined}
                            style={{
                              left: `${(at.x / sheet.width) * 100}%`,
                              top: `${(at.y / sheet.height) * 100}%`,
                              width: `${(at.width / sheet.width) * 100}%`,
                              height: `${(at.height / sheet.height) * 100}%`,
                              // A blue line with a white one inside it: seen on a light photo and on a dark one.
                              ...(chosen
                                ? {
                                    outline: `3px solid ${SELECTED}`,
                                    outlineOffset: '-3px',
                                    boxShadow: 'inset 0 0 0 4px #ffffff',
                                  }
                                : {}),
                            }}
                            className={cn(
                              'absolute flex touch-none select-none items-center justify-center text-[0.625rem] font-medium',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              chosen ? 'z-10' : null,
                              photo ? 'cursor-grab active:cursor-grabbing' : null,
                            )}
                            onClick={(event) => {
                              if (dragged.current || marquee.drew()) return;
                              pressCell(index, event.ctrlKey || event.metaKey || event.shiftKey);
                            }}
                            onPointerDown={(event) => beginDrag(event, index)}
                            onPointerMove={(event) => duringDrag(event, index)}
                            onPointerUp={endDrag}
                            onPointerCancel={endDrag}
                            onDragOver={(event) => {
                              const types = event.dataTransfer.types;
                              if (types.includes(DRAG_TYPE) || types.includes(BATCH_DRAG_TYPE)) event.preventDefault();
                            }}
                            onDrop={(event) => dropOnCell(event, index)}
                          >
                            {photo ? null : (
                              // An empty cell, drawn on the white paper: literal colours, as the paper's are.
                              <span
                                // ⚠ `overflow-hidden`: a long label is cut at the cell's edge, never written across the next cell.
                                className="flex size-full items-center justify-center overflow-hidden whitespace-nowrap border border-dashed"
                                style={{
                                  borderColor: SELECTED,
                                  color: SELECTED,
                                  backgroundColor: 'rgba(37, 99, 235, 0.06)',
                                }}
                              >
                                {cell.label ?? ''}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {marquee.rect ? (
                    // The rectangle being drawn, in the selection's own blue: on white paper whatever the theme.
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute z-20"
                      style={{
                        left: `${(marquee.rect.x / sheet.width) * 100}%`,
                        top: `${(marquee.rect.y / sheet.height) * 100}%`,
                        width: `${(marquee.rect.width / sheet.width) * 100}%`,
                        height: `${(marquee.rect.height / sheet.height) * 100}%`,
                        border: `1px solid ${SELECTED}`,
                        backgroundColor: 'rgba(37, 99, 235, 0.12)',
                      }}
                    />
                  ) : null}
                  {background && movingBackground ? (
                    <BackgroundMover
                      placement={background.placement}
                      image={{ width: background.photo.width, height: background.photo.height }}
                      sheet={sheet}
                      onChange={placeBackground}
                      onDone={() => setMovingBackground(false)}
                    />
                  ) : null}
                </section>
              </SheetFrame>
            </div>
          </div>
        </StudioSplit>
      </div>
    </>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────────

/** How a photo is mirrored in one cell: its own flips, then that cell's mirror (`frameFlip`). */
function photoFlip(edit: StudioPhotoEdit, frame: StudioFrame) {
  return frameFlip({ horizontal: edit.flipH, vertical: edit.flipV }, frame);
}

/** Any cell that holds a photo, to start "every photo" from when the pressed cell is empty. */
function firstFilled(pages: readonly StudioPageFill[]): StudioCellRef | null {
  for (let page = 0; page < pages.length; page += 1) {
    const cell = (pages[page] ?? []).findIndex((photo) => photo !== null);
    if (cell >= 0) return { page, cell };
  }
  return null;
}

/**
 * The paper this print goes on, and which way round. Every paper is listed;
 * one the layout's cells do not fit on cannot be picked, and the line under
 * the list says so. Turning the sheet is the same: a way round the cells do
 * not fit is drawn, not pressable, with the reason under it.
 */
function PaperChoice({
  page,
  onPaper,
  onOrientation,
  otherPaperNote: note,
}: {
  page: StudioPrintPage;
  onPaper: (value: string) => void;
  onOrientation: (orientation: StudioOrientation) => void;
  /** What printing on another page does to this layout, shown once another paper or way round is chosen. */
  otherPaperNote: string;
}) {
  const inputId = useId();
  const noteId = useId();
  const warnings = [tooSmallPapersWarning(page.paperOptions), cannotTurnNote(page.orientationOptions)].filter(
    (warning) => warning !== null,
  );
  return (
    <section className="flex flex-col gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5">
      <label htmlFor={inputId} className="text-xs font-medium text-muted-foreground">
        Paper for this print
      </label>
      <select
        id={inputId}
        className={cn(INPUT_CLASS, 'h-9')}
        value={page.paperValue}
        aria-describedby={noteId}
        onChange={(event) => onPaper(event.target.value)}
      >
        {page.paperOptions.map((option) => (
          <option key={option.value} value={option.value} disabled={!option.fits}>
            {option.label}
          </option>
        ))}
      </select>
      <fieldset className="flex min-w-0 rounded-lg border border-border bg-background p-0.5" aria-describedby={noteId}>
        <legend className="sr-only">Orientation for this print</legend>
        {page.orientationOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === page.orientation}
            disabled={!option.fits}
            className={cn(
              'h-8 min-w-0 flex-1 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
              option.value === page.orientation
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground enabled:hover:bg-accent',
            )}
            onClick={() => onOrientation(option.value)}
          >
            {option.label}
          </button>
        ))}
      </fieldset>
      <div id={noteId} className="flex flex-col gap-1">
        {page.changed ? <p className="text-xs text-muted-foreground">{note}</p> : null}
        {warnings.map((warning) => (
          <p key={warning} className="flex items-start gap-1.5 text-xs">
            <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-status-warning text-status-warning-foreground">
              <TriangleAlert aria-hidden="true" className="size-2.5" />
            </span>
            {warning}
          </p>
        ))}
      </div>
    </section>
  );
}

/** The border for this print, folded to one line until wanted. */
function BorderCard({
  guides,
  border,
  onGuides,
  onBorder,
}: {
  guides: boolean;
  border: StudioBorder;
  onGuides: (guides: boolean) => void;
  onBorder: (border: StudioBorder) => void;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <section className="rounded-xl border border-border bg-card">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen(!open)}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Border to cut along</span>
          <span className="block truncate text-xs text-muted-foreground">{borderSummary(guides, border)}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open ? 'rotate-180' : null)}
        />
      </button>
      {open ? (
        <div id={bodyId} className="border-t border-border p-3">
          <BorderControls on={guides} border={border} onOn={onGuides} onBorder={onBorder} />
        </div>
      ) : null}
    </section>
  );
}

/** One way of arranging the photos, as a tile: an icon and two words, with the long version on hover. */
function FillTile({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: typeof Square;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={hint}
      className="flex flex-col items-center gap-1 rounded-lg border border-border bg-background px-1 py-2 text-center text-xs font-medium transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onClick}
    >
      <Icon aria-hidden="true" className="size-4 text-primary" />
      {label}
      <span className="sr-only">: {hint}</span>
    </button>
  );
}

/**
 * The chosen photos. Press one to pick it — it is the one "Same photo" and
 * empty cells use; drag one onto a cell to put it there.
 */
function PhotoTray({
  photos,
  tags,
  onPlaceBatch,
  activeId,
  edits,
  loading,
  onPick,
  onAdd,
  onRemove,
}: {
  photos: readonly StudioPhoto[];
  /** Each photo's batch and number (`photoBatches`). */
  tags: ReadonlyMap<string, StudioPhotoTag>;
  /** A batch into the empty cells from a cell onwards: its press starts at the selected cell, or the first of the page. */
  onPlaceBatch: (batch: number) => void;
  activeId: string | null;
  edits: ReadonlyMap<string, StudioPhotoEdit>;
  loading: boolean;
  onPick: (id: string) => void;
  onAdd: (files: File[]) => void;
  onRemove: (photo: StudioPhoto) => void;
}) {
  const inputId = useId();
  const [over, setOver] = useState(false);
  const empty = photos.length === 0;
  return (
    <section
      aria-label="Photos"
      className={cn(
        'flex flex-col gap-2 rounded-xl border bg-card p-3 transition-colors',
        over ? 'border-primary bg-accent/40' : 'border-border',
      )}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setOver(false);
        onAdd([...event.dataTransfer.files]);
      }}
    >
      <input
        id={inputId}
        type="file"
        multiple
        accept={STUDIO_PHOTO_ACCEPT}
        className="sr-only"
        disabled={loading}
        onChange={(event) => {
          onAdd([...(event.target.files ?? [])]);
          // So choosing the same file again is still a change.
          event.target.value = '';
        }}
      />
      {empty ? (
        // Before any photo: the whole card is the way in.
        <label
          htmlFor={inputId}
          className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border px-3 py-6 text-center transition-colors hover:border-primary hover:bg-accent/40"
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <ImagePlus aria-hidden="true" className="size-5" />
          </span>
          <span className="text-sm font-semibold">{loading ? 'Reading…' : 'Add photos'}</span>
          <span className="text-xs text-muted-foreground">
            Press here or drop photos in. They stay on this computer — nothing is uploaded or saved.
          </span>
        </label>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Photos ({photos.length})</h3>
            <label htmlFor={inputId} className={cn(buttonClass('secondary', 'sm'), 'cursor-pointer')}>
              <ImagePlus aria-hidden="true" className="size-3.5" />
              {loading ? 'Reading…' : 'Add more'}
            </label>
          </div>
          {/*
           * One group per upload (the operator, 2026-10-22): "Batch 2" is the second time photos were added, and
           * each photo's number is its place in that selection, so the tray can be checked against the folder.
           */}
          <div className="flex max-h-72 flex-col gap-2.5 overflow-y-auto pr-0.5">
            {photoBatches(photos, tags).map((group) => (
              <section key={group.batch} aria-label={group.batch === 0 ? 'Other photos' : `Batch ${group.batch}`}>
                {group.batch === 0 ? (
                  <h4 className="mb-1 text-xs font-semibold">Other photos</h4>
                ) : (
                  /*
                   * The header is the handle for the whole batch: drag it onto the sheet, or press Place. Either
                   * puts its photos, in order, into the empty cells from the cell it is dropped on, or the selected one.
                   */
                  <button
                    type="button"
                    draggable
                    title="Drag onto a cell to fill the empty cells from there, in order. Press to start at the selected cell, or the first cell of this page"
                    className="group/batch mb-1 flex w-full cursor-grab items-center gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                    onClick={() => onPlaceBatch(group.batch)}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(BATCH_DRAG_TYPE, String(group.batch));
                      event.dataTransfer.effectAllowed = 'copy';
                    }}
                  >
                    <GripVertical aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/70" />
                    <span className="min-w-0 flex-1 text-xs font-semibold">
                      Batch {group.batch}{' '}
                      <span className="font-normal text-muted-foreground">
                        · {plural(group.photos.length, 'photo')}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-[0.6875rem] font-medium text-muted-foreground group-hover/batch:text-primary">
                      <ArrowDownToLine aria-hidden="true" className="size-3.5" />
                      Place
                    </span>
                  </button>
                )}
                <ul className="grid grid-cols-4 gap-1.5">
                  {group.photos.map(({ photo, number }) => (
                    <li key={photo.id} className="group relative">
                      <button
                        type="button"
                        draggable
                        aria-pressed={photo.id === activeId}
                        aria-label={number > 0 ? `${number}. ${photo.name}` : photo.name}
                        title={number > 0 ? `${number}. ${photo.name}` : photo.name}
                        className={cn(
                          'block aspect-square w-full overflow-hidden rounded-lg border-2 bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          photo.id === activeId ? 'border-primary' : 'border-transparent hover:border-border',
                        )}
                        onClick={() => onPick(photo.id)}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(DRAG_TYPE, photo.id);
                          event.dataTransfer.effectAllowed = 'copy';
                        }}
                      >
                        <img src={photo.url} alt="" className="size-full object-cover" draggable={false} />
                      </button>
                      {number > 0 ? (
                        // Its place in the files as chosen, readable on a light photo and a dark one.
                        <span className="pointer-events-none absolute top-1 left-1 min-w-4 rounded bg-card/90 px-1 text-center text-[0.625rem] font-semibold tabular-nums text-foreground shadow-sm ring-1 ring-border">
                          {number}
                        </span>
                      ) : null}
                      {isEdited(edits.get(photo.id)) ? (
                        <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-primary px-1 text-[0.5625rem] font-medium text-primary-foreground">
                          Edited
                        </span>
                      ) : null}
                      <button
                        type="button"
                        aria-label={`Remove ${photo.name}`}
                        className="absolute top-0.5 right-0.5 hidden size-5 items-center justify-center rounded-full bg-card text-foreground shadow-sm ring-1 ring-border group-focus-within:flex group-hover:flex"
                        onClick={() => onRemove(photo)}
                      >
                        <X aria-hidden="true" className="size-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
