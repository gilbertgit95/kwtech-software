'use client';

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@kwtech/web-ui/react';
import { type KeyboardEvent, useState } from 'react';
import { moveTab, reorderTabs } from '../../domain/layout.js';
import type { AppHubEntry } from '../types.js';
import { AppIcon, buttonClass } from './ui.js';

/**
 * The tab view's bar: one tab per app the viewer holds, in their order.
 *
 * Tabs are REORDERED, never added or closed — the set of tabs is exactly the
 * set of apps held (APP-HUB-PLAN decision 7). Drag one to move it; from the
 * keyboard, Ctrl+Shift+← / → moves the focused tab.
 */
export function TabBar({
  order,
  active,
  apps,
  onActivate,
  onReorder,
}: {
  order: readonly string[];
  active: string | null;
  apps: ReadonlyMap<string, AppHubEntry>;
  onActivate(key: string): void;
  onReorder(order: string[]): void;
}) {
  /*
   * A drag starts only after the pointer MOVES, and a touch only after a short
   * hold — otherwise every click on a tab would be a zero-length drag and never
   * a click, and a finger scrolling the bar would pick tabs up.
   */
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );
  const [dragging, setDragging] = useState<string | null>(null);

  const onDragStart = (event: DragStartEvent) => setDragging(String(event.active.id));
  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    if (event.over && event.active.id !== event.over.id) {
      onReorder(reorderTabs(order, String(event.active.id), String(event.over.id)));
    }
  };

  const onKeyDown = (event: KeyboardEvent, key: string) => {
    if (!(event.ctrlKey && event.shiftKey)) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    onReorder(moveTab(order, key, event.key === 'ArrowLeft' ? -1 : 1));
  };

  const draggingApp = dragging ? apps.get(dragging) : undefined;

  return (
    <div className="flex items-end gap-1 border-b border-border">
      <DndContext
        id="app-hub-tabs"
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <SortableContext items={[...order]} strategy={horizontalListSortingStrategy}>
          <div role="tablist" aria-label="Apps" className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
            {order.map((key) => {
              const app = apps.get(key);
              return app ? (
                <SortableTab
                  key={key}
                  app={app}
                  selected={key === active}
                  onSelect={() => onActivate(key)}
                  onKeyDown={(event) => onKeyDown(event, key)}
                />
              ) : null;
            })}
          </div>
        </SortableContext>
        <DragOverlay>
          {draggingApp ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg">
              <AppIcon name={draggingApp.icon} />
              {draggingApp.label}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Every tab by name, for when there are more than fit and the bar scrolls. */}
      {order.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger className={cn(buttonClass('ghost', 'sm'), 'mb-1')} aria-label="All apps">
            All ▾
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {order.map((key) => {
              const app = apps.get(key);
              return app ? (
                <DropdownMenuItem key={key} onSelect={() => onActivate(key)}>
                  <AppIcon name={app.icon} />
                  {app.label}
                </DropdownMenuItem>
              ) : null;
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function SortableTab({
  app,
  selected,
  onSelect,
  onKeyDown,
}: {
  app: AppHubEntry;
  selected: boolean;
  onSelect(): void;
  onKeyDown(event: KeyboardEvent): void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: app.key });
  return (
    <button
      ref={setNodeRef}
      type="button"
      aria-selected={selected}
      title={`${app.label} — drag to reorder, or Ctrl+Shift+← / →`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        '-mb-px flex shrink-0 items-center gap-2 rounded-t-md border border-transparent px-3 py-2 text-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'border-border border-b-background bg-background font-medium text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        isDragging && 'opacity-40',
      )}
      {...attributes}
      {...listeners}
      // After the spreads: dnd-kit's attributes carry a role of their own, and a tab must stay a tab.
      role="tab"
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      <AppIcon name={app.icon} />
      {app.label}
    </button>
  );
}
