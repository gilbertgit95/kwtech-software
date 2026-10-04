'use client';

import { useDraggable } from '@dnd-kit/core';
import { cn, Tooltip, type TooltipTriggerProps } from '@kwtech/web-ui/react';
import { ChevronLeft, GripVertical } from 'lucide-react';
import { type KeyboardEvent, type PointerEvent, useId, useRef, useState } from 'react';
import { type AppHubGrid, assignCell } from '../../domain/layout.js';
import type { AppHubEntry } from '../types.js';
import {
  APP_LIST_STORAGE_KEY,
  APP_LIST_WIDTH,
  appListWidthAfterKey,
  clampAppListWidth,
  DEFAULT_APP_LIST,
  parseStoredAppList,
  type StoredAppList,
} from '../view/app-list.js';
import { appId } from './app-stage.js';
import { AppIcon, buttonClass } from './ui.js';

/**
 * The apps the viewer holds, beside the grid: drag one onto a cell, or add it
 * to the first empty one.
 *
 * It works like the app's main drawer. The arrow on its edge collapses it to a
 * rail of icons, which still drag, and the edge itself drags to resize it.
 * Collapsing never takes the list away: with it gone there was no way to put
 * an app in a cell without first finding the button that brought it back.
 *
 * ⚠ Must be rendered inside the page's `DndContext` (`GridDnd`): its rows are
 * draggables of that context.
 */
export function AppList({
  apps,
  grid,
  onGridChange,
}: {
  apps: readonly AppHubEntry[];
  grid: AppHubGrid;
  onGridChange(grid: AppHubGrid): void;
}) {
  const listId = useId();
  /*
   * Read in the initialiser, not in an effect, so the list arrives at its
   * remembered width instead of opening wide and snapping shut.
   *
   * ⚠ Safe only because this component never renders on the server: the grid
   * appears after the layout has loaded and `useWideScreen` has measured, both
   * of which happen after hydration. The guard is for the day that changes.
   */
  const [stored, setStored] = useState<StoredAppList>(readStored);
  const { collapsed, width } = stored;
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ pointerId: number; fromX: number; start: number } | null>(null);

  const remember = (next: StoredAppList) => {
    setStored(next);
    writeStored(next);
  };

  const resizeTo = (next: number) => remember({ collapsed, width: clampAppListWidth(next) });

  /*
   * Stored once, on release, not on every move: a drag emits a pointer event
   * per frame and nothing reads the stored width until the next page load.
   */
  const onResizeStart = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Stops the press from starting a text selection across the apps beside it.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, fromX: event.clientX, start: width };
    setResizing(true);
  };

  const onResizeMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    setStored({ collapsed, width: clampAppListWidth(active.start + event.clientX - active.fromX) });
  };

  const onResizeEnd = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    setResizing(false);
    resizeTo(active.start + event.clientX - active.fromX);
  };

  const onResizeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = appListWidthAfterKey(width, event.key, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    resizeTo(next);
  };

  const firstEmpty = grid.cells.indexOf(null);
  return (
    <aside
      aria-label="Your apps"
      data-collapsed={collapsed ? '' : undefined}
      // Inline only while expanded: the collapsed width is the class below, and an inline width would override it.
      style={collapsed ? undefined : { width }}
      className={cn(
        // max-w keeps a width chosen on a wide monitor from swallowing the grid on a laptop.
        'relative flex max-w-[40%] shrink-0 flex-col rounded-lg border border-border bg-muted/20',
        // No transition while dragging: the ease is for the collapse, and on a drag the edge would trail the pointer.
        resizing ? 'select-none' : 'transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
        // Wide enough for the grip beside the icon; narrower and one of them has to go.
        collapsed && 'w-14',
      )}
    >
      {/*
       * THE RESIZE HANDLE: the list's right edge, widened to an 8px hit area
       * that straddles it. Below the collapse arrow (z-10 against its z-20), so
       * the arrow stays clickable where the two overlap. Not rendered while
       * collapsed: the rail is a fixed width. Double-click puts the default back.
       */}
      {collapsed ? null : (
        <Tooltip text="Drag to resize · double-click to reset" side="right">
          {(tooltip) => (
            // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot take focus or pointer events; a focusable separator is the ARIA window-splitter pattern.
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the app list"
              aria-controls={listId}
              aria-valuenow={width}
              aria-valuemin={APP_LIST_WIDTH.min}
              aria-valuemax={APP_LIST_WIDTH.max}
              tabIndex={0}
              {...tooltip}
              // Both, for the two events the handle and the hint each listen to: a later prop replaces the spread one.
              onPointerDown={(event) => {
                tooltip.onPointerDown();
                onResizeStart(event);
              }}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeEnd}
              onPointerCancel={onResizeEnd}
              onKeyDown={(event) => {
                tooltip.onKeyDown(event);
                onResizeKey(event);
              }}
              onDoubleClick={() => resizeTo(APP_LIST_WIDTH.default)}
              className={cn(
                // touch-none: a finger dragging the edge resizes instead of scrolling.
                'absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none',
                'after:absolute after:inset-y-2 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:transition-colors',
                'hover:after:bg-primary/40 focus-visible:outline-none focus-visible:after:bg-ring',
                resizing && 'after:bg-primary/60',
              )}
            />
          )}
        </Tooltip>
      )}
      {/*
       * The same arrow as the main drawer's, ON the edge it moves and always
       * visible. It used to be a button at the start of the toolbar, a row away
       * from the panel it opened and closed.
       */}
      {/* Its sr-only text is its name, so the hint is not also a description. */}
      <Tooltip text={collapsed ? 'Expand the app list' : 'Collapse the app list'} side="right" describes={false}>
        {(tooltip) => (
          <button
            type="button"
            onClick={() => remember({ collapsed: !collapsed, width })}
            aria-expanded={!collapsed}
            aria-controls={listId}
            className={cn(
              'absolute -right-3 top-2 z-20 grid size-6 place-items-center rounded-full',
              'border border-border bg-card text-muted-foreground shadow-sm',
              'transition-[transform,color,border-color,box-shadow] duration-200 ease-out',
              'hover:scale-110 hover:border-primary/40 hover:text-foreground hover:shadow-md',
              'active:scale-95',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
            {...tooltip}
          >
            {/* One chevron that turns with the panel, not two icons that swap. */}
            <ChevronLeft
              aria-hidden
              className={cn(
                'size-3.5 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
                collapsed && 'rotate-180',
              )}
            />
            <span className="sr-only">{collapsed ? 'Expand the app list' : 'Collapse the app list'}</span>
          </button>
        )}
      </Tooltip>

      {/*
       * The scroller is INSIDE the panel rather than the panel itself: the arrow
       * and the handle hang off the edge, and `overflow` on their parent would
       * clip them.
       */}
      <div
        id={listId}
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto',
          // pt-9 clears the arrow, which overlaps the rail's first icon otherwise.
          collapsed ? 'items-center px-1.5 pt-9 pb-2' : 'p-2',
        )}
      >
        {collapsed ? null : (
          // pr-3 keeps the hint clear of the arrow on its edge.
          <p className="truncate px-1 pr-3 pb-1 text-xs font-medium text-muted-foreground">Drag an app onto a cell</p>
        )}
        {apps.map((app) => {
          const placed = grid.cells.includes(app.key);
          return (
            <DraggableApp
              key={app.key}
              app={app}
              placed={placed}
              collapsed={collapsed}
              onAdd={placed || firstEmpty === -1 ? null : () => onGridChange(assignCell(grid, firstEmpty, app.key))}
            />
          );
        })}
      </div>
    </aside>
  );
}

