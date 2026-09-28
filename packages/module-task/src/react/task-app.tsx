'use client';

import type { AppProps } from '@kwtech/module-kit';
import { cn } from '@kwtech/web-ui/react';
import {
  Archive,
  CalendarClock,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  LayoutGrid,
  List,
  Lock,
  Plus,
  Settings,
  TriangleAlert,
} from 'lucide-react';
import { type RefObject, useEffect, useId, useRef, useState } from 'react';
import { localTaskDay, TASK_SOON_DAYS, type TaskAttention, taskAttention } from '../domain/dates.js';
import { BoardForm } from './components/board-form.js';
import { BoardSettings } from './components/board-settings.js';
import { BoardView } from './components/board-view.js';
import { buttonClass, INPUT_CLASS } from './components/controls.js';
import { ListView, MyTasksView } from './components/list-view.js';
import { TaskPanel } from './components/task-panel.js';
import type { TaskClient } from './task-client.js';
import { useTasks } from './use-tasks.js';
import { PRIORITY_LABELS } from './view/board.js';
import { TASK_PANEL_BESIDE_REM, type TaskPanelLayout, taskPanelLayout } from './view/layout.js';

const MY_TASKS = '__mine__';

/**
 * Task boards as a SUB-APP on the workspace's Apps page (TASK-PLAN §6).
 *
 * - Laid out by the BOX's width, never the viewport's, because a grid cell is
 *   narrow on a wide screen. The board's columns always sit side by side and
 *   scroll sideways; the open task's panel sits beside the board when wide and
 *   slides over it when narrow, and a bar on its edge collapses and expands it
 *   at every width (`taskPanelLayout`), as the notes list does.
 * - Which board and task are open is this component's own state, never a URL:
 *   a link would leave the Apps page and close every other app running on it.
 * - Says WHY when something is missing: no boards, no key to make one, no key
 *   to write — rather than showing an empty screen.
 */
