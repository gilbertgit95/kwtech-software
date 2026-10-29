'use client';

import type { AppProps } from '@kwtech/module-kit';
import { useWorkspaceTimeZone } from '@kwtech/module-kit/react';
import { BottomSheet, BottomSheetRow, cn } from '@kwtech/web-ui/react';
import {
  CalendarClock,
  Check,
  CheckSquare,
  ChevronDown,
  LayoutList,
  MessageSquare,
  Plus,
  Search,
  SlidersHorizontal,
  User,
} from 'lucide-react';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { workspaceTaskDay } from '../domain/dates.js';
import { TaskPanel } from '../react/components/task-panel.js';
import type { TaskCardView } from '../react/task-client.js';
import { type TasksState, useTasks } from '../react/use-tasks.js';
import { cardDates, DAY_GROUP_LABELS, groupMyTasks, initials, PRIORITY_LABELS } from '../react/view/board.js';

/**
 * Tasks on a phone (issue #22): one column at a time, then one task full
 * screen — not the desktop board squeezed into a phone, whose side-scrolling
 * columns and rows of toolbars took a third of the screen before the first
 * task (the operator, 2026-10-29).
 *
 * The same `useTasks` as the Apps page's tasks — the same boards, filters,
 * live updates and keys — arranged for a thumb:
 *
 *   - the BOARD as a picker at the top (and "My tasks", every task assigned
 *     to you, by day), with search and ONE Filters sheet;
 *   - the board's COLUMNS as chips with their counts — To do · 3, Doing · 1 —
 *     showing one column's tasks at a time, as cards;
 *   - a round ＋ adding a task to the column on screen;
 *   - a TASK full screen, in the same `TaskPanel` as the full site's, whose
 *     Column field moves it — a phone has no board to drag across.
 */
export function TasksMobileApp({ organizationId, workspaceId }: AppProps) {
  const state = useTasks(organizationId, workspaceId);
  if (state.openTaskId) return <TaskScreen state={state} />;
  return <TaskBoard state={state} />;
}

// ── the board ─────────────────────────────────────────────────────────────

