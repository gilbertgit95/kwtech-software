'use client';

import type { AppProps } from '@kwtech/module-kit';
import { useWorkspaceTimeZone } from '@kwtech/module-kit/react';
import { cn, Tooltip } from '@kwtech/web-ui/react';
import {
  Archive,
  CalendarClock,
  ChevronsLeft,
  ChevronsRight,
  CircleUserRound,
  Clock,
  Eye,
  KanbanSquare,
  LayoutGrid,
  List,
  Lock,
  Plus,
  Settings,
  TriangleAlert,
  UserCheck,
  Users,
  WifiOff,
} from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useId, useRef, useState } from 'react';
import { TASK_SOON_DAYS, type TaskAttention, taskAttention, workspaceTaskDay } from '../domain/dates.js';
import { BoardForm } from './components/board-form.js';
import { BoardSettings } from './components/board-settings.js';
import { BoardView } from './components/board-view.js';
import { buttonClass, Notice, PRIORITY_ICONS, SearchInput, Segmented, ToggleChip } from './components/controls.js';
import { ListView, MyTasksView } from './components/list-view.js';
import { Select, type SelectOption } from './components/select.js';
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
  // The workspace's today: what the attention chip counts as overdue, today and soon.
  const timeZone = useWorkspaceTimeZone();
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
  const selectValue = selection.kind === 'mine' ? MY_TASKS : selection.kind === 'board' ? selection.boardId : null;
  // My tasks first, then the viewer's own boards, then the ones shared with them — a private board under a lock.
  const boardOptions: SelectOption[] = [
    { value: MY_TASKS, label: 'My tasks', icon: <CircleUserRound className="size-4" /> },
    ...(state.boards ?? []).map((one) => ({
      value: one.id,
      label: one.name,
      icon: one.visibility === 'private' ? <Lock className="size-4" /> : <Users className="size-4" />,
      group: one.mine
        ? state.showArchivedBoards
          ? 'My archived boards'
          : 'My boards'
        : state.showArchivedBoards
          ? 'Archived, shared with me'
          : 'Shared with me',
    })),
  ];
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
        <Select
          id={boardSelectId}
          className="w-auto max-w-[16rem] min-w-[11rem] font-medium shadow-xs"
          value={selectValue}
          options={boardOptions}
          placeholder="Choose a board…"
          onChange={(value) => state.select(value === MY_TASKS ? { kind: 'mine' } : { kind: 'board', boardId: value })}
        />
        {state.canCreateBoards ? (
          <button type="button" className={buttonClass('secondary')} onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" className="size-4" />
            New board
          </button>
        ) : null}
        {board?.board.mine ? (
          <Tooltip text="Board settings" describes={false}>
            {(tooltip) => (
              <button
                type="button"
                aria-label="Board settings"
                className={cn(buttonClass('ghost'), 'w-9 px-0 text-muted-foreground')}
                onClick={() => setSettingsOpen(true)}
                {...tooltip}
              >
                <Settings aria-hidden="true" className="size-4" />
              </button>
            )}
          </Tooltip>
        ) : null}
        {board?.board.visibility === 'private' ? (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs text-muted-foreground">
            <Lock aria-hidden="true" className="size-3.5" />
            Private — only you can see it
          </span>
        ) : null}
        {!state.live ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <WifiOff aria-hidden="true" className="size-3.5" />
            Not live — changes show when you reload.
          </span>
        ) : null}
        <ToggleChip
          className="ml-auto"
          icon={Archive}
          pressed={state.showArchivedBoards}
          onChange={(pressed) => {
            state.setShowArchivedBoards(pressed);
            state.select({ kind: 'none' });
          }}
        >
          Archived boards
        </ToggleChip>
        {state.myTasks ? (
          <AttentionChip
            attention={taskAttention(
              state.myTasks.map((card) => ({ ...card, completed: card.completedAt !== null })),
              workspaceTaskDay(new Date(), timeZone),
            )}
            current={selection.kind === 'mine'}
            onOpen={() => state.select({ kind: 'mine' })}
          />
        ) : null}
      </header>

      {selection.kind === 'board' && board ? (
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="View"
            value={state.view}
            options={[
              { value: 'board', label: 'Board', icon: LayoutGrid },
              { value: 'list', label: 'List', icon: List },
            ]}
            onChange={state.setView}
          />
          <label htmlFor={searchId} className="sr-only">
            Search tasks
          </label>
          <SearchInput
            id={searchId}
            className="w-44"
            placeholder="Search tasks"
            value={state.filter.search}
            onChange={(search) => state.setFilter({ search })}
          />
          <Select
            aria-label="Label"
            size="sm"
            className={cn('w-auto max-w-[12rem]', state.filter.label ? FILTER_ON : null)}
            value={state.filter.label ?? ''}
            options={[{ value: '', label: 'Any label' }, ...board.labels.map((label) => ({ value: label, label }))]}
            onChange={(value) => state.setFilter({ label: value || null })}
          />
          <Select
            aria-label="Priority"
            size="sm"
            className={cn('w-auto', state.filter.priority ? FILTER_ON : null)}
            value={state.filter.priority ?? ''}
            options={[
              { value: '', label: 'Any priority' },
              ...Object.entries(PRIORITY_LABELS).map(([value, label]) => {
                const Icon = PRIORITY_ICONS[value as keyof typeof PRIORITY_ICONS];
                return { value, label, icon: <Icon className="size-3.5" /> };
              }),
            ]}
            onChange={(value) => state.setFilter({ priority: value || null })}
          />
          <ToggleChip
            icon={UserCheck}
            pressed={state.filter.assignedToMe}
            onChange={(assignedToMe) => state.setFilter({ assignedToMe })}
          >
            Assigned to me
          </ToggleChip>
          <ToggleChip
            icon={Archive}
            pressed={state.filter.archived}
            onChange={(archived) => state.setFilter({ archived })}
          >
            Archived tasks
          </ToggleChip>
        </div>
      ) : null}

      {!state.canWrite ? (
        <Notice icon={Eye}>
          You can see tasks here, but your role or your organization’s plan does not include working on them.
        </Notice>
      ) : null}
      {board?.board.archivedAt ? (
        <Notice icon={Archive}>This board is archived. It is read-only until its owner restores it.</Notice>
      ) : null}
      {state.error ? (
        <Notice
          tone="danger"
          icon={TriangleAlert}
          action={
            <button type="button" className={buttonClass('ghost', 'sm')} onClick={state.dismissError}>
              Dismiss
            </button>
          }
        >
          {state.error}
        </Notice>
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
                'flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm',
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
    <Tooltip text={label} describes={false}>
      {(tooltip) => (
        <button
          type="button"
          onClick={onOpen}
          aria-label={label}
          aria-pressed={current}
          className={cn(
            'inline-flex h-8 items-center gap-1 rounded-full border border-border bg-card px-1 text-xs font-medium',
            'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            current && 'ring-2 ring-primary',
          )}
          {...tooltip}
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
      )}
    </Tooltip>
  );
}