export function TaskApp({ organizationId, workspaceId, client }: AppProps & { client?: TaskClient }) {
  const state = useTasks(organizationId, workspaceId, client ? { client } : {});
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useWidthRem(rootRef);
  const panelBeside = width === null || width >= TASK_PANEL_BESIDE_REM;
  // The task the person collapsed the panel on; opening another expands it again.
  const [collapsedFor, setCollapsedFor] = useState<string | null>(null);
  const layout = taskPanelLayout({
    taskOpen: state.openTaskId !== null,
    beside: panelBeside,
    collapsed: collapsedFor !== null && collapsedFor === state.openTaskId,
  });
  const panelId = useId();
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const boardSelectId = useId();
  const searchId = useId();

  const { board, selection } = state;
  const selectValue = selection.kind === 'mine' ? MY_TASKS : selection.kind === 'board' ? selection.boardId : '';
  const mine = (state.boards ?? []).filter((one) => one.mine);
  const shared = (state.boards ?? []).filter((one) => !one.mine);
  const taskCounts = new Map(state.lanes.map((lane) => [lane.column.id, lane.cards.length]));

  // Escape puts the slid-out panel away — only while focus is inside it, so it
  // never steals Escape from a menu or dialog elsewhere.
  useEffect(() => {
    if (layout !== 'overlay') return;
    const onKey = (event: KeyboardEvent) => {
      const panel = document.getElementById(panelId);
      if (event.key === 'Escape' && panel?.contains(event.target as Node)) setCollapsedFor(state.openTaskId);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [layout, panelId, state.openTaskId]);

  return (
    <div ref={rootRef} className="@container relative flex h-full w-full min-h-0 flex-col gap-3 p-3 text-foreground">
      <header className="flex flex-wrap items-center gap-2">
        <label htmlFor={boardSelectId} className="sr-only">
          Board
        </label>
        <select
          id={boardSelectId}
          className={cn(INPUT_CLASS, 'w-auto max-w-[16rem] font-medium')}
          value={selectValue}
          onChange={(event) =>
            state.select(
              event.target.value === MY_TASKS ? { kind: 'mine' } : { kind: 'board', boardId: event.target.value },
            )
          }
        >
          {selectValue === '' ? <option value="">Choose a board…</option> : null}
          <option value={MY_TASKS}>My tasks</option>
          {mine.length > 0 ? (
            <optgroup label={state.showArchivedBoards ? 'My archived boards' : 'My boards'}>
              {mine.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.visibility === 'private' ? '🔒 ' : ''}
                  {one.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          {shared.length > 0 ? (
            <optgroup label={state.showArchivedBoards ? 'Archived, shared with me' : 'Shared with me'}>
              {shared.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
        {state.canCreateBoards ? (
          <button type="button" className={buttonClass('secondary')} onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" className="size-4" />
            New board
          </button>
        ) : null}
        {board?.board.mine ? (
          <button
            type="button"
            aria-label="Board settings"
            className={buttonClass('ghost')}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings aria-hidden="true" className="size-4" />
          </button>
        ) : null}
        {board?.board.visibility === 'private' ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Lock aria-hidden="true" className="size-3.5" />
            Private — only you can see it
          </span>
        ) : null}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={state.showArchivedBoards}
            onChange={(event) => {
              state.setShowArchivedBoards(event.target.checked);
              state.select({ kind: 'none' });
            }}
          />
          Archived boards
        </label>
        {!state.live ? (
          <span className="text-xs text-muted-foreground">Not live — changes show when you reload.</span>
        ) : null}
        {state.myTasks ? (
          <AttentionChip
            attention={taskAttention(
              state.myTasks.map((card) => ({ ...card, completed: card.completedAt !== null })),
              localTaskDay(new Date()),
            )}
            current={selection.kind === 'mine'}
            onOpen={() => state.select({ kind: 'mine' })}
          />
        ) : null}
      </header>

      {selection.kind === 'board' && board ? (
        <div className="flex flex-wrap items-center gap-2">
          <fieldset className="flex rounded-md border border-border p-0.5">
            <legend className="sr-only">View</legend>
            <button
              type="button"
              aria-pressed={state.view === 'board'}
              className={cn(buttonClass(state.view === 'board' ? 'primary' : 'ghost', 'sm'))}
              onClick={() => state.setView('board')}
            >
              <LayoutGrid aria-hidden="true" className="size-3.5" />
              Board
            </button>
            <button
              type="button"
              aria-pressed={state.view === 'list'}
              className={cn(buttonClass(state.view === 'list' ? 'primary' : 'ghost', 'sm'))}
              onClick={() => state.setView('list')}
            >
              <List aria-hidden="true" className="size-3.5" />
              List
            </button>
          </fieldset>
          <label htmlFor={searchId} className="sr-only">
            Search tasks
          </label>
          <input
            id={searchId}
            type="search"
            placeholder="Search"
            className={cn(INPUT_CLASS, 'h-8 w-40')}
            value={state.filter.search}
            onChange={(event) => state.setFilter({ search: event.target.value })}
          />
          <select
            aria-label="Label"
            className={cn(INPUT_CLASS, 'h-8 w-auto')}
            value={state.filter.label ?? ''}
            onChange={(event) => state.setFilter({ label: event.target.value || null })}
          >
            <option value="">Any label</option>
            {board.labels.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="Priority"
            className={cn(INPUT_CLASS, 'h-8 w-auto')}
            value={state.filter.priority ?? ''}
            onChange={(event) => state.setFilter({ priority: event.target.value || null })}
          >
            <option value="">Any priority</option>
            {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={state.filter.assignedToMe}
              onChange={(event) => state.setFilter({ assignedToMe: event.target.checked })}
            />
            Assigned to me
          </label>
          <button
            type="button"
            aria-pressed={state.filter.archived}
            className={buttonClass(state.filter.archived ? 'primary' : 'ghost', 'sm')}
            onClick={() => state.setFilter({ archived: !state.filter.archived })}
          >
            <Archive aria-hidden="true" className="size-3.5" />
            Archived tasks
          </button>
        </div>
      ) : null}

      {!state.canWrite ? (
        <p role="status" className="rounded-md bg-muted px-3 py-1.5 text-sm text-muted-foreground">
          You can see tasks here, but your role or your organization’s plan does not include working on them.
        </p>
      ) : null}
      {board?.board.archivedAt ? (
        <p role="status" className="rounded-md bg-muted px-3 py-1.5 text-sm text-muted-foreground">
          This board is archived. It is read-only until its owner restores it.
        </p>
      ) : null}
      {state.error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 rounded-md bg-destructive/10 px-3 py-1.5 text-sm text-destructive"
        >
          {state.error}
          <button type="button" className={buttonClass('ghost', 'sm')} onClick={state.dismissError}>
            Dismiss
          </button>
        </div>
      ) : null}

      {/*
       * The board and the open task. The bar on the panel's edge hides and shows
       * it at any width (`taskPanelLayout`): beside the board when wide, slid
       * over it when narrow — the board still showing, so it is plain there is
       * something behind.
       */}
      <div className="relative flex min-h-0 flex-1">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selection.kind === 'mine' ? (
            <MyTasksView state={state} />
          ) : selection.kind === 'board' && board ? (
            state.view === 'list' ? (
              <ListView state={state} />
            ) : (
              <BoardView state={state} />
            )
          ) : (
            <EmptyState state={state} onCreate={() => setCreating(true)} />
          )}
        </main>
        {layout !== 'none' ? (
          <div className={cn('flex min-h-0', PANEL_WRAPPER[layout])}>
            <CollapseBar
              expanded={layout !== 'hidden'}
              controls={panelId}
              overlay={layout === 'overlay'}
              onToggle={() => setCollapsedFor(layout === 'hidden' ? null : state.openTaskId)}
            />
            {/*
             * ⚠ Collapsed, the panel is hidden, not unmounted: its draft, its
             * pending autosave and its "Saved" state carry on behind the bar.
             */}
            <div
              id={panelId}
              className={cn(
                'flex min-h-0 flex-col rounded-lg border border-border bg-card text-card-foreground',
                PANEL_WIDTH[layout],
              )}
            >
              <TaskPanel state={state} onClose={() => state.open(null)} />
            </div>
          </div>
        ) : null}
      </div>

      <BoardForm
        open={creating}
        busy={state.busy}
        onCancel={() => setCreating(false)}
        onCreate={async (input) => {
          const ok = await state.createBoard(input);
          if (ok) setCreating(false);
          return ok;
        }}
      />
      {board?.board.mine ? (
        <BoardSettings
          state={state}
          board={board.board}
          taskCounts={taskCounts}
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * What of the viewer's own tasks needs attention — overdue, today, soon — at a
 * glance from any board, as one button that opens My tasks. ⚠ Counted across
 * EVERY board in the workspace, whichever is selected, and it says so ("All my
 * tasks"), so nobody reads it as the selected board's count. Counted by
 * `taskAttention`, so it agrees with My tasks' groups. Absent when nothing is
 * pressing: a chip that always shows "0" teaches people to ignore it.
 */
function AttentionChip({
  attention,
  current,
  onOpen,
}: {
  attention: TaskAttention;
  current: boolean;
  onOpen: () => void;
}) {
  const { overdue, today, soon } = attention;
  if (overdue + today + soon === 0) return null;
  const said = [
    overdue > 0 ? `${overdue} overdue` : null,
    today > 0 ? `${today} for today` : null,
    soon > 0 ? `${soon} coming up in the next ${TASK_SOON_DAYS} days` : null,
  ].filter(Boolean);
  // Workspace-wide, and said so: it counts every board, not the one on screen (the operator's request).
  const label = `Assigned to you on every board in this workspace: ${said.join(', ')}. Open My tasks.`;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      aria-pressed={current}
      title={label}
      className={cn(
        'inline-flex h-8 items-center gap-1 rounded-full border border-border bg-card px-1 text-xs font-medium',
        'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        current && 'ring-2 ring-primary',
      )}
    >
      <span aria-hidden="true" className="pl-1.5 font-normal text-muted-foreground">
        All my tasks
      </span>
      {overdue > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-destructive">
          <TriangleAlert aria-hidden="true" className="size-3.5" />
          {overdue} overdue
        </span>
      ) : null}
      {today > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-primary">
          <CalendarClock aria-hidden="true" className="size-3.5" />
          {today} today
        </span>
      ) : null}
      {soon > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-status-warning px-2 py-0.5 text-status-warning-foreground">
          <Clock aria-hidden="true" className="size-3.5" />
          {soon} soon
        </span>
      ) : null}
    </button>
  );
}

/** The bar-and-panel group, per layout. */
const PANEL_WRAPPER: Record<TaskPanelLayout, string> = {
  beside: 'shrink-0',
  // Over the board, on the right — never the whole box, so the board shows behind it.
  overlay: 'absolute inset-y-0 right-0 z-10',
  hidden: 'shrink-0',
  none: '',
};

const PANEL_WIDTH: Record<TaskPanelLayout, string> = {
  beside: 'w-[26rem]',
  overlay: 'w-[min(26rem,82cqw)] shadow-lg shadow-foreground/15',
  hidden: 'hidden',
  none: '',
};

/**
 * The thin bar that collapses and expands the task panel. A real button, with
 * the panel's id in `aria-controls` and its state in `aria-expanded`;
 * collapsed, it reads "Task" down its length so the way back is never an
 * unlabelled sliver.
 */
function CollapseBar({
  expanded,
  controls,
  overlay,
  onToggle,
}: {
  expanded: boolean;
  controls: string;
  overlay: boolean;
  onToggle: () => void;
}) {
  const label = expanded ? 'Hide the task' : 'Show the task';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={label}
      title={label}
      className={cn(
        'mx-1 flex w-5 shrink-0 flex-col items-center justify-center gap-2 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        // Over the board it needs its own ground, or the cards show through it.
        (overlay || !expanded) && 'border border-border bg-card',
      )}
    >
      {expanded ? (
        <ChevronsRight aria-hidden="true" className="size-4" />
      ) : (
        <>
          <ChevronsLeft aria-hidden="true" className="size-4" />
          <span aria-hidden="true" className="text-xs [writing-mode:vertical-rl]">
            Task
          </span>
        </>
      )}
    </button>
  );
}

/** Nothing to show — and why, so an empty app is never a mystery. */
function EmptyState({ state, onCreate }: { state: ReturnType<typeof useTasks>; onCreate: () => void }) {
  if (state.boards === null) return <p className="text-sm text-muted-foreground">Opening your boards…</p>;
  if (state.boards.length > 0) return <p className="text-sm text-muted-foreground">Choose a board above.</p>;
  if (state.showArchivedBoards) return <p className="text-sm text-muted-foreground">There are no archived boards.</p>;
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-10 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">No boards yet</h1>
      {state.canCreateBoards ? (
        <>
          <p className="text-sm text-muted-foreground">
            A board holds your team’s tasks in columns you choose. Share it with the workspace, or keep it to yourself.
          </p>
          <button type="button" className={buttonClass('primary')} onClick={onCreate}>
            <Plus aria-hidden="true" className="size-4" />
            Create a board
          </button>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nobody has shared a board with this workspace yet, and your role or your organization’s plan does not include
          creating one.
        </p>
      )}
    </div>
  );
}

/** The box's width in rem, from a ResizeObserver; null before the first measure. */
function useWidthRem(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect.width;
      if (box !== undefined) setWidth(box / rem);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
