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
import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, useRef } from 'react';
import { type AppHubGrid, assignCell, resizeTracks, swapCells } from '../../domain/layout.js';
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
 * THE STAGE: every app the viewer has opened, rendered ONCE, in one CSS grid.
 *
 * ⚠ The app elements are children of this one container in a fixed order,
 * keyed by app, and the view only changes their `grid-row` / `grid-column` —
 * or hides them. Switching between tabs and grid, swapping two cells or
 * reordering tabs therefore never remounts an app: the queue console keeps its
 * state and its socket. Rendering each view with its own containers would look
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

  const style: CSSProperties =
    mode === 'grid'
      ? {
          gridTemplateRows: grid.rowSizes.map((size) => `minmax(0, ${size}fr)`).join(' '),
          gridTemplateColumns: grid.columnSizes.map((size) => `minmax(0, ${size}fr)`).join(' '),
          gap: GAP_PX,
        }
      : { gridTemplateRows: 'minmax(0, 1fr)', gridTemplateColumns: 'minmax(0, 1fr)' };

  // Apps not yet in the grid — what an empty cell's picker offers.
  const unplaced = apps.filter((app) => !grid.cells.includes(app.key));
  const describe = (index: number) => {
    const key = grid.cells[index];
    const where = `Row ${Math.floor(index / grid.columns) + 1}, column ${(index % grid.columns) + 1}`;
    return key ? `${where} — ${labels.get(key) ?? key}` : `${where} — empty`;
  };
  const cellTools = (index: number): CellTools => ({
    index,
    position: { gridRow: Math.floor(index / grid.columns) + 1, gridColumn: (index % grid.columns) + 1 },
    unplaced,
    moveTargets: grid.cells
      .map((_, other) => ({ index: other, label: describe(other) }))
      .filter((t) => t.index !== index),
    assign: (key) => onGridChange(assignCell(grid, index, key)),
    moveTo: (other) => onGridChange(swapCells(grid, index, other)),
    clear: () => onGridChange(assignCell(grid, index, null)),
  });

  return (
    <div ref={stage} className="relative grid h-full min-h-0 w-full" style={style}>
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
            const place = `${tools.position.gridRow}-${tools.position.gridColumn}`;
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
  position: { gridRow: number; gridColumn: number };
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
      aria-label={app.label}
      style={tools ? tools.position : { gridRow: 1, gridColumn: 1 }}
      className={cn(
        visible ? 'flex' : 'hidden',
        'min-h-0 min-w-0 flex-col overflow-hidden',
        inCell && 'rounded-lg border border-border bg-background',
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
              <span aria-hidden className="text-muted-foreground">
                ⠿
              </span>
              <AppIcon name={app.icon} />
              <span className="truncate text-sm font-medium text-foreground">{app.label}</span>
            </span>
          }
        />
      ) : null}
      {/* The app scrolls inside its frame; the page around it never does. */}
      <div className={cn('min-h-0 flex-1 overflow-auto', inCell ? 'p-3' : 'pt-4')}>{children}</div>
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
        <DropdownMenuTrigger className={buttonClass('ghost', 'sm')} aria-label="Cell options">
          ▾
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <CellMenuItems tools={tools} />
        </DropdownMenuContent>
      </DropdownMenu>
      <button type="button" className={buttonClass('ghost', 'sm')} aria-label="Empty this cell" onClick={tools.clear}>
        ×
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
      style={tools.position}
      className={cn(
        'flex min-h-0 min-w-0 items-center justify-center rounded-lg border border-dashed border-border',
        drop.isOver && 'border-primary bg-primary/5',
      )}
    >
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
      style={tools.position}
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
 * The draggable borders, laid over the gaps between tracks.
 *
 * A vertical border resizes the two columns beside it across EVERY row, and a
 * horizontal one the two rows across every column, so the grid stays a grid.
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
  const drag = useRef<{ axis: 'columns' | 'rows'; index: number; start: number; sizes: number[]; span: number } | null>(
    null,
  );
  const latest = useRef(grid);
  latest.current = grid;

  const sizesKey = (axis: 'columns' | 'rows') => (axis === 'columns' ? 'columnSizes' : 'rowSizes');

  const onPointerDown = (event: PointerEvent<HTMLDivElement>, axis: 'columns' | 'rows', index: number) => {
    const box = stage.current?.getBoundingClientRect();
    if (!box) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const count = axis === 'columns' ? grid.columns : grid.rows;
    drag.current = {
      axis,
      index,
      start: axis === 'columns' ? event.clientX : event.clientY,
      sizes: [...grid[sizesKey(axis)]],
      // The tracks share what is left after the gaps.
      span: (axis === 'columns' ? box.width : box.height) - GAP_PX * (count - 1),
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.span <= 0) return;
    const position = current.axis === 'columns' ? event.clientX : event.clientY;
    const sizes = resizeTracks(current.sizes, current.index, (position - current.start) / current.span);
    onGridChange({ ...latest.current, [sizesKey(current.axis)]: sizes }, { persist: false });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onGridChange(latest.current);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, axis: 'columns' | 'rows', index: number) => {
    const back = axis === 'columns' ? 'ArrowLeft' : 'ArrowUp';
    const forward = axis === 'columns' ? 'ArrowRight' : 'ArrowDown';
    if (event.key !== back && event.key !== forward) return;
    event.preventDefault();
    const sizes = resizeTracks(grid[sizesKey(axis)], index, event.key === forward ? KEYBOARD_STEP : -KEYBOARD_STEP);
    onGridChange({ ...grid, [sizesKey(axis)]: sizes });
  };

  const handles: ReactNode[] = [];
  for (const axis of ['columns', 'rows'] as const) {
    const sizes = grid[sizesKey(axis)];
    let before = 0;
    for (let index = 0; index < sizes.length - 1; index += 1) {
      before += sizes[index] ?? 0;
      const gaps = GAP_PX * (sizes.length - 1);
      // The middle of the gap after track `index`.
      const offset = `calc((100% - ${gaps}px) * ${before} + ${index * GAP_PX + GAP_PX / 2}px)`;
      const vertical = axis === 'columns';
      handles.push(
        // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be focused or dragged; this is the ARIA window-splitter pattern.
        <div
          key={`${axis}:${index}`}
          role="separator"
          tabIndex={0}
          aria-orientation={vertical ? 'vertical' : 'horizontal'}
          aria-valuenow={Math.round(before * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={vertical ? `Border after column ${index + 1}` : `Border after row ${index + 1}`}
          onPointerDown={(event) => onPointerDown(event, axis, index)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={(event) => onKeyDown(event, axis, index)}
          style={
            vertical
              ? { left: offset, top: 0, bottom: 0, width: GAP_PX, transform: 'translateX(-50%)' }
              : { top: offset, left: 0, right: 0, height: GAP_PX, transform: 'translateY(-50%)' }
          }
          className={cn(
            'absolute z-10 touch-none rounded-full transition-colors hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none',
            vertical ? 'cursor-col-resize' : 'cursor-row-resize',
          )}
        />,
      );
    }
  }
  return <>{handles}</>;
}