function TaskBoard({ state }: { state: TasksState }) {
  const timeZone = useWorkspaceTimeZone();
  const today = workspaceTaskDay(new Date(), timeZone);
  const searchId = useId();
  const [sheet, setSheet] = useState<'boards' | 'filters' | 'add' | null>(null);
  const [columnId, setColumnId] = useState<string | null>(null);

  const boardId = state.selection.kind === 'board' ? state.selection.boardId : null;
  // The column on screen: the one chosen, while it is still on this board; else the first.
  const lane = state.lanes.find((one) => one.column.id === columnId) ?? state.lanes[0] ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: another board starts on its own first column.
  useEffect(() => setColumnId(null), [boardId]);

  const current = selectionLabel(state, boardId);
  const filters =
    (state.filter.label ? 1 : 0) +
    (state.filter.priority ? 1 : 0) +
    (state.filter.assignedToMe ? 1 : 0) +
    (state.filter.archived ? 1 : 0);

  return (
    <div className="relative h-full">
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl space-y-3 px-4 pt-4 pb-28">
          {/* The board: the one place a person moves between boards. */}
          <button
            type="button"
            onClick={() => setSheet('boards')}
            className="flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-card px-3 py-2.5 text-left shadow-sm transition-transform active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              aria-hidden
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-primary/75 text-primary-foreground shadow-sm"
            >
              {state.selection.kind === 'mine' ? <User className="size-5" /> : <LayoutList className="size-5" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-muted-foreground">
                {state.selection.kind === 'mine' ? 'Assigned to you' : 'Board'}
              </span>
              <span className="block truncate text-base font-semibold tracking-tight text-foreground">{current}</span>
            </span>
            <ChevronDown aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          </button>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <label htmlFor={searchId} className="sr-only">
                Search tasks
              </label>
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                id={searchId}
                type="search"
                value={state.filter.search}
                onChange={(event) => state.setFilter({ search: event.target.value })}
                placeholder="Search tasks"
                // 16px: an iPhone zooms the page in on a smaller field.
                className="min-h-11 w-full rounded-2xl border border-border/70 bg-card pr-3 pl-10 text-base text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            {state.selection.kind === 'board' ? (
              <button
                type="button"
                onClick={() => setSheet('filters')}
                aria-label={filters > 0 ? `Filters, ${filters} on` : 'Filters'}
                className={cn(
                  'relative grid size-11 shrink-0 place-items-center rounded-2xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  filters > 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground active:bg-accent',
                )}
              >
                <SlidersHorizontal aria-hidden className="size-[1.125rem]" />
                {filters > 0 ? (
                  <span
                    aria-hidden
                    className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full border-2 border-background bg-primary text-[0.625rem] font-semibold text-primary-foreground"
                  >
                    {filters}
                  </span>
                ) : null}
              </button>
            ) : null}
          </div>

          <ErrorLine state={state} />

          {state.selection.kind === 'board' ? (
            <>
              {/* The columns, as chips with their counts: one column on screen at a time. */}
              <div
                role="tablist"
                aria-label="Columns"
                className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]"
              >
                {state.lanes.map(({ column, cards }) => (
                  <button
                    key={column.id}
                    type="button"
                    role="tab"
                    aria-selected={lane?.column.id === column.id}
                    onClick={() => setColumnId(column.id)}
                    className={cn(
                      'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      lane?.column.id === column.id
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'bg-muted text-muted-foreground active:bg-accent',
                    )}
                  >
                    {column.done ? <Check aria-hidden className="size-3.5" /> : null}
                    {column.name}
                    <span
                      className={cn(
                        'rounded-full px-1.5 text-xs tabular-nums',
                        lane?.column.id === column.id ? 'bg-primary-foreground/20' : 'bg-background/70',
                      )}
                    >
                      {cards.length}
                    </span>
                  </button>
                ))}
              </div>

              {state.board === null ? <Skeleton /> : null}
              {lane ? (
                lane.cards.length > 0 ? (
                  <ul className="grid gap-2 md:grid-cols-2">
                    {lane.cards.map((card) => (
                      <TaskCard key={card.id} card={card} today={today} onOpen={() => state.open(card.id)} />
                    ))}
                  </ul>
                ) : (
                  <Empty
                    title={`Nothing in ${lane.column.name}`}
                    body={
                      filters > 0 || state.filter.search.trim()
                        ? 'Some tasks may be hidden by the search or the filters.'
                        : state.canWrite
                          ? 'Tap ＋ to add a task here.'
                          : 'Tasks moved here will show up.'
                    }
                  />
                )
              ) : null}
              {state.board?.truncated ? (
                <p className="px-1 text-xs text-muted-foreground">
                  Showing the first tasks only. Search or filter to find the rest.
                </p>
              ) : null}
            </>
          ) : null}

          {state.selection.kind === 'mine' ? <MyTasks state={state} today={today} /> : null}

          {state.selection.kind === 'none' && state.boards !== null ? (
            <Empty
              title="No boards yet"
              body={
                state.canCreateBoards
                  ? 'Boards are made on the full site for now. Tasks assigned to you show under My tasks.'
                  : 'When a board is shared with you, it shows here.'
              }
            />
          ) : null}
        </div>
      </div>

      {/* A new task, into the column on screen. */}
      {state.canWrite && state.selection.kind === 'board' && lane && !state.filter.archived ? (
        <button
          type="button"
          onClick={() => setSheet('add')}
          aria-label={`New task in ${lane.column.name}`}
          className="absolute right-4 bottom-4 grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Plus aria-hidden className="size-6" />
        </button>
      ) : null}

      <BoardsSheet state={state} open={sheet === 'boards'} onClose={() => setSheet(null)} />
      <FiltersSheet state={state} open={sheet === 'filters'} onClose={() => setSheet(null)} />
      {boardId && lane ? (
        <AddTaskSheet
          state={state}
          boardId={boardId}
          columnId={lane.column.id}
          columnName={lane.column.name}
          open={sheet === 'add'}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </div>
  );
}