/** A filter's trigger while it is narrowing the list: tinted, as a pressed chip is. */
const FILTER_ON = 'border-primary/50 bg-primary/10 text-primary';

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
  overlay: 'w-[min(26rem,82cqw)] shadow-xl shadow-foreground/15',
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
    <Tooltip text={label} side="left" describes={false}>
      {(tooltip) => (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={controls}
          aria-label={label}
          className={cn(
            'mx-1 flex w-5 shrink-0 flex-col items-center justify-center gap-2 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            // Over the board it needs its own ground, or the cards show through it.
            (overlay || !expanded) && 'border border-border bg-card',
          )}
          {...tooltip}
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
      )}
    </Tooltip>
  );
}

/** Nothing to show — and why, so an empty app is never a mystery. */
function EmptyState({ state, onCreate }: { state: ReturnType<typeof useTasks>; onCreate: () => void }) {
  if (state.boards === null) return <EmptyNote title="Opening your boards…" />;
  if (state.boards.length > 0) {
    return <EmptyNote title="Choose a board" text="Pick a board at the top, or open My tasks." />;
  }
  if (state.showArchivedBoards) return <EmptyNote title="There are no archived boards." />;
  return (
    <EmptyNote
      title="No boards yet"
      text={
        state.canCreateBoards
          ? 'A board holds your team’s tasks in columns you choose. Share it with the workspace, or keep it to yourself.'
          : 'Nobody has shared a board with this workspace yet, and your role or your organization’s plan does not include creating one.'
      }
    >
      {state.canCreateBoards ? (
        <button type="button" className={buttonClass('primary')} onClick={onCreate}>
          <Plus aria-hidden="true" className="size-4" />
          Create a board
        </button>
      ) : null}
    </EmptyNote>
  );
}

function EmptyNote({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-12 text-center">
      <span aria-hidden="true" className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
        <KanbanSquare className="size-6" />
      </span>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {text ? <p className="text-sm text-muted-foreground">{text}</p> : null}
      {children}
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
