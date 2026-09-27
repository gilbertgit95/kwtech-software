'use client';

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useHeldFeatures, useHoldsFeature } from '@kwtech/module-kit/react';
import {
  ConfirmDialog,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kwtech/web-ui/react';
import {
  AppWindow,
  EllipsisVertical,
  GripVertical,
  LayoutGrid,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  type AppHubGrid,
  type AppHubLayout,
  type AppHubLayoutSource,
  assignCell,
  cellCap,
  type GridPreset,
  reshape,
  swapCells,
} from '../../domain/layout.js';
import { APP_HUB_FEATURE } from '../../feature-keys.js';
import { type AppHubClient, createAppHubClient } from '../app-hub-client.js';
import { AppStage, appId } from '../components/app-stage.js';
import { LayoutPicker } from '../components/layout-picker.js';
import { TabBar } from '../components/tab-bar.js';
import { AppIcon, buttonClass, useWideScreen } from '../components/ui.js';
import type { AppHubEntry } from '../types.js';
import { useAppHubLayout } from '../use-app-hub-layout.js';

const SOURCE_LABEL: Record<AppHubLayoutSource, string> = {
  user: 'Your layout',
  workspace: "The workspace's default layout",
  default: 'The default layout',
};

/**
 * `/organizations/:organizationId/workspaces/:workspaceId/apps` — every sub-app
 * the viewer holds here, in tabs or side by side in a grid (APP-HUB-PLAN).
 *
 * The page offers only apps whose key the viewer holds in THIS workspace; the
 * apps' own APIs authorise every request again, so this is the affordance, not
 * the check.
 */
export function AppHubPage({
  organizationId,
  workspaceId,
  apps,
  client: injected,
}: {
  organizationId: string;
  workspaceId: string;
  /** Every declared app, held or not, in default order. */
  apps: readonly AppHubEntry[];
  client?: AppHubClient;
}) {
  const client = useMemo(() => injected ?? createAppHubClient(), [injected]);
  const heldFeatures = useHeldFeatures();
  const held = useMemo(() => apps.filter((app) => heldFeatures.includes(app.feature)), [apps, heldFeatures]);
  const byKey = useMemo(() => new Map(held.map((app) => [app.key, app])), [held]);
  const labels = useMemo(() => new Map(apps.map((app) => [app.key, app.label])), [apps]);
  const canManage = useHoldsFeature(APP_HUB_FEATURE.layoutManage);

  const state = useAppHubLayout(
    client,
    { organizationId, workspaceId },
    apps.map((app) => app.key),
    held.map((app) => app.key),
  );
  const { layout } = state;

  const wide = useWideScreen();
  // The grid needs room; a narrow screen shows the tabs WITHOUT changing the saved view.
  const mode = layout?.view === 'grid' && wide ? 'grid' : 'tabs';

  // ── which apps are mounted: shown once, then kept alive ───────────────────
  const [mounted, setMounted] = useState<ReadonlySet<string>>(new Set());
  const visibleKey = layout
    ? (mode === 'tabs' ? [layout.tabs.active] : layout.grid.cells).filter((key) => key && byKey.has(key)).join(' ')
    : '';
  useEffect(() => {
    if (!visibleKey) return;
    setMounted((current) => {
      const missing = visibleKey.split(' ').filter((key) => !current.has(key));
      return missing.length ? new Set([...current, ...missing]) : current;
    });
  }, [visibleKey]);

  // ── confirmations ─────────────────────────────────────────────────────────
  const [pendingShape, setPendingShape] = useState<{ grid: AppHubGrid; dropped: string[] } | null>(null);
  const [confirm, setConfirm] = useState<'save-default' | 'remove-default' | null>(null);
  const [showList, setShowList] = useState(true);

  if (held.length === 0 && layout) {
    return (
      <Frame>
        <p className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
          No apps are available to you in this workspace. Apps come with your role here and with your
          organization&apos;s plan — ask a workspace admin if you expected one.
        </p>
      </Frame>
    );
  }

  if (!layout) {
    return (
      <Frame>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Frame>
    );
  }

  const change = (next: AppHubLayout, options?: { persist?: boolean }) => state.change(next, options);
  const setGrid = (grid: AppHubGrid, options?: { persist?: boolean }) => change({ ...layout, grid }, options);

  const choosePreset = (preset: GridPreset) => {
    const result = reshape(layout.grid, preset.columns);
    if (result.dropped.length > 0) setPendingShape(result);
    else setGrid(result.grid);
  };

  const controls = (
    <>
      {state.saving ? (
        <span role="status" className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
          Saving…
        </span>
      ) : null}
      <ViewSwitch view={layout.view} onChange={(view) => change({ ...layout, view })} />
      <LayoutMenu
        source={state.source}
        canManage={canManage}
        hasWorkspaceDefault={state.hasWorkspaceDefault}
        onResetMine={() => void state.resetMine()}
        onSaveDefault={() => setConfirm('save-default')}
        onRemoveDefault={() => setConfirm('remove-default')}
      />
    </>
  );

  return (
    <Frame>
      {state.error ? (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <span>{state.error}</span>
          <button type="button" className="shrink-0 underline" onClick={state.dismissError}>
            Dismiss
          </button>
        </div>
      ) : null}

      <GridDnd grid={layout.grid} apps={byKey} onGridChange={setGrid}>
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <Toolbar trailing={controls}>
            {mode === 'tabs' ? (
              <TabBar
                order={layout.tabs.order}
                active={layout.tabs.active}
                apps={byKey}
                onActivate={(key) => change({ ...layout, tabs: { ...layout.tabs, active: key } })}
                onReorder={(order) => change({ ...layout, tabs: { ...layout.tabs, order } })}
              />
            ) : (
              <>
                <button
                  type="button"
                  aria-pressed={showList}
                  aria-label={showList ? 'Hide the app list' : 'Show the app list'}
                  title={showList ? 'Hide the app list' : 'Show the app list'}
                  className={toolbarButtonClass(showList)}
                  onClick={() => setShowList((open) => !open)}
                >
                  {showList ? (
                    <PanelLeftClose aria-hidden className="size-4" />
                  ) : (
                    <PanelLeftOpen aria-hidden className="size-4" />
                  )}
                </button>
                <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />
                <LayoutPicker grid={layout.grid} cap={cellCap(held.length)} onChoose={choosePreset} />
              </>
            )}
          </Toolbar>
          {layout.view === 'grid' && !wide ? (
            <p className="px-1 text-xs text-muted-foreground">
              The grid needs a wider screen, so your apps are shown as tabs.
            </p>
          ) : null}
          <div className="flex min-h-0 flex-1 gap-2">
            {mode === 'grid' && showList ? <AppList apps={held} grid={layout.grid} onGridChange={setGrid} /> : null}
            <div className="min-h-0 min-w-0 flex-1">
              <AppStage
                mode={mode}
                grid={layout.grid}
                activeTab={layout.tabs.active}
                apps={held}
                labels={labels}
                mounted={mounted}
                onGridChange={setGrid}
              />
            </div>
          </div>
        </div>
      </GridDnd>

      <ConfirmDialog
        open={pendingShape !== null}
        title="Remove apps from the grid?"
        description={`The new grid has no room for ${(pendingShape?.dropped ?? []).map((key) => labels.get(key) ?? key).join(', ')}. They stay in your tabs.`}
        confirmLabel="Change the grid"
        onConfirm={() => {
          if (pendingShape) setGrid(pendingShape.grid);
          setPendingShape(null);
        }}
        onCancel={() => setPendingShape(null)}
      />
      <ConfirmDialog
        open={confirm === 'save-default'}
        danger={false}
        title="Make this the workspace's default layout?"
        description="Everybody in this workspace who has not arranged their own layout will see this one. People who have keep theirs."
        confirmLabel="Save as default"
        pending={state.saving}
        onConfirm={async () => {
          await state.saveAsWorkspaceDefault();
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'remove-default'}
        title="Remove the workspace's default layout?"
        description="People without a layout of their own go back to the built-in one. Nobody's own layout changes."
        confirmLabel="Remove default"
        pending={state.saving}
        onConfirm={async () => {
          await state.resetWorkspaceDefault();
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </Frame>
  );
}

// ── the page frame ──────────────────────────────────────────────────────────

/**
 * A body that fills the shell's height. No visible title: the drawer already
 * says where you are, and every pixel here belongs to the apps.
 */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col gap-2">
      {/* Still the page's heading for screen readers and tests, which navigate by headings. */}
      <h1 className="sr-only">Apps</h1>
      {children}
    </div>
  );
}

/**
 * One row of controls above the apps: what the view is about on the left (the
 * tabs, or the app list toggle and the grid presets), and the page's own
 * controls — saving, the view switch, the layout menu — on the right, in the
 * same place in both views.
 */
function Toolbar({ children, trailing }: { children: React.ReactNode; trailing: React.ReactNode }) {
  return (
    <div
      role="toolbar"
      aria-label="Apps"
      className="flex min-h-10 shrink-0 items-center gap-1 rounded-lg border border-border bg-muted/40 p-1"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
      <div className="flex shrink-0 items-center gap-1">{trailing}</div>
    </div>
  );
}

/** A square icon button in the toolbar; `on` draws it raised, as a pressed segment. */
function toolbarButtonClass(on = false): string {
  return cn(
    'grid size-8 shrink-0 place-items-center rounded-md transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    on
      ? 'bg-background text-foreground shadow-sm'
      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
  );
}

const VIEWS = [
  { view: 'tabs', label: 'Tabs', Icon: AppWindow },
  { view: 'grid', label: 'Grid', Icon: LayoutGrid },
] as const;

function ViewSwitch({ view, onChange }: { view: 'tabs' | 'grid'; onChange(view: 'tabs' | 'grid'): void }) {
  return (
    <fieldset className="inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5">
      <legend className="sr-only">View</legend>
      {VIEWS.map(({ view: option, label, Icon }) => (
        <button
          key={option}
          type="button"
          aria-pressed={view === option}
          title={`Show your apps as ${label.toLowerCase()}`}
          onClick={() => onChange(option)}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded px-2.5 text-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            view === option
              ? 'bg-background font-medium text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon aria-hidden className="size-4" />
          <span className="hidden lg:inline">{label}</span>
        </button>
      ))}
    </fieldset>
  );
}

/**
 * Whose layout this is, and what may be done about it. Always shown, so the
 * source ("Your layout") has one place to be read, now that there is no header.
 */
function LayoutMenu({
  source,
  canManage,
  hasWorkspaceDefault,
  onResetMine,
  onSaveDefault,
  onRemoveDefault,
}: {
  source: AppHubLayoutSource;
  canManage: boolean;
  hasWorkspaceDefault: boolean;
  onResetMine(): void;
  onSaveDefault(): void;
  onRemoveDefault(): void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={toolbarButtonClass()}
        aria-label={`Layout options — ${SOURCE_LABEL[source]}`}
        title={`Layout options — ${SOURCE_LABEL[source]}`}
      >
        <EllipsisVertical aria-hidden className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="font-normal text-muted-foreground">{SOURCE_LABEL[source]}</DropdownMenuLabel>
        {source === 'user' ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onResetMine}>
              {hasWorkspaceDefault ? "Use the workspace's default layout" : 'Use the default layout'}
            </DropdownMenuItem>
          </>
        ) : null}
        {canManage ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onSaveDefault}>Save as the workspace default…</DropdownMenuItem>
            {hasWorkspaceDefault ? (
              <DropdownMenuItem onSelect={onRemoveDefault}>Remove the workspace default…</DropdownMenuItem>
            ) : null}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── dragging in the grid ────────────────────────────────────────────────────

/**
 * One drag context for the grid and the app list: a cell dropped on a cell
 * swaps them, an app dropped from the list goes into the cell (swapping out of
 * wherever it already was). `pointerWithin`, because cells are large and the
 * one under the pointer is the one meant.
 */
function GridDnd({
  grid,
  apps,
  onGridChange,
  children,
}: {
  grid: AppHubGrid;
  apps: ReadonlyMap<string, AppHubEntry>;
  onGridChange(grid: AppHubGrid): void;
  children: React.ReactNode;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );
  const [dragging, setDragging] = useState<string | null>(null);

  const draggedApp = (id: string | null): AppHubEntry | undefined => {
    if (!id) return undefined;
    if (id.startsWith('app:')) return apps.get(id.slice(4));
    const key = grid.cells[Number(id.slice(5))];
    return key ? apps.get(key) : undefined;
  };

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const from = String(event.active.id);
    const to = event.over ? String(event.over.id) : null;
    if (!to?.startsWith('cell:')) return;
    const target = Number(to.slice(5));
    if (from.startsWith('cell:')) onGridChange(swapCells(grid, Number(from.slice(5)), target));
    else if (from.startsWith('app:')) onGridChange(assignCell(grid, target, from.slice(4)));
  };

  const shown = draggedApp(dragging);
  return (
    <DndContext
      id="app-hub-grid"
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(event: DragStartEvent) => setDragging(String(event.active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      {children}
      {/* A label follows the pointer, not the app: moving a live app's DOM would be slow and could reset it. */}
      <DragOverlay>
        {shown ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg">
            <AppIcon name={shown.icon} />
            {shown.label}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** The apps the viewer holds, to drag into a cell or add to the first empty one. */
function AppList({
  apps,
  grid,
  onGridChange,
}: {
  apps: readonly AppHubEntry[];
  grid: AppHubGrid;
  onGridChange(grid: AppHubGrid): void;
}) {
  const firstEmpty = grid.cells.indexOf(null);
  return (
    <aside
      aria-label="Your apps"
      className="flex w-52 shrink-0 flex-col gap-1 overflow-y-auto rounded-lg border border-border bg-muted/20 p-2"
    >
      <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">Drag an app onto a cell</p>
      {apps.map((app) => {
        const placed = grid.cells.includes(app.key);
        return (
          <DraggableApp
            key={app.key}
            app={app}
            placed={placed}
            onAdd={placed || firstEmpty === -1 ? null : () => onGridChange(assignCell(grid, firstEmpty, app.key))}
          />
        );
      })}
    </aside>
  );
}

function DraggableApp({ app, placed, onAdd }: { app: AppHubEntry; placed: boolean; onAdd: (() => void) | null }) {
  const drag = useDraggable({ id: appId(app.key) });
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5',
        drag.isDragging && 'opacity-50',
      )}
    >
      <span
        ref={drag.setNodeRef}
        {...drag.attributes}
        {...drag.listeners}
        title={app.description ?? app.label}
        className="flex min-w-0 flex-1 cursor-grab items-center gap-2 text-sm text-foreground active:cursor-grabbing"
      >
        <GripVertical aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <AppIcon name={app.icon} />
        <span className="truncate">{app.label}</span>
      </span>
      {placed ? (
        <span className="text-xs text-muted-foreground">In grid</span>
      ) : onAdd ? (
        <button type="button" className={buttonClass('ghost', 'sm')} onClick={onAdd}>
          Add
        </button>
      ) : null}
    </div>
  );
}