function MyTasks({ state, today }: { state: TasksState; today: string }) {
  if (state.myTasks === null) return <Skeleton />;
  if (state.myTasks.length === 0) {
    return <Empty title="Nothing assigned to you" body="Tasks assigned to you, on any board, show here by day." />;
  }
  return (
    <div className="space-y-5">
      {groupMyTasks(state.myTasks, today).map(({ group, cards }) => (
        <section key={group} aria-label={DAY_GROUP_LABELS[group]}>
          <h2
            className={cn(
              'mb-2 px-1 text-xs font-semibold uppercase tracking-wider',
              group === 'overdue' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {DAY_GROUP_LABELS[group]}
          </h2>
          <ul className="grid gap-2 md:grid-cols-2">
            {cards.map((card) => (
              <TaskCard key={card.id} card={card} today={today} showBoard onOpen={() => state.open(card.id)} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function TaskCard({
  card,
  today,
  showBoard = false,
  onOpen,
}: {
  card: TaskCardView;
  today: string;
  showBoard?: boolean;
  onOpen: () => void;
}) {
  const dates = cardDates(card, today);
  const done = card.completedAt !== null;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'relative flex w-full flex-col gap-2 overflow-hidden rounded-2xl border border-border/70 bg-card p-4 pl-5 text-left shadow-sm transition-transform active:scale-[0.99]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        {/* Priority as the card's leading edge: seen down a list before any word is read. */}
        <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1.5', PRIORITY_EDGE[card.priority] ?? '')} />
        <span className="flex items-start gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 text-[0.9375rem] font-medium leading-snug',
              done ? 'text-muted-foreground line-through' : 'text-card-foreground',
            )}
          >
            {card.title}
          </span>
          {card.priority === 'urgent' || card.priority === 'high' ? (
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold',
                card.priority === 'urgent'
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-status-warning text-status-warning-foreground',
              )}
            >
              {PRIORITY_LABELS[card.priority]}
            </span>
          ) : null}
        </span>
        {showBoard ? <span className="-mt-1 text-xs text-muted-foreground">{card.boardName}</span> : null}

        <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          {dates.due ? (
            <span
              className={cn(
                'inline-flex items-center gap-1',
                dates.overdue ? 'font-semibold text-destructive' : dates.dueSoon ? 'font-medium text-foreground' : null,
              )}
            >
              <CalendarClock aria-hidden className="size-3.5" />
              {dates.overdue ? `Overdue · ${dates.due}` : `Due ${dates.due}`}
            </span>
          ) : null}
          {card.checklistTotal > 0 ? (
            <span className="inline-flex items-center gap-1">
              <CheckSquare aria-hidden className="size-3.5" />
              {card.checklistDone}/{card.checklistTotal}
            </span>
          ) : null}
          {card.commentCount > 0 ? (
            <span className="inline-flex items-center gap-1">
              <MessageSquare aria-hidden className="size-3.5" />
              {card.commentCount}
            </span>
          ) : null}
          {card.labels.map((label) => (
            <span key={label} className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
              {label}
            </span>
          ))}
          {card.assignees.length > 0 ? (
            <span className="ml-auto flex -space-x-1.5">
              {/* Real text for a screen reader: a label on a span is not read. */}
              <span className="sr-only">Assigned to {names(card)}</span>
              {card.assignees.slice(0, 3).map((person) => (
                <span
                  key={person.userId}
                  aria-hidden
                  className="grid size-6 place-items-center rounded-full border-2 border-card bg-primary/80 text-[0.5625rem] font-semibold text-primary-foreground"
                >
                  {initials(person.displayName)}
                </span>
              ))}
              {card.assignees.length > 3 ? (
                <span
                  aria-hidden
                  className="grid size-6 place-items-center rounded-full border-2 border-card bg-muted text-[0.5625rem] font-semibold text-foreground"
                >
                  +{card.assignees.length - 3}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

/** The leading edge of a card by priority. Urgent and high stand out; normal and low stay quiet. */
const PRIORITY_EDGE: Record<string, string> = {
  urgent: 'bg-destructive',
  high: 'bg-status-warning-foreground',
  normal: 'bg-transparent',
  low: 'bg-muted',
};

// ── sheets ────────────────────────────────────────────────────────────────

function BoardsSheet({ state, open, onClose }: { state: TasksState; open: boolean; onClose: () => void }) {
  const boardId = state.selection.kind === 'board' ? state.selection.boardId : null;
  const pick = (next: Parameters<TasksState['select']>[0]) => {
    onClose();
    state.select(next);
  };
  return (
    <BottomSheet open={open} onClose={onClose} title="Boards">
      <BottomSheetRow
        icon={<User className="size-5" />}
        label="My tasks"
        detail="Assigned to you, on every board"
        current={state.selection.kind === 'mine'}
        onClick={() => pick({ kind: 'mine' })}
      />
      {(state.boards ?? []).length > 0 ? (
        <p className="px-2.5 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {state.showArchivedBoards ? 'Archived boards' : 'Boards'}
        </p>
      ) : null}
      {(state.boards ?? []).map((board) => (
        <BottomSheetRow
          key={board.id}
          icon={board.id === boardId ? <Check className="size-5" /> : <LayoutList className="size-5" />}
          label={board.name}
          detail={board.visibility === 'workspace' ? 'Shared with the workspace' : board.mine ? 'Private' : null}
          current={board.id === boardId}
          onClick={() => pick({ kind: 'board', boardId: board.id })}
        />
      ))}
      <button
        type="button"
        onClick={() => state.setShowArchivedBoards(!state.showArchivedBoards)}
        className="mx-2.5 mt-2 mb-1 text-sm font-medium text-primary"
      >
        {state.showArchivedBoards ? 'Show current boards' : 'Show archived boards'}
      </button>
    </BottomSheet>
  );
}

function FiltersSheet({ state, open, onClose }: { state: TasksState; open: boolean; onClose: () => void }) {
  const labels = state.board?.labels ?? [];
  const clear = () => state.setFilter({ label: null, priority: null, assignedToMe: false, archived: false });
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Filters"
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={clear}
            className="min-h-11 flex-1 rounded-full bg-muted text-sm font-medium text-foreground active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Clear filters
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 flex-1 rounded-full bg-primary text-sm font-medium text-primary-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Done
          </button>
        </div>
      }
    >
      <div className="space-y-5 px-2 pt-2 pb-2">
        <ChipGroup
          label="Priority"
          options={[
            { value: '', label: 'Any' },
            ...Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label })),
          ]}
          value={state.filter.priority ?? ''}
          onChange={(value) => state.setFilter({ priority: value || null })}
        />
        {labels.length > 0 ? (
          <ChipGroup
            label="Label"
            options={[{ value: '', label: 'Any' }, ...labels.map((label) => ({ value: label, label }))]}
            value={state.filter.label ?? ''}
            onChange={(value) => state.setFilter({ label: value || null })}
          />
        ) : null}
        <ChipGroup
          label="Show"
          options={[
            { value: 'all', label: 'Everyone’s' },
            { value: 'mine', label: 'Assigned to me' },
          ]}
          value={state.filter.assignedToMe ? 'mine' : 'all'}
          onChange={(value) => state.setFilter({ assignedToMe: value === 'mine' })}
        />
        <ChipGroup
          label="Tasks"
          options={[
            { value: 'current', label: 'Current' },
            { value: 'archived', label: 'Archived' },
          ]}
          value={state.filter.archived ? 'archived' : 'current'}
          onChange={(value) => state.setFilter({ archived: value === 'archived' })}
        />
      </div>
    </BottomSheet>
  );
}

function AddTaskSheet({
  state,
  boardId,
  columnId,
  columnName,
  open,
  onClose,
}: {
  state: TasksState;
  boardId: string;
  columnId: string;
  columnName: string;
  open: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const [title, setTitle] = useState('');
  return (
    <BottomSheet open={open} onClose={onClose} title={`New task in ${columnName}`}>
      <form
        className="space-y-3 px-2 pt-1 pb-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim()) return;
          void state
            .run(() => state.client.createTask(state.scope, boardId, { title, columnId }))
            .then((ok) => {
              if (!ok) return;
              setTitle('');
              onClose();
            });
        }}
      >
        <label htmlFor={titleId} className="sr-only">
          Task title
        </label>
        <input
          id={titleId}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="What needs doing?"
          // biome-ignore lint/a11y/noAutofocus: the person just asked to add a task.
          autoFocus
          className="min-h-12 w-full rounded-2xl border border-border/70 bg-background px-4 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="px-1 text-xs text-muted-foreground">
          Dates, people, labels and a checklist can be added once it is made.
        </p>
        <button
          type="submit"
          disabled={state.busy || !title.trim()}
          className="min-h-12 w-full rounded-full bg-primary text-[0.9375rem] font-medium text-primary-foreground shadow-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {state.busy ? 'Adding…' : 'Add task'}
        </button>
      </form>
    </BottomSheet>
  );
}

// ── one task ──────────────────────────────────────────────────────────────

/**
 * A task full screen: the full site's `TaskPanel` — title, description,
 * column, board, people, dates, priority, labels, checklist and comments, with
 * its own saving — under a phone header. Its Column field is how a task moves
 * on a phone.
 */
function TaskScreen({ state }: { state: TasksState }) {
  const where =
    state.selection.kind === 'mine' ? 'My tasks' : (state.board?.board.name ?? state.openTask?.boardName ?? 'Tasks');
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-2xl flex-col">
      <TaskPanel state={state} onClose={() => state.open(null)} back={where} />
    </div>
  );
}

// ── small parts ───────────────────────────────────────────────────────────

function ChipGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const on = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(option.value)}
              className={cn(
                'inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                on ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-foreground active:bg-accent',
              )}
            >
              {on ? <Check aria-hidden className="size-3.5" /> : null}
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Empty({ title, body }: { title: string; body: ReactNode }) {
  return (
    <div className="rounded-3xl border border-border/70 bg-card px-6 py-10 text-center shadow-sm">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function Skeleton() {
  return (
    <ul aria-label="Loading" className="space-y-2">
      {[0, 1, 2].map((key) => (
        <li key={key} className="h-20 animate-pulse rounded-2xl bg-muted" />
      ))}
    </ul>
  );
}

function ErrorLine({ state }: { state: TasksState }) {
  if (!state.error) return null;
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-2 rounded-2xl bg-destructive/10 px-3 py-2.5 text-sm"
    >
      <span className="text-destructive">{state.error}</span>
      <button type="button" onClick={state.dismissError} className="shrink-0 underline underline-offset-2">
        Dismiss
      </button>
    </div>
  );
}

/** What the board picker says: the board on screen, My tasks, or why there is neither yet. */
function selectionLabel(state: TasksState, boardId: string | null): string {
  if (state.selection.kind === 'mine') return 'My tasks';
  if (state.boards === null) return 'Loading…';
  return state.boards.find((board) => board.id === boardId)?.name ?? 'Boards';
}

function names(card: TaskCardView): string {
  return card.assignees.map((person) => person.displayName ?? 'someone').join(', ');
}
