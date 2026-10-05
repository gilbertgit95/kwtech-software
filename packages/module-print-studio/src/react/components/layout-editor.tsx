'use client';

import { cn } from '@kwtech/web-ui/react';
import { ChevronDown, Copy, GripVertical, LayoutGrid, Plus, RotateCw, Trash2 } from 'lucide-react';
import { type DragEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  borderOf,
  checkCells,
  checkPrintableArea,
  prepareLayoutName,
  printableArea,
  type StudioBorder,
  type StudioCell,
  type StudioLayoutSpec,
  type StudioMargins,
  type StudioOrientation,
  type StudioSize,
} from '../../domain/layout.js';
import { findStudioPaper, STUDIO_PAPER_MAX, STUDIO_PAPER_MIN, STUDIO_PAPERS } from '../../domain/papers.js';
import {
  addBlock,
  duplicateCell,
  fillWithSize,
  moveCell,
  removeCell,
  resizeCell,
  rotateCell,
  snapPosition,
  splitIntoGrid,
} from '../../domain/place.js';
import { STUDIO_CELL_MIN, STUDIO_ID_SIZES, type StudioCellSize } from '../../domain/sizes.js';
import { formatSize, mm } from '../../domain/units.js';
import type { StudioRefusal } from '../../types.js';
import type { StudioAppState } from '../studio-state.js';
import { useStudioAction } from '../use-studio-data.js';
import { useStudioKeys } from '../use-studio-keys.js';
import { editorKeyAction, editorShortcutBar } from '../view/keys.js';
import { lengthText, parseLength, STUDIO_UNITS, type StudioUnit } from '../view/lengths.js';
import { cellGroups, paperName, plural, sizeName } from '../view/summary.js';
import { stepViewZoom } from '../view/work.js';
import { BorderControls, borderSummary } from './border-controls.js';
import { buttonClass, INPUT_CLASS } from './controls.js';
import { Alert } from './layout.js';
import { SheetFrame, SheetView } from './sheet-view.js';
import { ShortcutBar } from './shortcut-bar.js';

/** What the editor was opened on: a new layout, or a saved one being changed. */
export interface EditorTarget {
  /** Null for a layout not saved yet. */
  id: string | null;
  /** The version it was opened at; a save from an older one is refused. */
  version: number;
  name: string;
  visibility: 'private' | 'workspace';
  spec: StudioLayoutSpec;
}

/** Why a draft cannot be saved, in the editor's own words. */
const PROBLEMS: Partial<Record<StudioRefusal, string>> = {
  no_printable_area: 'These margins leave nothing to print on.',
  cell_outside: 'A cell reaches outside the printable area — move it, or remove it.',
  cell_overlap: 'Two cells overlap.',
  cell_too_small: 'A cell is too small to hold a photo.',
  too_many_cells: 'There are too many cells.',
};

/** What a size is carried as while it is dragged from the palette onto the sheet. */
const SIZE_DRAG_TYPE = 'application/x-kwtech-studio-size';

/** How far one step of an arrow key moves the selected cell: 1 mm. With Shift the key asks for five steps. */
const NUDGE = mm(1);

/**
 * Making a layout: put sizes on a sheet and move them where they should go.
 *
 * ## How it is laid out, and why (the operator, 2026-10-05)
 *
 * The first editor was three boxes of fields — paper, margins, cells — and the
 * operator found its controls confusing: nothing said that a cell could be
 * dragged, and adding ONE cell meant typing a count. So it now works like a
 * drawing board:
 *
 *   SIZES   a palette on the left. Press a size to add one cell of it; drag it
 *           onto the sheet to put it exactly there. A custom size is typed.
 *   SHEET   the paper, to scale. Drag a cell to move it, drag its corner to
 *           resize it; arrow keys nudge, Delete removes.
 *   PAGE    the paper and its margins, folded into one line until wanted —
 *           most layouts never change them.
 *
 * Every tool is still a pure function from `place.ts`, and every change is
 * checked by the same `checkCells` the server runs — so what this editor lets
 * through is exactly what the server will save.
 *
 * ⚠ DESKTOP FIRST (PRINT-STUDIO-PLAN decision 11): a narrow box shows a note
 * asking for more room rather than a cramped editor.
 */
