'use client';

import { useDraggable, useDroppable } from '@dnd-kit/core';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kwtech/web-ui/react';
import { EllipsisVertical, GripVertical, X } from 'lucide-react';
import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, useRef } from 'react';
import {
  type AppHubGrid,
  assignCell,
  cellPosition,
  hasMainView,
  MAIN_CELL_INDEX,
  resizeTracks,
  swapCells,
} from '../../domain/layout.js';
import type { AppHubEntry } from '../types.js';
import { AppIcon, buttonClass } from './ui.js';

/** The gap between cells, in pixels — also the width of a border's drag handle. */
const GAP_PX = 8;

/** How far one arrow-key press moves a border, as a fraction of the grid. */
const KEYBOARD_STEP = 0.02;

/** Drag ids: a cell by its index, an app from the side list by its key. */
export const cellId = (index: number) => `cell:${index}`;
export const appId = (key: string) => `app:${key}`;

/**
 * Where each app is on screen — see `AppStage`.
 *
 * 'tab': the tab view; visible when it is the open tab.
 * 'cell': in the grid, at `index` (reading order).
 * 'off': mounted earlier and kept alive, but not shown in this view.
 */
type Placement = { kind: 'tab'; visible: boolean } | { kind: 'cell'; index: number } | { kind: 'off' };

/**
 * Where one track sits along an axis, as CSS: `sizes` share what is left of the
 * length after the gaps between them, and track `index` starts after the ones
 * before it and their gaps.
 */
function track(sizes: readonly number[], index: number): { start: string; length: string } {
  const gaps = GAP_PX * (sizes.length - 1);
  const before = sizes.slice(0, index).reduce((sum, size) => sum + size, 0);
  return {
    start: `calc((100% - ${gaps}px) * ${before} + ${index * GAP_PX}px)`,
    length: `calc((100% - ${gaps}px) * ${sizes[index] ?? 0})`,
  };
}

/**
 * Cell `index`'s box inside the stage. Absolute rather than a CSS grid track,
 * because each column stacks its own number of cells: a column of one (the main
 * view) beside a column of three shares no rows with it.
 */
function cellBox(grid: AppHubGrid, index: number): CSSProperties {
  const at = cellPosition(grid, index);
  if (!at) return { display: 'none' };
  const across = track(grid.columnSizes, at.column);
  const down = track(grid.rowSizes[at.column] ?? [1], at.row);
  return { position: 'absolute', left: across.start, width: across.length, top: down.start, height: down.length };
}

/**
 * How a cell is named in menus and to screen readers. With a main view, cell 0
 * is it and the rest are numbered secondary views; a grid without one (saved
 * before the presets) is named by column and position.
 */
function cellName(grid: AppHubGrid, index: number): string {
  if (hasMainView(grid)) return index === MAIN_CELL_INDEX ? 'Main view' : `Secondary view ${index}`;
  const at = cellPosition(grid, index);
  return at ? `Column ${at.column + 1}, cell ${at.row + 1}` : `Cell ${index + 1}`;
}

/**
 * THE STAGE: every app the viewer has opened, rendered ONCE, in one container.
 *
 * ⚠ The app elements are children of this one container in a fixed order,
 * keyed by app, and the view only changes their position — or hides them.
 * Switching between tabs and grid, swapping two cells or reordering tabs
 * therefore never remounts an app: the queue console keeps its state and its
 * socket. Rendering each view with its own containers would look
 * the same and quietly reload every app on every move.
 *
 * An app mounts the first time it is shown and stays mounted after (hidden),
 * so returning to it is instant; ten apps are not all started at page load.
 */
