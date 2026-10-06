'use client';

import { cn } from '@kwtech/web-ui/react';
import {
  ChevronDown,
  ImagePlus,
  Images,
  LayoutTemplate,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  Rows3,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { NO_CALIBRATION } from '../../domain/calibration.js';
import {
  addPage,
  filledCellCount,
  planFill,
  type StudioFillMode,
  type StudioPageFill,
  setCellPhoto,
  usedPhotoIds,
} from '../../domain/fill.js';
import { borderOf, printableArea, type StudioBorder, sheetSize } from '../../domain/layout.js';
import {
  DEFAULT_FRAME,
  effectiveDpi,
  nextRotation,
  panFrame,
  STUDIO_ZOOM_MAX,
  type StudioFrame,
} from '../../domain/slot-fit.js';
import { drawSheet, sheetPixels } from '../render/draw-sheet.js';
import { loadPhoto, releasePhoto, type StudioPhoto } from '../render/photos.js';
import { makeLayoutResult, type StudioResult } from '../render/result.js';
import type { StudioAppState } from '../studio-state.js';
import { useStudioData } from '../use-studio-data.js';
import { useStudioKeys } from '../use-studio-keys.js';
import { type PrintKeyContext, printKeyAction, printShortcutBar } from '../view/keys.js';
import { paperName, plural } from '../view/summary.js';
import {
  blurryWarning,
  cellsLike,
  filledCells,
  frameOf,
  hasCell,
  NO_PHOTO_EDIT,
  previewDpi,
  pruneFrames,
  removePageFrames,
  resultFileName,
  STUDIO_PHOTO_ACCEPT,
  STUDIO_PHOTOS_MAX,
  type StudioCellRef,
  type StudioFrames,
  type StudioPhotoEdit,
  setCellsPhoto,
  toggleCell,
  withFrame,
  withFrames,
} from '../view/work.js';
import { BorderControls, borderSummary } from './border-controls.js';
import { buttonClass } from './controls.js';
import { Alert } from './layout.js';
import type { ChosenLayout } from './layouts-section.js';
import { OutputBar, type StudioOutputCommands } from './output-bar.js';
import { isEdited, PhotoPanel } from './photo-tools.js';
import { fitWidth, SheetFrame } from './sheet-view.js';
import { ShortcutBar } from './shortcut-bar.js';

/** How wide, in pixels, the on-screen sheet is drawn. Sharp on a large monitor, quick to redraw as a photo is dragged. */
const PREVIEW_PIXELS = 1000;

/** What a photo is carried as while it is dragged from the tray onto a cell. */
const DRAG_TYPE = 'application/x-kwtech-studio-photo';

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
}: {
  state: StudioAppState;
  layout: ChosenLayout;
  onChangeLayout: () => void;
}) {
  /*
   * The border, for THIS print. It starts as the layout says and can be
   * changed here without touching the layout: a pale design wants a darker
   * line today, and the layout is not wrong for it.
   */
  const [guides, setGuides] = useState(layout.spec.guides);
  const [border, setBorder] = useState<StudioBorder>(() => borderOf(layout.spec));
  /** The layout as it prints now: its own cells and paper, with this print's border. */
  const spec = useMemo(() => ({ ...layout.spec, guides, border }), [layout.spec, guides, border]);
  const cells = spec.cells;
  const sheet = useMemo(() => sheetSize(spec), [spec]);
  const area = useMemo(() => printableArea(spec), [spec]);

  const [photos, setPhotos] = useState<StudioPhoto[]>([]);
  const [pages, setPages] = useState<StudioPageFill[]>(() => planFill(cells, [], 'manual').pages);
  const [frames, setFrames] = useState<StudioFrames>({});
  const [edits, setEdits] = useState<ReadonlyMap<string, StudioPhotoEdit>>(new Map());
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

  const loadCalibrations = useCallback(() => state.client.calibrations(state.scope), [state.client, state.scope]);
  const calibrations = useStudioData(loadCalibrations, 'Could not load the calibration profiles.');
  const calibration = calibrations.data?.find((profile) => profile.id === calibrationId) ?? NO_CALIBRATION;

  const photoMap = useMemo(() => new Map(photos.map((photo) => [photo.id, photo])), [photos]);
  const page = pages[pageIndex] ?? [];
  const primary = selection[selection.length - 1] ?? null;
  const cellPhotoId = primary ? (pages[primary.page]?.[primary.cell] ?? null) : null;
  // The photo the adjustments act on: the selected cell's, else the one picked in the tray.
  const toolPhoto = photoMap.get(cellPhotoId ?? activePhotoId ?? '') ?? null;
  const filled = filledCellCount(pages);
  const filledSelection = filledCells(pages, selection);

  // ⚠ Every photo is released when the studio goes, whatever made it go.
  const held = useRef<StudioPhoto[]>([]);
  held.current = photos;
  useEffect(
    () => () => {
      for (const photo of held.current) releasePhoto(photo);
    },
    [],
  );

  /*
   * ⚠ A RESULT IS OF THE ARRANGEMENT IT WAS MADE FROM. Change a photo, a frame,
   * the copies or the calibration and the file no longer matches the screen, so
   * it is dropped rather than left to be downloaded as if it did.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the dependencies ARE the arrangement; the effect only reacts to them
  useEffect(() => {
    setResult(null);
  }, [pages, frames, edits, copies, calibration, spec]);

  // ── the sheet on screen ───────────────────────────────────────────────────

  const canvas = useRef<HTMLCanvasElement>(null);
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
      });
    });
    return () => cancelAnimationFrame(handle);
  }, [spec, sheet, pages, pageIndex, frames, photoMap, edits, calibration, viewZoom]);

  // ── photos ────────────────────────────────────────────────────────────────

  async function addFiles(files: readonly File[]) {
    if (files.length === 0) return;
    setLoading(true);
    setError(null);
    const added: StudioPhoto[] = [];
    const problems: string[] = [];
    const room = STUDIO_PHOTOS_MAX - photos.length;
    // In order, one at a time: each decode holds a full-size bitmap, and a dozen at once is a dozen in memory.
    for (const file of files.slice(0, Math.max(room, 0))) {
      try {
        added.push(await loadPhoto(file));
      } catch (caught) {
        problems.push(caught instanceof Error ? caught.message : `“${file.name}” could not be read.`);
      }
    }
    if (files.length > room) problems.push(`Only ${STUDIO_PHOTOS_MAX} photos can be held at once.`);
    const all = [...photos, ...added];
    setPhotos(all);
    if (added[0] && activePhotoId === null) setActivePhotoId(added[0].id);
    /*
     * ⚠ THE FIRST PHOTOS FILL THE SHEET BY THEMSELVES. Somebody who adds one
     * photo to an ID layout wants it in every cell; somebody who adds several
     * wants one each. Only while every cell is still empty — once anything has
     * been placed, adding photos never rearranges it.
     */
    if (added.length > 0 && filled === 0) {
      const plan = planFill(
        cells,
        all.map((photo) => photo.id),
        all.length === 1 ? 'same' : 'sequence',
      );
      setPages(plan.pages);
      setFrames({});
      if (plan.dropped > 0) problems.push(`${plural(plan.dropped, 'photo')} did not fit in 50 pages.`);
    }
    setError(problems.length > 0 ? problems.join(' ') : null);
    setLoading(false);
  }

  function removePhoto(photo: StudioPhoto) {
    const cleared = pages.map((one) => one.map((id) => (id === photo.id ? null : id)));
    setPages(cleared);
    setFrames((current) => pruneFrames(current, cleared));
    setPhotos((current) => current.filter((other) => other.id !== photo.id));
    if (activePhotoId === photo.id) setActivePhotoId(null);
    releasePhoto(photo);
  }

  // ── filling ───────────────────────────────────────────────────────────────

  function fill(mode: StudioFillMode) {
    const ids =
      mode === 'same' ? [activePhotoId ?? photos[0]?.id ?? ''].filter(Boolean) : photos.map((photo) => photo.id);
    const plan = planFill(cells, ids, mode);
    setPages(plan.pages);
    // A new arrangement: nobody's old zoom carries over to a different photo.
    setFrames({});
    setPageIndex(0);
    setSelection([]);
    setError(
      plan.dropped > 0
        ? `${plural(plan.dropped, 'photo')} did not fit: a result has at most ${plural(plan.pages.length, 'page')}.`
        : null,
    );
  }

  function place(cellIndex: number, photoId: string | null) {
    const next = setCellPhoto(pages, pageIndex, cellIndex, photoId);
    setPages(next);
    // A different photo starts centred: the last one's zoom is not its own.
    setFrames((current) => pruneFrames(withFrame(current, pageIndex, cellIndex, DEFAULT_FRAME), next));
  }

  /** One photo into every selected cell, or all of them emptied. Each starts centred again. */
  function placeInSelection(photoId: string | null) {
    const next = setCellsPhoto(pages, selection, photoId);
    setPages(next);
    setFrames((current) => pruneFrames(withFrames(current, selection, DEFAULT_FRAME), next));
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
    if (!page[cellIndex] && activePhotoId) place(cellIndex, activePhotoId);
  }

  function dropOnCell(event: DragEvent, cellIndex: number) {
    const photoId = event.dataTransfer.getData(DRAG_TYPE);
    if (!photoId || !photoMap.has(photoId)) return;
    event.preventDefault();
    place(cellIndex, photoId);
    setSelection([{ page: pageIndex, cell: cellIndex }]);
  }

  /** Change the frame of every selected cell that holds a photo, each from its own. */
  function reframe(change: (frame: StudioFrame) => StudioFrame) {
    setFrames((current) => {
      let next = current;
      for (const ref of filledSelection) {
        next = withFrame(next, ref.page, ref.cell, change(frameOf(current, ref.page, ref.cell)));
      }
      return next;
    });
  }

  // ── dragging a photo inside its cell ──────────────────────────────────────

  /** A drag in progress: where it began, the frames it began from, and whether it has moved enough to count. */
  const drag = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
    targets: StudioCellRef[];
    from: StudioFrames;
    moved: boolean;
  } | null>(null);
  /** Set when a press turned into a drag, so the click that follows it is not also a selection. */
  const dragged = useRef(false);

  function beginDrag(event: ReactPointerEvent<HTMLButtonElement>, cellIndex: number) {
    dragged.current = false;
    if (event.button !== 0 || !page[cellIndex]) return;
    const ref = { page: pageIndex, cell: cellIndex };
    // Dragging a cell that is part of the selection moves the whole selection; any other cell moves alone.
    const targets = hasCell(selection, ref) ? filledSelection : [ref];
    const box = event.currentTarget.getBoundingClientRect();
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      width: box.width,
      height: box.height,
      targets,
      from: frames,
      moved: false,
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
    // The same movement, as a share of the pressed cell, for every photo being moved — each from where IT started.
    const move = { dx: dx / current.width, dy: dy / current.height };
    let next = frames;
    for (const ref of current.targets) {
      const photo = photoMap.get(pages[ref.page]?.[ref.cell] ?? '');
      const cell = cells[ref.cell];
      if (!photo || !cell) continue;
      const edit = edits.get(photo.id) ?? NO_PHOTO_EDIT;
      const start = frameOf(current.from, ref.page, ref.cell);
      next = withFrame(
        next,
        ref.page,
        ref.cell,
        panFrame(photo, cell, start, move, edit.crop, { horizontal: edit.flipH, vertical: edit.flipV }),
      );
    }
    setFrames(next);
  }

  function endDrag() {
    drag.current = null;
  }

  // ── pages ─────────────────────────────────────────────────────────────────

  function addOnePage() {
    const next = addPage(pages, cells.length);
    if (!next) return setError('A result can have at most 50 pages.');
    setPages(next);
    setPageIndex(next.length - 1);
  }

  function removeCurrentPage() {
    if (pages.length <= 1) return;
    const next = pages.filter((_page, at) => at !== pageIndex);
    setPages(next);
    setFrames((current) => removePageFrames(current, pageIndex));
    setPageIndex(Math.min(pageIndex, next.length - 1));
    // Page numbers after the removed one all moved: a selection made by number no longer means what it did.
    setSelection([]);
  }

  // ── the result ────────────────────────────────────────────────────────────

  async function make(): Promise<StudioResult> {
    const made = await makeLayoutResult({ spec, pages, frames, photos: photoMap, edits, calibration, copies });
    setResult(made);
    return made;
  }

  function clearEverything() {
    for (const photo of photos) releasePhoto(photo);
    setPhotos([]);
    setPages(planFill(cells, [], 'manual').pages);
    setFrames({});
    setEdits(new Map());
    setPageIndex(0);
    setSelection([]);
    setActivePhotoId(null);
    setResult(null);
    setError(null);
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
  };

  /**
   * Do what a key means right now. The ONE place a key becomes an act — the
   * keyboard and a click on the shortcut bar both come through here, so they
   * cannot disagree. Answers whether it did anything.
   */
  function performKey(key: string): boolean {
    const action = printKeyAction(key, keyContext, state.keymap);
    if (!action) return false;
    switch (action.kind) {
      case 'empty':
        placeInSelection(null);
        break;
      case 'zoom':
        reframe((frame) => ({
          ...frame,
          zoom: Math.min(Math.max(Math.round((frame.zoom + action.by) * 100) / 100, 1), STUDIO_ZOOM_MAX),
        }));
        break;
      case 'turn':
        reframe((frame) => ({ ...frame, rotation: nextRotation(frame.rotation) }));
        break;
      case 'reset':
        reframe(() => DEFAULT_FRAME);
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
    }
    return true;
  }

  /** The arrow keys: every selected photo moved inside its cell by the same share of it. */
  function nudge(dx: number, dy: number) {
    setFrames((current) => {
      let next = current;
      for (const ref of filledSelection) {
        const photo = photoMap.get(pages[ref.page]?.[ref.cell] ?? '');
        const cell = cells[ref.cell];
        if (!photo || !cell) continue;
        const edit = edits.get(photo.id) ?? NO_PHOTO_EDIT;
        const flip = { horizontal: edit.flipH, vertical: edit.flipV };
        const moved = panFrame(photo, cell, frameOf(current, ref.page, ref.cell), { dx, dy }, edit.crop, flip);
        next = withFrame(next, ref.page, ref.cell, moved);
      }
      return next;
    });
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
    <div ref={root} className="flex min-h-0 flex-1 flex-col gap-3">
      <Alert message={error} onDismiss={() => setError(null)} />

      <div className="flex min-h-0 flex-1 flex-col gap-3 @3xl:flex-row">
        {/* ── photos, and how they go in ── */}
        <div className="flex shrink-0 flex-col gap-3 overflow-y-auto @3xl:w-72 @3xl:pr-1">
          <section className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">{layout.name}</h3>
              <p className="truncate text-xs text-muted-foreground">
                {paperName(spec, 'mm')} · {plural(cells.length, 'cell')}
              </p>
            </div>
            <button type="button" className={buttonClass('secondary', 'sm')} onClick={onChangeLayout}>
              <LayoutTemplate aria-hidden="true" className="size-3.5" />
              Change
            </button>
          </section>
          {layout.foreign ? (
            <p className="-mt-1.5 px-1 text-xs text-muted-foreground">
              Somebody else made this layout. Its margins were set for their printer and may not suit yours.
            </p>
          ) : null}

          <PhotoTray
            photos={photos}
            activeId={activePhotoId}
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

          <BorderCard guides={guides} border={border} onGuides={setGuides} onBorder={setBorder} />

          {toolPhoto ? (
            <PhotoPanel
              name={toolPhoto.name}
              edit={edits.get(toolPhoto.id) ?? NO_PHOTO_EDIT}
              onChange={(edit) => setEdits((current) => new Map(current).set(toolPhoto.id, edit))}
            />
          ) : null}
        </div>

        {/* ── the sheet ── */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {primary ? (
            <SelectionBar
              count={selection.length}
              filled={filledSelection.length}
              frame={selectedPhoto ? selectedFrame : null}
              warning={warning}
              pickedPhoto={photoMap.get(activePhotoId ?? '')?.name ?? null}
              onZoom={(zoom) => reframe((frame) => ({ ...frame, zoom }))}
              onTurn={() => reframe((frame) => ({ ...frame, rotation: nextRotation(frame.rotation) }))}
              onReset={() => reframe(() => DEFAULT_FRAME)}
              onSelectSamePhoto={selectedPhoto ? () => setSelection(cellsLike(pages, 'photo', primary)) : null}
              onSelectAll={() => {
                // From the pressed cell when it has a photo; from any filled cell otherwise.
                const from = selectedPhoto ? primary : firstFilled(pages);
                if (from) setSelection(cellsLike(pages, 'all', from));
              }}
              onPut={() => placeInSelection(activePhotoId)}
              onClear={() => placeInSelection(null)}
              onDone={() => setSelection([])}
            />
          ) : (
            <p className="rounded-xl border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">
              {filled > 0
                ? 'Press a photo on the sheet to zoom or turn it. Drag it to move it inside its cell.'
                : 'Add photos on the left and they are placed for you.'}
            </p>
          )}

          <div className="flex min-h-64 flex-1 rounded-xl border border-border bg-muted/30 p-4">
            <SheetFrame zoom={viewZoom} onZoom={setViewZoom}>
              <div className="relative shadow-md ring-1 ring-border" style={{ width: fitWidth(sheet, viewZoom) }}>
                <canvas ref={canvas} className="block h-auto w-full" />
                {/*
                 * The cells, as real buttons laid over the drawing: each sits exactly on its cell, by
                 * percentages of the sheet, so the layer scales with the canvas under it.
                 */}
                <ul
                  aria-label={`Page ${pageIndex + 1} of ${layout.name}`}
                  className="absolute inset-0 m-0 list-none p-0"
                >
                  {cells.map((cell, index) => {
                    const photo = photoMap.get(page[index] ?? '');
                    const chosen = hasCell(selection, { page: pageIndex, cell: index });
                    return (
                      // Cells never overlap, so a cell's top left names it and no other.
                      <li key={`${cell.x}:${cell.y}`}>
                        <button
                          type="button"
                          aria-label={`Cell ${index + 1}${cell.label ? `, ${cell.label}` : ''}: ${photo ? photo.name : 'empty'}`}
                          aria-pressed={chosen}
                          style={{
                            left: `${((area.x + cell.x) / sheet.width) * 100}%`,
                            top: `${((area.y + cell.y) / sheet.height) * 100}%`,
                            width: `${(cell.width / sheet.width) * 100}%`,
                            height: `${(cell.height / sheet.height) * 100}%`,
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
                            'absolute flex touch-none select-none items-center justify-center text-[10px] font-medium',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            chosen ? 'z-10' : null,
                            photo ? 'cursor-grab active:cursor-grabbing' : null,
                          )}
                          onClick={(event) => {
                            if (dragged.current) return;
                            pressCell(index, event.ctrlKey || event.metaKey || event.shiftKey);
                          }}
                          onPointerDown={(event) => beginDrag(event, index)}
                          onPointerMove={(event) => duringDrag(event, index)}
                          onPointerUp={endDrag}
                          onPointerCancel={endDrag}
                          onDragOver={(event) => {
                            if (event.dataTransfer.types.includes(DRAG_TYPE)) event.preventDefault();
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
              </div>
            </SheetFrame>
          </div>

          {pages.length > 1 || filled > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {pages.map((_one, at) => (
                <button
                  // Pages have no identity but their number: page 2 is whatever is second.
                  // biome-ignore lint/suspicious/noArrayIndexKey: a page is identified by its position
                  key={at}
                  type="button"
                  aria-current={at === pageIndex ? 'page' : undefined}
                  className={buttonClass(at === pageIndex ? 'primary' : 'secondary', 'sm')}
                  // The selection is kept: it may span pages ("every cell with this photo").
                  onClick={() => setPageIndex(at)}
                >
                  Page {at + 1}
                </button>
              ))}
              <button type="button" className={buttonClass('ghost', 'sm')} onClick={addOnePage}>
                <Plus aria-hidden="true" className="size-3.5" />
                Add a page
              </button>
              {pages.length > 1 ? (
                <button
                  type="button"
                  className={cn(buttonClass('ghost', 'sm'), 'text-destructive')}
                  onClick={removeCurrentPage}
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                  Remove this page
                </button>
              ) : null}
            </div>
          ) : null}

          <OutputBar
            state={state}
            summary={
              filled === 0
                ? 'Nothing to print yet.'
                : `${plural(pages.length, 'page')} · ${plural(filled, 'photo')} placed`
            }
            copies={copies}
            onCopies={setCopies}
            calibrations={calibrations.data ?? []}
            calibrationId={calibrationId}
            onCalibration={setCalibrationId}
            canMake={filled > 0}
            result={result}
            make={make}
            fileName={resultFileName(layout.name)}
            entry={(made) => ({
              kind: 'layout',
              layoutId: layout.id,
              layoutName: layout.name,
              paperLabel: paperName(spec, 'mm'),
              paperWidth: sheet.width,
              paperHeight: sheet.height,
              pages: made.pages,
              copies: made.copies,
              fileNames: usedPhotoIds(pages).flatMap((id) => photoMap.get(id)?.name ?? []),
            })}
            hasWork={photos.length > 0}
            onStartOver={clearEverything}
            onError={setError}
            commands={output}
          />
          <ShortcutBar entries={printShortcutBar(keyContext, state.keymap)} onPress={(key) => void performKey(key)} />
        </div>
      </div>
    </div>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────────

/** Any cell that holds a photo, to start "every photo" from when the pressed cell is empty. */
function firstFilled(pages: readonly StudioPageFill[]): StudioCellRef | null {
  for (let page = 0; page < pages.length; page += 1) {
    const cell = (pages[page] ?? []).findIndex((photo) => photo !== null);
    if (cell >= 0) return { page, cell };
  }
  return null;
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
 * The selection's toolbar, above the sheet where the eye already is.
 *
 * ⚠ EVERY ACTION HERE APPLIES TO EVERY SELECTED CELL. The count comes first,
 * so nothing moves that the person did not expect. Position is not here: the
 * photo is dragged on the sheet itself.
 */
function SelectionBar({
  count,
  filled,
  frame,
  warning,
  pickedPhoto,
  onZoom,
  onTurn,
  onReset,
  onSelectSamePhoto,
  onSelectAll,
  onPut,
  onClear,
  onDone,
}: {
  count: number;
  /** How many of the selected cells hold a photo. */
  filled: number;
  /** The frame of the cell pressed last, or null when that cell is empty. */
  frame: StudioFrame | null;
  warning: string | null;
  /** The name of the photo picked in the tray, when there is one to put in the selection. */
  pickedPhoto: string | null;
  onZoom: (zoom: number) => void;
  onTurn: () => void;
  onReset: () => void;
  /** Null when the pressed cell is empty: there is no photo to match. */
  onSelectSamePhoto: (() => void) | null;
  onSelectAll: () => void;
  onPut: () => void;
  onClear: () => void;
  onDone: () => void;
}) {
  const zoomId = useId();
  const [more, setMore] = useState(false);
  const zoom = frame?.zoom ?? 1;
  const step = (by: number) => onZoom(Math.min(Math.max(Math.round((zoom + by) * 100) / 100, 1), 4));
  const square = cn(buttonClass('secondary', 'sm'), 'size-8 px-0');
  return (
    <section
      aria-label="Selected cells"
      className="flex flex-col gap-1.5 rounded-xl border border-primary/50 bg-accent/40 px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-sm font-semibold">{count === 1 ? '1 cell selected' : `${count} cells selected`}</p>

        {frame ? (
          <>
            <div className="flex items-center gap-1.5">
              <label htmlFor={zoomId} className="text-xs font-medium text-muted-foreground">
                Zoom
              </label>
              <button type="button" aria-label="Zoom out" className={square} onClick={() => step(-0.1)}>
                <Minus aria-hidden="true" className="size-3.5" />
              </button>
              <input
                id={zoomId}
                type="range"
                className="w-28 accent-primary"
                min={1}
                max={4}
                step={0.01}
                value={zoom}
                onChange={(event) => onZoom(Number(event.target.value))}
              />
              <button type="button" aria-label="Zoom in" className={square} onClick={() => step(0.1)}>
                <Plus aria-hidden="true" className="size-3.5" />
              </button>
              <span className="w-10 text-xs tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
            </div>
            <button type="button" className={buttonClass('secondary', 'sm')} onClick={onTurn}>
              <RotateCw aria-hidden="true" className="size-3.5" />
              Turn
            </button>
            <button type="button" className={buttonClass('ghost', 'sm')} onClick={onReset}>
              <RotateCcw aria-hidden="true" className="size-3.5" />
              Reset
            </button>
          </>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            aria-expanded={more}
            className={buttonClass('ghost', 'sm')}
            onClick={() => setMore(!more)}
          >
            Select more
            <ChevronDown
              aria-hidden="true"
              className={cn('size-3.5 transition-transform', more ? 'rotate-180' : null)}
            />
          </button>
          {filled > 0 ? (
            <button type="button" className={cn(buttonClass('ghost', 'sm'), 'text-destructive')} onClick={onClear}>
              <X aria-hidden="true" className="size-3.5" />
              {count === 1 ? 'Empty it' : 'Empty them'}
            </button>
          ) : null}
          <button type="button" className={buttonClass('secondary', 'sm')} onClick={onDone}>
            Done
          </button>
        </div>
      </div>

      {more ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-1.5">
          {onSelectSamePhoto ? (
            <button type="button" className={buttonClass('secondary', 'sm')} onClick={onSelectSamePhoto}>
              Every cell with this photo
            </button>
          ) : null}
          <button type="button" className={buttonClass('secondary', 'sm')} onClick={onSelectAll}>
            Every photo
          </button>
          {pickedPhoto ? (
            <button type="button" className={cn(buttonClass('secondary', 'sm'), 'max-w-64')} onClick={onPut}>
              <span className="truncate">
                Put “{pickedPhoto}” in {count === 1 ? 'this cell' : `these ${count} cells`}
              </span>
            </button>
          ) : null}
          <span className="text-xs text-muted-foreground">
            Or hold Ctrl (⌘ on a Mac) or Shift and press cells one by one.
          </span>
        </div>
      ) : null}

      {warning ? (
        <p role="status" className="rounded-lg bg-status-warning px-2.5 py-1.5 text-xs text-status-warning-foreground">
          {warning}
        </p>
      ) : null}
      {frame && !warning ? (
        <p className="text-xs text-muted-foreground">Drag the photo on the sheet to move it inside its cell.</p>
      ) : null}
    </section>
  );
}

/**
 * The chosen photos. Press one to pick it — it is the one "Same photo" and
 * empty cells use; drag one onto a cell to put it there.
 */
function PhotoTray({
  photos,
  activeId,
  edits,
  loading,
  onPick,
  onAdd,
  onRemove,
}: {
  photos: readonly StudioPhoto[];
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
          <ul className="grid max-h-56 grid-cols-4 gap-1.5 overflow-y-auto">
            {photos.map((photo) => (
              <li key={photo.id} className="group relative">
                <button
                  type="button"
                  draggable
                  aria-pressed={photo.id === activeId}
                  title={photo.name}
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
                  <img src={photo.url} alt={photo.name} className="size-full object-cover" draggable={false} />
                </button>
                {isEdited(edits.get(photo.id)) ? (
                  <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-primary px-1 text-[9px] font-medium text-primary-foreground">
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
        </>
      )}
    </section>
  );
}