function DraggableApp({
  app,
  placed,
  collapsed,
  onAdd,
}: {
  app: AppHubEntry;
  placed: boolean;
  collapsed: boolean;
  onAdd: (() => void) | null;
}) {
  const drag = useDraggable({ id: appId(app.key) });

  if (collapsed) {
    return (
      // The name is off screen here, so the hint is what shows it — to the right, clear of the rail. The sr-only text names it.
      <Tooltip text={placed ? `${app.label} — in grid` : app.label} side="right" describes={false}>
        {(tooltip) => (
          <span
            ref={drag.setNodeRef}
            {...drag.attributes}
            {...drag.listeners}
            className={cn(
              'relative flex h-9 w-full shrink-0 cursor-grab items-center justify-center gap-0.5 rounded-md border border-border bg-background text-foreground active:cursor-grabbing',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              drag.isDragging && 'opacity-50',
            )}
            {...tooltip}
          >
            {/* The grip stays on the rail: without it an icon reads as a button to click, not a thing to drag. */}
            <GripVertical aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            {/* An app that declares no icon still needs something to show: its initial. */}
            {app.icon ? (
              <AppIcon name={app.icon} />
            ) : (
              <span aria-hidden className="text-sm font-medium">
                {app.label.slice(0, 1)}
              </span>
            )}
            <span className="sr-only">{placed ? `${app.label}, in grid` : app.label}</span>
            {/* What "In grid" says in the expanded list, as a dot: there is no room for words. */}
            {placed ? (
              <span aria-hidden className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary" />
            ) : null}
          </span>
        )}
      </Tooltip>
    );
  }

  const handle = (tooltip?: TooltipTriggerProps) => (
    <span
      ref={drag.setNodeRef}
      {...drag.attributes}
      {...drag.listeners}
      className="flex min-w-0 flex-1 cursor-grab items-center gap-2 text-sm text-foreground active:cursor-grabbing"
      {...tooltip}
    >
      <GripVertical aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <AppIcon name={app.icon} />
      <span className="truncate">{app.label}</span>
    </span>
  );

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5',
        drag.isDragging && 'opacity-50',
      )}
    >
      {/* Only an app that says what it is has a hint: one that repeats the name beside it says nothing. */}
      {app.description ? (
        <Tooltip text={app.description} align="start">
          {handle}
        </Tooltip>
      ) : (
        handle()
      )}
      {placed ? (
        <span className="shrink-0 text-xs text-muted-foreground">In grid</span>
      ) : onAdd ? (
        <button type="button" className={buttonClass('ghost', 'sm')} onClick={onAdd}>
          Add
        </button>
      ) : null}
    </div>
  );
}

/** Storage can throw (a private window, blocked site data); the list then just opens at its default. */
function readStored(): StoredAppList {
  if (typeof window === 'undefined') return DEFAULT_APP_LIST;
  try {
    return parseStoredAppList(window.localStorage.getItem(APP_LIST_STORAGE_KEY));
  } catch {
    return DEFAULT_APP_LIST;
  }
}

function writeStored(next: StoredAppList): void {
  try {
    window.localStorage.setItem(APP_LIST_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Not remembered on this device; the panel still works for this visit.
  }
}