export function LayoutEditor({
  state,
  target,
  onSaved,
  onCancel,
}: {
  state: StudioAppState;
  target: EditorTarget;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const nameId = useId();
  const [name, setName] = useState(target.name);
  const [visibility, setVisibility] = useState(target.visibility);
  const [spec, setSpec] = useState(target.spec);
  const [unit, setUnit] = useState<StudioUnit>('mm');
  const [selected, setSelected] = useState<number | null>(null);
  /** What the last action did, said plainly: "Added a 2 × 2." */
  const [note, setNote] = useState<string | null>(null);
  const [nameError, setNameError] = useState(false);
  /** How closely the sheet is being looked at. 1 fits the panel. */
  const [viewZoom, setViewZoom] = useState(1);
  const save = useStudioAction('Could not save the layout.');

  const area = useMemo(() => printableArea(spec), [spec]);
  const problem = checkPrintableArea(spec) ?? checkCells(spec.cells, area);
  const groups = cellGroups(spec.cells, unit);
  const selectedCell = selected === null ? undefined : spec.cells[selected];

  function change(patch: Partial<StudioLayoutSpec>) {
    setSpec((current) => ({ ...current, ...patch }));
  }

  function setCells(cells: StudioCell[], message: string | null = null) {
    change({ cells });
    setNote(message);
  }

  /** A hand edit the domain refused leaves the cells as they were, and says why when it matters. */
  function tryCells(result: { cells: StudioCell[] } | { refused: StudioRefusal }, quiet = false) {
    if ('cells' in result) return setCells(result.cells);
    if (!quiet) setNote(result.refused === 'cell_overlap' ? 'There is another cell in the way.' : 'That does not fit.');
  }

  /**
   * Cells of one size, as many as the palette's "how many" says: at the point
   * they were dropped, else in the first free place.
   */
  function addCells(size: StudioSize, label: string, many: BlockChoice, point?: { x: number; y: number }) {
    const placed = addBlock(area, spec.cells, size, { ...many, label, ...(point ? { point } : {}) });
    if (placed.placed === 0) return setNote(`There is no room left for ${label}. Move or remove a cell first.`);
    const left = placed.left > 0 ? ` ${placed.left} more did not fit.` : '';
    const what = placed.placed === 1 ? label : `${placed.placed} of ${label}`;
    setCells(placed.cells, `Added ${what}.${left} Drag a cell to move it.`);
    // One cell is selected, ready to be moved; a block is left unselected.
    setSelected(placed.placed === 1 ? placed.cells.length - 1 : null);
  }

  function fillWith(size: StudioSize, label: string, gap: number) {
    const placed = fillWithSize(area, spec.cells, size, { gap, label });
    setCells(placed.cells, placed.placed === 0 ? `No more ${label} fit.` : `Added ${placed.placed} of ${label}.`);
  }

  /**
   * Do what a key means right now. The keyboard and a click on the shortcut bar
   * both come through here. Answers whether it did anything.
   */
  function performKey(key: string): boolean {
    const action = editorKeyAction(key, selectedCell !== undefined, state.keymap);
    if (!action) return false;
    switch (action.kind) {
      case 'view':
        setViewZoom(viewAfter(viewZoom, action.zoom));
        return true;
      case 'deselect':
        setSelected(null);
        return true;
      case 'move':
      case 'remove':
      case 'copy':
      case 'turn':
        break;
    }
    if (selected === null || !selectedCell) return false;
    switch (action.kind) {
      case 'move': {
        // A step is a millimetre; the keys ask for one, or five with Shift.
        const index = selected;
        /*
         * ⚠ FROM THE CELLS AS THEY ARE WHEN THIS RUNS, not as they were when
         * the key was pressed: a held arrow key repeats faster than the screen
         * redraws, and each repeat must start where the last one ended — or
         * ten repeats move the cell one step.
         */
        setSpec((current) => {
          const cell = current.cells[index];
          if (!cell) return current;
          const to = { x: cell.x + action.dx * NUDGE, y: cell.y + action.dy * NUDGE };
          const moved = moveCell(printableArea(current), current.cells, index, to);
          return 'cells' in moved ? { ...current, cells: moved.cells } : current;
        });
        break;
      }
      case 'remove':
        removeSelected();
        break;
      case 'copy':
        copySelected();
        break;
      case 'turn':
        tryCells(rotateCell(area, spec.cells, selected));
        break;
    }
    return true;
  }

  function removeSelected() {
    if (selected === null) return;
    setCells(removeCell(spec.cells, selected), 'Removed the cell.');
    setSelected(null);
  }

  function copySelected() {
    if (selected === null) return;
    const copy = duplicateCell(area, spec.cells, selected);
    if (copy.placed === 0) return setNote('There is no room left for a copy.');
    setCells(copy.cells, 'Made a copy. Drag it where you want it.');
    setSelected(copy.cells.length - 1);
  }

  const root = useRef<HTMLDivElement>(null);
  useStudioKeys(root, performKey);

  async function submit() {
    const prepared = prepareLayoutName(name);
    if ('refused' in prepared) {
      setNameError(true);
      document.getElementById(nameId)?.focus();
      return;
    }
    setNameError(false);
    if (problem) return;

    const done = await save.run(async () => {
      if (target.id === null) {
        await state.client.createLayout(state.scope, { name: prepared.name, visibility, spec });
        return;
      }
      await state.client.updateLayout(state.scope, target.id, target.version, { name: prepared.name, spec });
      // Sharing is its own act, and the owner's alone: only sent when it changed.
      if (visibility !== target.visibility) await state.client.setVisibility(state.scope, target.id, visibility);
    });
    if (done) onSaved();
  }

  return (
    <div ref={root} className="flex min-h-0 flex-1 flex-col gap-3">
      {/* ── the bar: what it is called, who sees it, and the way out ── */}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={nameId} className="sr-only">
          Layout name
        </label>
        <input
          id={nameId}
          aria-invalid={nameError ? true : undefined}
          className={cn(
            INPUT_CLASS,
            'h-10 min-w-48 flex-1 text-base font-medium',
            nameError ? 'border-destructive' : null,
          )}
          value={name}
          placeholder={nameError ? 'Give the layout a name to save it' : 'Name this layout — for example “ID package”'}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(false);
          }}
        />
        <Segmented
          label="Who can use this layout"
          value={visibility}
          onChange={setVisibility}
          options={[
            { value: 'private', label: 'Only me' },
            { value: 'workspace', label: 'Everyone here' },
          ]}
        />
        <button type="button" className={buttonClass('ghost')} disabled={save.busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={buttonClass('primary')}
          disabled={save.busy || problem !== null}
          onClick={() => void submit()}
        >
          {save.busy ? 'Saving…' : 'Save layout'}
        </button>
      </div>
      <Alert message={save.error} onDismiss={save.dismissError} />

      <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground @2xl:hidden">
        The layout editor needs more room. Widen this panel, or open the print studio by itself.
      </p>

      <div className="hidden min-h-0 flex-1 gap-4 @2xl:flex">
        {/* ── the palette ── */}
        <div className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto pr-1">
          <SizePalette unit={unit} onAdd={addCells} onFill={fillWith} />
          <PageSetup spec={spec} unit={unit} onUnit={setUnit} onChange={change} />
          <MoreTools
            area={area}
            unit={unit}
            hasCells={spec.cells.length > 0}
            guides={spec.guides}
            border={borderOf(spec)}
            onGuides={(guides) => change({ guides })}
            onBorder={(border) => change({ border })}
            onSplit={(rows, columns, gap) => {
              const grid = splitIntoGrid(area, rows, columns, { gap });
              if (!grid) return setNote('Those cells would be too small.');
              setCells(grid, `Split the sheet into ${plural(grid.length, 'equal cell')}.`);
              setSelected(null);
            }}
            onClear={() => {
              setCells([], 'Removed every cell.');
              setSelected(null);
            }}
          />
        </div>

        {/* ── the sheet ── */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {selectedCell && selected !== null ? (
            <SelectedCell
              cell={selectedCell}
              unit={unit}
              onMove={(position) => tryCells(moveCell(area, spec.cells, selected, position))}
              onResize={(size) => tryCells(resizeCell(area, spec.cells, selected, size))}
              onRotate={() => tryCells(rotateCell(area, spec.cells, selected))}
              onDuplicate={copySelected}
              onRemove={removeSelected}
            />
          ) : null}
          <div className="relative flex min-h-0 flex-1 rounded-xl border border-border bg-muted/30 p-4">
            <SheetFrame zoom={viewZoom} onZoom={setViewZoom}>
              <SheetView
                fit
                zoom={viewZoom}
                spec={spec}
                label={`${name || 'New layout'}: ${plural(spec.cells.length, 'cell')}`}
                selected={selected}
                onSelect={setSelected}
                onMove={(index, position) =>
                  tryCells(moveCell(area, spec.cells, index, snapPosition(area, spec.cells, index, position)), true)
                }
                onResize={(index, size) => tryCells(resizeCell(area, spec.cells, index, size), true)}
                accepts={(event) => event.dataTransfer.types.includes(SIZE_DRAG_TYPE)}
                onDropAt={(event, point) => {
                  const dropped = readDraggedSize(event);
                  if (!dropped) return;
                  event.preventDefault();
                  addCells(dropped.size, dropped.label, dropped.many, point);
                }}
              />
            </SheetFrame>
            {spec.cells.length === 0 ? (
              <div className="pointer-events-none absolute inset-x-0 top-1/3 flex justify-center px-6">
                <p className="max-w-xs rounded-xl border border-dashed border-border bg-card/95 px-4 py-3 text-center text-sm text-muted-foreground shadow-sm">
                  <span className="block font-semibold text-foreground">This sheet is empty</span>
                  Press a size on the left to add it, or drag it onto the sheet.
                </p>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
            <p className="min-w-0 text-muted-foreground">
              {groups.length === 0
                ? paperName(spec, unit)
                : `${paperName(spec, unit)} · ${groups.map((group) => `${group.count} of ${group.label}`).join(', ')}`}
            </p>
            {problem ? (
              <p role="alert" className="text-destructive">
                {PROBLEMS[problem] ?? 'This layout cannot be saved yet.'}
              </p>
            ) : (
              <p role="status" className="text-muted-foreground">
                {note ?? 'Drag a cell to move it, or its corner to resize it.'}
              </p>
            )}
          </div>
          <ShortcutBar
            entries={editorShortcutBar(selectedCell !== undefined, state.keymap)}
            onPress={(key) => void performKey(key)}
          />
        </div>
      </div>
    </div>
  );
}

/** The view's zoom after a key asked for more, less, or to fit. */
function viewAfter(zoom: number, change: 'in' | 'out' | 'fit'): number {
  switch (change) {
    case 'in':
      return stepViewZoom(zoom, 1);
    case 'out':
      return stepViewZoom(zoom, -1);
    case 'fit':
      return 1;
  }
}

/** How many cells one press or one drop adds: rows × columns, with a gap between them. */
interface BlockChoice {
  rows: number;
  columns: number;
  gap: number;
}

/** The size, and how many of it, that a palette entry carries while it is dragged. */
function readDraggedSize(event: DragEvent): { size: StudioSize; label: string; many: BlockChoice } | null {
  try {
    const parsed: unknown = JSON.parse(event.dataTransfer.getData(SIZE_DRAG_TYPE));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { width, height, label, rows, columns, gap } = parsed as Record<string, unknown>;
    if (typeof width !== 'number' || typeof height !== 'number' || typeof label !== 'string') return null;
    if (typeof rows !== 'number' || typeof columns !== 'number' || typeof gap !== 'number') return null;
    return { size: { width, height }, label, many: { rows, columns, gap } };
  } catch {
    return null;
  }
}

// ── shared pieces ────────────────────────────────────────────────────────────

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A card that is one line until opened — for what most layouts never change. */
function Foldable({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
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
          <span className="block text-sm font-semibold">{title}</span>
          {open ? null : <span className="block truncate text-xs text-muted-foreground">{summary}</span>}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open ? 'rotate-180' : null)}
        />
      </button>
      {open ? (
        <div id={bodyId} className="flex flex-col gap-2.5 border-t border-border p-3">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** A pair of choices drawn as one control. */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="inline-flex shrink-0 rounded-lg border border-border bg-background p-0.5">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          className={cn(
            'h-8 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            option.value === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

/**
 * A length somebody types. Holds its own text while it is being typed, and
 * hands the length up only when it reads as one (on leaving the field, or
 * Enter) — so "1." on the way to "1.5" is not rejected halfway.
 */
function LengthField({
  label,
  value,
  unit,
  onCommit,
  min = 0,
  max = STUDIO_PAPER_MAX,
}: {
  label: string;
  value: number;
  unit: StudioUnit;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
}) {
  const id = useId();
  const [text, setText] = useState(lengthText(value, unit));
  const [bad, setBad] = useState(false);
  // The value changed from outside (a tool, a drag, another unit): show it.
  useEffect(() => {
    setText(lengthText(value, unit));
    setBad(false);
  }, [value, unit]);

  function commit() {
    const parsed = parseLength(text, unit);
    if (parsed === null || parsed < min || parsed > max) {
      setBad(true);
      return;
    }
    setBad(false);
    if (parsed !== value) onCommit(parsed);
    else setText(lengthText(value, unit));
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          inputMode="decimal"
          aria-invalid={bad ? true : undefined}
          className={cn(INPUT_CLASS, 'h-9 pr-8', bad ? 'border-destructive' : null)}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
          }}
        />
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground">
          {unit}
        </span>
      </div>
    </div>
  );
}

function CountField({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  max: number;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={1}
        max={max}
        className={cn(INPUT_CLASS, 'h-9')}
        value={value}
        onChange={(event) => onChange(Math.min(Math.max(Math.trunc(Number(event.target.value) || 1), 1), max))}
      />
    </div>
  );
}

// ── the palette: sizes to put on the sheet ───────────────────────────────────

/** The photo papers offered as cell sizes, smallest first — a 2R or a 4R on an A4. */
const PHOTO_CELL_SIZES: readonly StudioCellSize[] = STUDIO_PAPERS.filter((paper) => paper.group === 'photo').map(
  (paper) => ({
    key: `paper:${paper.key}`,
    label: paper.label,
    width: paper.width,
    height: paper.height,
    unit: paper.unit,
  }),
);

/**
 * The sizes, as things to pick up.
 *
 * Each is a button: PRESS it and cells of that size land in the first free
 * place; DRAG it and they land where it is dropped.
 *
 * "How many at a time" sits above them (the operator, 2026-10-05): one by
 * default, or a block — three across, two down, 2 mm apart — placed together.
 * The small grid icon beside a size fills the REST of the sheet with it, using
 * the same gap.
 */
function SizePalette({
  unit,
  onAdd,
  onFill,
}: {
  unit: StudioUnit;
  onAdd: (size: StudioSize, label: string, many: BlockChoice) => void;
  onFill: (size: StudioSize, label: string, gap: number) => void;
}) {
  const [custom, setCustom] = useState<StudioSize>({ width: mm(30), height: mm(40) });
  const [many, setMany] = useState<BlockChoice>({ rows: 1, columns: 1, gap: 0 });
  const customLabel = sizeName(Math.min(custom.width, custom.height), Math.max(custom.width, custom.height), unit);
  const count = many.rows * many.columns;
  const row = (size: StudioCellSize) => (
    <SizeRow
      key={size.key}
      size={size}
      many={many}
      onAdd={(one, label) => onAdd(one, label, many)}
      onFill={(one, label) => onFill(one, label, many.gap)}
    />
  );

  return (
    <Card title="Add cells">
      <fieldset className="flex flex-col gap-1.5 rounded-lg bg-muted/50 p-2">
        <legend className="sr-only">How many at a time</legend>
        <p className="text-xs font-semibold">How many at a time</p>
        <div className="grid grid-cols-3 gap-2">
          <CountField
            label="Across"
            value={many.columns}
            max={20}
            onChange={(columns) => setMany({ ...many, columns })}
          />
          <CountField label="Down" value={many.rows} max={20} onChange={(rows) => setMany({ ...many, rows })} />
          <LengthField label="Gap" unit={unit} value={many.gap} onCommit={(gap) => setMany({ ...many, gap })} />
        </div>
        <p className="text-xs text-muted-foreground">
          {count === 1
            ? 'Each press adds one cell.'
            : `Each press adds ${count} cells: ${many.columns} across, ${many.rows} down.`}
        </p>
      </fieldset>

      <p className="text-xs text-muted-foreground">Press a size to add it, or drag it onto the sheet.</p>
      <ul className="flex flex-col gap-1">{STUDIO_ID_SIZES.map(row)}</ul>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
          <ChevronDown aria-hidden="true" className="size-3.5 transition-transform group-open:rotate-180" />
          Photo paper sizes (2R, 4R…)
        </summary>
        <ul className="mt-1.5 flex flex-col gap-1">{PHOTO_CELL_SIZES.map(row)}</ul>
      </details>

      <div className="flex flex-col gap-2 border-t border-border pt-2.5">
        <p className="text-xs font-semibold">Your own size</p>
        <div className="grid grid-cols-2 gap-2">
          <LengthField
            label="Width"
            unit={unit}
            min={STUDIO_CELL_MIN}
            value={custom.width}
            onCommit={(width) => setCustom((current) => ({ ...current, width }))}
          />
          <LengthField
            label="Height"
            unit={unit}
            min={STUDIO_CELL_MIN}
            value={custom.height}
            onCommit={(height) => setCustom((current) => ({ ...current, height }))}
          />
        </div>
        <button
          type="button"
          className={buttonClass('secondary', 'sm')}
          onClick={() => onAdd(custom, customLabel, many)}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          Add {count === 1 ? customLabel : `${count} of ${customLabel}`}
        </button>
      </div>
    </Card>
  );
}

function SizeRow({
  size,
  many,
  onAdd,
  onFill,
}: {
  size: StudioCellSize;
  many: BlockChoice;
  onAdd: (size: StudioSize, label: string) => void;
  onFill: (size: StudioSize, label: string) => void;
}) {
  return (
    <li className="flex items-stretch gap-1">
      <button
        type="button"
        draggable
        className={cn(
          'group flex min-w-0 flex-1 cursor-grab items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5 text-left transition-colors hover:border-primary hover:bg-accent active:cursor-grabbing',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
        onClick={() => onAdd(size, size.label)}
        onDragStart={(event) => {
          event.dataTransfer.setData(
            SIZE_DRAG_TYPE,
            JSON.stringify({ width: size.width, height: size.height, label: size.label, ...many }),
          );
          event.dataTransfer.effectAllowed = 'copy';
        }}
      >
        <GripVertical aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/60" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{size.label}</span>
          <span className="block text-[11px] text-muted-foreground">
            {formatSize(size.width, size.height, size.unit)}
          </span>
        </span>
        <Plus aria-hidden="true" className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
      </button>
      <button
        type="button"
        aria-label={`Fill the rest of the sheet with ${size.label}`}
        title={`Fill the rest of the sheet with ${size.label}`}
        className={cn(buttonClass('ghost', 'sm'), 'h-auto flex-col gap-0 px-2 text-[10px] text-muted-foreground')}
        onClick={() => onFill(size, size.label)}
      >
        <LayoutGrid aria-hidden="true" className="size-3.5" />
        Fill
      </button>
    </li>
  );
}

// ── the selected cell ────────────────────────────────────────────────────────

function SelectedCell({
  cell,
  unit,
  onMove,
  onResize,
  onRotate,
  onDuplicate,
  onRemove,
}: {
  cell: StudioCell;
  unit: StudioUnit;
  onMove: (position: { x: number; y: number }) => void;
  onResize: (size: StudioSize) => void;
  onRotate: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  return (
    // Above the sheet, where the eye already is: what is selected, its exact numbers, and what can be done to it.
    <section
      aria-label="Selected cell"
      className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-xl border border-primary/50 bg-accent/40 px-3 py-2"
    >
      <p className="pb-2 text-sm font-semibold">{cell.label ?? 'Cell'}</p>
      <div className="grid w-80 grid-cols-4 gap-2">
        <LengthField
          label="Width"
          unit={unit}
          min={STUDIO_CELL_MIN}
          value={cell.width}
          onCommit={(width) => onResize({ width, height: cell.height })}
        />
        <LengthField
          label="Height"
          unit={unit}
          min={STUDIO_CELL_MIN}
          value={cell.height}
          onCommit={(height) => onResize({ width: cell.width, height })}
        />
        <LengthField label="Left" unit={unit} value={cell.x} onCommit={(x) => onMove({ x, y: cell.y })} />
        <LengthField label="Top" unit={unit} value={cell.y} onCommit={(y) => onMove({ x: cell.x, y })} />
      </div>
      <div className="ml-auto flex gap-1.5">
        <button type="button" className={buttonClass('secondary', 'sm')} onClick={onDuplicate}>
          <Copy aria-hidden="true" className="size-3.5" />
          Copy
        </button>
        <button type="button" className={buttonClass('secondary', 'sm')} onClick={onRotate}>
          <RotateCw aria-hidden="true" className="size-3.5" />
          Turn
        </button>
        <button type="button" className={cn(buttonClass('secondary', 'sm'), 'text-destructive')} onClick={onRemove}>
          <Trash2 aria-hidden="true" className="size-3.5" />
          Remove
        </button>
      </div>
    </section>
  );
}

// ── the page: paper and margins ──────────────────────────────────────────────

const CUSTOM = 'custom';
const SIDES = ['top', 'right', 'bottom', 'left'] as const satisfies readonly (keyof StudioMargins)[];
const SIDE_LABELS: Record<keyof StudioMargins, string> = { top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left' };

function PageSetup({
  spec,
  unit,
  onUnit,
  onChange,
}: {
  spec: StudioLayoutSpec;
  unit: StudioUnit;
  onUnit: (unit: StudioUnit) => void;
  onChange: (patch: Partial<StudioLayoutSpec>) => void;
}) {
  const id = useId();
  const known = findStudioPaper(spec.paper.key);
  const { margins } = spec;
  const marginText = SIDES.map((side) => lengthText(margins[side], unit)).join(' / ');

  /** A typed size is stored portrait, whichever way round it was typed. */
  function custom(width: number, height: number) {
    onChange({ paper: { key: null, label: '', width: Math.min(width, height), height: Math.max(width, height) } });
  }

  return (
    <Foldable title="Paper and margins" summary={`${paperName(spec, unit)} · margins ${marginText} ${unit}`}>
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
          Paper
        </label>
        <select
          id={id}
          className={cn(INPUT_CLASS, 'h-9')}
          value={known ? known.key : CUSTOM}
          onChange={(event) => {
            const paper = findStudioPaper(event.target.value);
            if (!paper) return custom(spec.paper.width, spec.paper.height);
            onChange({ paper: { key: paper.key, label: paper.label, width: paper.width, height: paper.height } });
          }}
        >
          <optgroup label="Office papers">
            {STUDIO_PAPERS.filter((paper) => paper.group === 'office').map((paper) => (
              <option key={paper.key} value={paper.key}>
                {paperOption(paper)}
              </option>
            ))}
          </optgroup>
          <optgroup label="Photo papers">
            {STUDIO_PAPERS.filter((paper) => paper.group === 'photo').map((paper) => (
              <option key={paper.key} value={paper.key}>
                {paperOption(paper)}
              </option>
            ))}
          </optgroup>
          <option value={CUSTOM}>Custom size…</option>
        </select>
      </div>
      {known ? null : (
        <div className="grid grid-cols-2 gap-2">
          <LengthField
            label="Width"
            unit={unit}
            value={spec.paper.width}
            min={STUDIO_PAPER_MIN}
            onCommit={(width) => custom(width, spec.paper.height)}
          />
          <LengthField
            label="Height"
            unit={unit}
            value={spec.paper.height}
            min={STUDIO_PAPER_MIN}
            onCommit={(height) => custom(spec.paper.width, height)}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<StudioOrientation>
          label="Orientation"
          value={spec.orientation}
          onChange={(orientation) => onChange({ orientation })}
          options={[
            { value: 'portrait', label: 'Portrait' },
            { value: 'landscape', label: 'Landscape' },
          ]}
        />
        <Segmented
          label="Units"
          value={unit}
          onChange={onUnit}
          options={STUDIO_UNITS.map((one) => ({ value: one, label: one }))}
        />
      </div>

      <p className="border-t border-border pt-2.5 text-xs font-semibold">Margins — what the printer cannot reach</p>
      <div className="grid grid-cols-2 gap-2">
        {SIDES.map((side) => (
          <LengthField
            key={side}
            label={SIDE_LABELS[side]}
            unit={unit}
            value={margins[side]}
            onCommit={(value) => onChange({ margins: { ...margins, [side]: value } })}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">The grey border on the sheet is the margin. Cells stay inside it.</p>
    </Foldable>
  );
}

function paperOption(paper: { label: string; alias?: string; width: number; height: number; unit: StudioUnit }) {
  const name = paper.alias ? `${paper.label} / ${paper.alias}` : paper.label;
  return `${name} — ${formatSize(paper.width, paper.height, paper.unit)}`;
}

// ── the rest: a grid, the cut guides, starting over ──────────────────────────

function MoreTools({
  area,
  unit,
  hasCells,
  guides,
  border,
  onGuides,
  onBorder,
  onSplit,
  onClear,
}: {
  area: StudioSize;
  unit: StudioUnit;
  hasCells: boolean;
  guides: boolean;
  border: StudioBorder;
  onGuides: (guides: boolean) => void;
  onBorder: (border: StudioBorder) => void;
  onSplit: (rows: number, columns: number, gap: number) => void;
  onClear: () => void;
}) {
  const [rows, setRows] = useState(2);
  const [columns, setColumns] = useState(2);
  return (
    <Foldable title="Border and more" summary={`${borderSummary(guides, border)} · equal grid · start over`}>
      <BorderControls on={guides} border={border} onOn={onGuides} onBorder={onBorder} />

      <p className="border-t border-border pt-2.5 text-xs font-semibold">Divide the sheet into equal cells</p>
      <div className="grid grid-cols-3 items-end gap-2">
        <CountField label="Rows" value={rows} onChange={setRows} max={20} />
        <CountField label="Columns" value={columns} onChange={setColumns} max={20} />
        <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => onSplit(rows, columns, 0)}>
          Divide
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        This replaces every cell with {rows * columns} equal ones, each{' '}
        {formatSize(Math.floor(area.width / columns), Math.floor(area.height / rows), unit)}.
      </p>

      {hasCells ? (
        <button
          type="button"
          className={cn(buttonClass('ghost', 'sm'), 'self-start text-destructive')}
          onClick={onClear}
        >
          <Trash2 aria-hidden="true" className="size-3.5" />
          Remove every cell
        </button>
      ) : null}
    </Foldable>
  );
}