export function AppStage({
  mode,
  grid,
  activeTab,
  apps,
  labels,
  mounted,
  onGridChange,
}: {
  mode: 'tabs' | 'grid';
  grid: AppHubGrid;
  activeTab: string | null;
  /** The apps the viewer HOLDS, in default order. */
  apps: readonly AppHubEntry[];
  /** Every declared app's label, held or not — a cell names an app it can no longer show. */
  labels: ReadonlyMap<string, string>;
  mounted: ReadonlySet<string>;
  onGridChange(grid: AppHubGrid, options?: { persist?: boolean }): void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const held = new Set(apps.map((app) => app.key));

  const placementOf = (key: string): Placement => {
    if (mode === 'tabs') return { kind: 'tab', visible: key === activeTab };
    const index = grid.cells.indexOf(key);
    return index === -1 ? { kind: 'off' } : { kind: 'cell', index };
  };

  // Apps not yet in the grid — what an empty cell's picker offers.
  const unplaced = apps.filter((app) => !grid.cells.includes(app.key));
  const main = hasMainView(grid);
  const describe = (index: number) => {
    const key = grid.cells[index];
    return `${cellName(grid, index)} — ${key ? (labels.get(key) ?? key) : 'empty'}`;
  };
  const cellTools = (index: number): CellTools => ({
    index,
    name: cellName(grid, index),
    isMain: main && index === MAIN_CELL_INDEX,
    // A secondary view may be promoted; it swaps with whatever is in the main view.
    makeMain: main && index !== MAIN_CELL_INDEX ? () => onGridChange(swapCells(grid, index, MAIN_CELL_INDEX)) : null,
    box: cellBox(grid, index),
    unplaced,
    moveTargets: grid.cells
      .map((_, other) => ({ index: other, label: describe(other) }))
      .filter((t) => t.index !== index),
    assign: (key) => onGridChange(assignCell(grid, index, key)),
    moveTo: (other) => onGridChange(swapCells(grid, index, other)),
    clear: () => onGridChange(assignCell(grid, index, null)),
  });

  return (
    <div ref={stage} className="relative h-full min-h-0 w-full">
      {apps.map((app) => {
        if (!mounted.has(app.key)) return null;
        const placement = placementOf(app.key);
        return (
          <AppFrame
            key={app.key}
            app={app}
            placement={placement}
            tools={placement.kind === 'cell' ? cellTools(placement.index) : null}
          >
            {app.element}
          </AppFrame>
        );
      })}

      {mode === 'grid'
        ? grid.cells.map((key, index) => {
            // A held app draws its own frame (it mounts on the next effect if it has not yet).
            if (key !== null && held.has(key)) return null;
            const tools = cellTools(index);
            // Keyed by POSITION: an empty cell has no app to be keyed by, and a cell is a place.
            const place = `${grid.columns.join('-')}:${index}`;
            return key === null ? (
              <EmptyCell key={`empty:${place}`} tools={tools} />
            ) : (
              <DeniedCell key={`denied:${place}`} tools={tools} label={labels.get(key) ?? key} appKey={key} />
            );
          })
        : null}

      {mode === 'grid' ? <TrackHandles stage={stage} grid={grid} onGridChange={onGridChange} /> : null}
    </div>
  );
}

interface CellTools {
  index: number;
  /** 'Main view', 'Secondary view 2'… */
  name: string;
  isMain: boolean;
  /** Swap this secondary view into the main view; null for the main view itself. */
  makeMain: (() => void) | null;
  box: CSSProperties;
  unplaced: readonly AppHubEntry[];
  moveTargets: readonly { index: number; label: string }[];
  assign(key: string): void;
  moveTo(index: number): void;
  clear(): void;
}

// ── one app ─────────────────────────────────────────────────────────────────

function AppFrame({
  app,
  placement,
  tools,
  children,
}: {
  app: AppHubEntry;
  placement: Placement;
  tools: CellTools | null;
  children: ReactNode;
}) {
  const inCell = placement.kind === 'cell';
  // A frame outside the grid gets an id of its own: two registrations under one id confuse the sensors.
  const id = tools ? cellId(tools.index) : `frame:${app.key}`;
  // Hooks run for every frame, every render; disabled outside the grid.
  const drop = useDroppable({ id, disabled: !inCell });
  const drag = useDraggable({ id, disabled: !inCell, data: { label: app.label, icon: app.icon } });
  const visible = placement.kind === 'cell' || (placement.kind === 'tab' && placement.visible);

  return (
    <section
      ref={drop.setNodeRef}
      aria-label={tools ? `${app.label} — ${tools.name}` : app.label}
      style={tools ? tools.box : { position: 'absolute', inset: 0 }}
      className={cn(
        visible ? 'flex' : 'hidden',
        'min-h-0 min-w-0 flex-col overflow-hidden',
        inCell && 'rounded-lg border bg-background',
        // The main view reads as the working window; secondary views as extensions of it.
        inCell && (tools?.isMain ? 'border-primary/50' : 'border-border'),
        inCell && drop.isOver && 'ring-2 ring-primary',
        inCell && drag.isDragging && 'opacity-50',
      )}
    >
      {tools ? (
        <CellHeader
          tools={tools}
          handle={
            <span
              ref={drag.setNodeRef}
              {...drag.attributes}
              {...drag.listeners}
              title="Drag to move this app to another cell"
              className="flex min-w-0 flex-1 cursor-grab items-center gap-2 active:cursor-grabbing"
            >
              <GripVertical aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <AppIcon name={app.icon} />
              <span className="truncate text-sm font-medium text-foreground">{app.label}</span>
              {tools.isMain ? (
                <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                  Main
                </span>
              ) : null}
            </span>
          }
        />
      ) : null}
      {/*
        The app scrolls inside its frame; the page around it never does. No
        padding here: an app fills its box edge to edge and pads itself (the
        sub-app contract), so padding here too doubled the gutter in a cell.
      */}
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}

/**
 * A cell's title bar. ONLY `handle` starts a drag, so clicks, typing and
 * scrolling inside the app below can never pick the cell up.
 */
function CellHeader({ tools, handle }: { tools: CellTools; handle: ReactNode }) {
  return (
    <header className="flex items-center gap-1 border-b border-border bg-muted/40 px-2 py-1">
      {handle}
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(buttonClass('ghost', 'sm'), 'size-7 px-0')} aria-label="Cell options">
          <EllipsisVertical aria-hidden className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <CellMenuItems tools={tools} />
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        className={cn(buttonClass('ghost', 'sm'), 'size-7 px-0')}
        aria-label="Empty this cell"
        title="Empty this cell"
        onClick={tools.clear}
      >
        <X aria-hidden className="size-4" />
      </button>
    </header>
  );
}

/** Put another app here, move this one elsewhere (keyboard and touch), or empty the cell. */
function CellMenuItems({ tools, emptyCell = false }: { tools: CellTools; emptyCell?: boolean }) {
  return (
    <>
      {tools.unplaced.length > 0 ? (
        <>
          <DropdownMenuLabel>{emptyCell ? 'Show here' : 'Replace with'}</DropdownMenuLabel>
          {tools.unplaced.map((app) => (
            <DropdownMenuItem key={app.key} onSelect={() => tools.assign(app.key)}>
              <AppIcon name={app.icon} />
              {app.label}
            </DropdownMenuItem>
          ))}
        </>
      ) : emptyCell ? (
        <DropdownMenuLabel>Every app you have is already in the grid.</DropdownMenuLabel>
      ) : null}
      {tools.makeMain ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={tools.makeMain}>Make this the main view</DropdownMenuItem>
        </>
      ) : null}
      {!emptyCell && tools.moveTargets.length > 0 ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Move to</DropdownMenuLabel>
          {tools.moveTargets.map((target) => (
            <DropdownMenuItem key={target.index} onSelect={() => tools.moveTo(target.index)}>
              {target.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={tools.clear}>Empty this cell</DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}

// ── cells without a running app ─────────────────────────────────────────────

function EmptyCell({ tools }: { tools: CellTools }) {
  const drop = useDroppable({ id: cellId(tools.index) });
  return (
    <div
      ref={drop.setNodeRef}
      style={tools.box}
      className={cn(
        'flex min-h-0 min-w-0 flex-col items-center justify-center gap-2 rounded-lg border border-dashed',
        tools.isMain ? 'border-primary/50' : 'border-border',
        drop.isOver && 'border-primary bg-primary/5',
      )}
    >
      <span className="text-xs text-muted-foreground">{tools.name}</span>
      <DropdownMenu>
        <DropdownMenuTrigger className={buttonClass('secondary')}>+ Choose an app</DropdownMenuTrigger>
        <DropdownMenuContent>
          <CellMenuItems tools={tools} emptyCell />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * A cell naming an app the viewer no longer holds. Said, not hidden: a grid
 * that silently lost a cell reads as a bug (principle 2 — say why).
 */
function DeniedCell({ tools, label, appKey }: { tools: CellTools; label: string; appKey: string }) {
  const drop = useDroppable({ id: cellId(tools.index) });
  return (
    <div
      ref={drop.setNodeRef}
      style={tools.box}
      data-app={appKey}
      className={cn(
        'flex min-h-0 min-w-0 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-muted/30 p-4 text-center',
        drop.isOver && 'ring-2 ring-primary',
      )}
    >
      <p className="max-w-sm text-sm text-muted-foreground">
        You no longer have access to <span className="font-medium text-foreground">{label}</span> in this workspace.
        Your roles here, or your organization&apos;s plan, do not include it.
      </p>
      <button type="button" className={buttonClass('secondary', 'sm')} onClick={tools.clear}>
        Empty this cell
      </button>
    </div>
  );
}

// ── resizing ────────────────────────────────────────────────────────────────

/**
 * Which sizes a border moves: the column widths, or the heights of the cells
 * stacked in one column.
 */
type Axis = { kind: 'columns' } | { kind: 'rows'; column: number };

function sizesOf(grid: AppHubGrid, axis: Axis): number[] {
  return axis.kind === 'columns' ? grid.columnSizes : (grid.rowSizes[axis.column] ?? [1]);
}

function withSizes(grid: AppHubGrid, axis: Axis, sizes: number[]): AppHubGrid {
  if (axis.kind === 'columns') return { ...grid, columnSizes: sizes };
  return { ...grid, rowSizes: grid.rowSizes.map((column, index) => (index === axis.column ? sizes : column)) };
}

/**
 * An ellipsis at the middle of a border, so it reads as something to drag — a
 * bare 8px gap looks like empty space. Three dots along the border (stacked on
 * a vertical one, in a row on a horizontal one), sized to fit inside the gap.
 * Decorative: the separator itself carries the role and label.
 */
function Grip({ vertical }: { vertical: boolean }) {
  return (
    <span aria-hidden className={cn('pointer-events-none flex gap-0.5', vertical ? 'flex-col' : 'flex-row')}>
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className="size-1 rounded-full bg-muted-foreground/60 transition-colors group-hover:bg-primary group-focus-visible:bg-primary-foreground"
        />
      ))}
    </span>
  );
}

/**
 * The draggable borders, laid over the gaps between cells.
 *
 * A vertical border resizes the two columns beside it, full height. A
 * horizontal one resizes two cells stacked in ONE column and spans only that
 * column — the main view's height is never tied to a secondary column's rows.
 * A drag shows every move and saves once, on release. Each border is also a
 * focusable separator: ← → (or ↑ ↓) move it from the keyboard.
 */
function TrackHandles({
  stage,
  grid,
  onGridChange,
}: {
  stage: React.RefObject<HTMLDivElement | null>;
  grid: AppHubGrid;
  onGridChange(grid: AppHubGrid, options?: { persist?: boolean }): void;
}) {
  const drag = useRef<{ axis: Axis; index: number; start: number; sizes: number[]; span: number } | null>(null);
  const latest = useRef(grid);
  latest.current = grid;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>, axis: Axis, index: number) => {
    const box = stage.current?.getBoundingClientRect();
    if (!box) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const sizes = sizesOf(grid, axis);
    const vertical = axis.kind === 'columns';
    drag.current = {
      axis,
      index,
      start: vertical ? event.clientX : event.clientY,
      sizes: [...sizes],
      // The tracks share what is left after the gaps.
      span: (vertical ? box.width : box.height) - GAP_PX * (sizes.length - 1),
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.span <= 0) return;
    const position = current.axis.kind === 'columns' ? event.clientX : event.clientY;
    const sizes = resizeTracks(current.sizes, current.index, (position - current.start) / current.span);
    onGridChange(withSizes(latest.current, current.axis, sizes), { persist: false });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onGridChange(latest.current);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, axis: Axis, index: number) => {
    const back = axis.kind === 'columns' ? 'ArrowLeft' : 'ArrowUp';
    const forward = axis.kind === 'columns' ? 'ArrowRight' : 'ArrowDown';
    if (event.key !== back && event.key !== forward) return;
    event.preventDefault();
    const step = event.key === forward ? KEYBOARD_STEP : -KEYBOARD_STEP;
    onGridChange(withSizes(grid, axis, resizeTracks(sizesOf(grid, axis), index, step)));
  };

  const handle = (axis: Axis, index: number, place: CSSProperties, label: string) => {
    const sizes = sizesOf(grid, axis);
    const before = sizes.slice(0, index + 1).reduce((sum, size) => sum + size, 0);
    const vertical = axis.kind === 'columns';
    return (
      // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be focused or dragged; this is the ARIA window-splitter pattern.
      <div
        key={vertical ? `columns:${index}` : `rows:${axis.column}:${index}`}
        role="separator"
        tabIndex={0}
        aria-orientation={vertical ? 'vertical' : 'horizontal'}
        aria-valuenow={Math.round(before * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        onPointerDown={(event) => onPointerDown(event, axis, index)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(event) => onKeyDown(event, axis, index)}
        style={place}
        className={cn(
          'group absolute z-10 flex touch-none items-center justify-center rounded-full transition-colors hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none',
          vertical ? 'cursor-col-resize' : 'cursor-row-resize',
        )}
      >
        <Grip vertical={vertical} />
      </div>
    );
  };

  /** The middle of the gap after track `index`, along one axis. */
  const gapMiddle = (sizes: readonly number[], index: number) => {
    const next = track(sizes, index + 1).start;
    return `calc(${next} - ${GAP_PX / 2}px)`;
  };

  const handles: ReactNode[] = [];
  for (let index = 0; index < grid.columns.length - 1; index += 1) {
    const left = gapMiddle(grid.columnSizes, index);
    const label = index === 0 && hasMainView(grid) ? 'Border beside the main view' : `Border after column ${index + 1}`;
    handles.push(
      handle(
        { kind: 'columns' },
        index,
        { left, top: 0, bottom: 0, width: GAP_PX, transform: 'translateX(-50%)' },
        label,
      ),
    );
  }
  for (const [column, rows] of grid.columns.entries()) {
    const across = track(grid.columnSizes, column);
    const sizes = grid.rowSizes[column] ?? [1];
    for (let index = 0; index < rows - 1; index += 1) {
      handles.push(
        handle(
          { kind: 'rows', column },
          index,
          {
            top: gapMiddle(sizes, index),
            left: across.start,
            width: across.length,
            height: GAP_PX,
            transform: 'translateY(-50%)',
          },
          `Border after cell ${index + 1} in column ${column + 1}`,
        ),
      );
    }
  }
  return <>{handles}</>;
}
