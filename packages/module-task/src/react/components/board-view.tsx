'use client';

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kwtech/web-ui/react';
import {
  CalendarClock,
  CheckCircle2,
  CheckSquare,
  Clock,
  MessageSquare,
  MoreHorizontal,
  Plus,
  TriangleAlert,
} from 'lucide-react';
import { type KeyboardEvent, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { TASK_COLUMNS_MAX } from '../../domain/boards.js';
import { localTaskDay } from '../../domain/dates.js';
import type { TaskCardView, TaskColumnView } from '../task-client.js';
import type { TasksState } from '../use-tasks.js';
import { type ColumnLane, cardDates, columnDropId, keyboardCardMove, planCardDrop } from '../view/board.js';
import { RemoveColumn } from './board-settings.js';
import { Avatar, buttonClass, INPUT_CLASS, PriorityTag } from './controls.js';

/**
 * The board: its columns side by side, each a list of cards.
 *
 * - Cards drag within and between columns (`planCardDrop`), or move with
 *   Ctrl+Shift+arrows (`keyboardCardMove`). The board's order is SHARED:
 *   everybody on it sees the same order (TASK-PLAN decision 13).
 * - Every column, side by side, at every width: a narrow box scrolls sideways
 *   rather than hiding columns (the operator's request, 2026-09-28 — a
 *   one-column switcher hid the rest of the board). A column is never wider
 *   than most of the box, so the next one always peeks in to say there is more.
 * - ONE scroll area for the whole board, both ways: columns grow with their
 *   cards rather than scrolling each on its own, because a scroller inside a
 *   scroller showed two scrollbars and clipped a card dragged between columns.
 * - The dragged card is drawn in a `DragOverlay`, above every column, with a
 *   faded placeholder left where it came from. ⚠ Portalled to `body`: the app's
 *   root is an `@container`, and a size container is the containing block of
 *   `position: fixed` — inside it the overlay was placed off to the side and
 *   the drag's auto-scroll then scrolled the whole app cell sideways.
 * - The owner edits columns right here — a column's menu, and *Add column*
 *   at the end (decision 6).
 */
export function BoardView({ state }: { state: TasksState }) {
  const { board, lanes } = state;
  const hintId = useId();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    // A no-op for the keyboard: the cards move with Ctrl+Shift+arrows instead.
    useSensor(KeyboardSensor, { keyboardCodes: { start: [], cancel: [], end: [] } }),
  );
  if (!board) return null;

  const editable = state.canWrite && board.board.archivedAt === null && !state.filter.archived;
  const owner = board.board.mine && board.board.archivedAt === null;

  const dragging = draggingId ? lanes.flatMap((lane) => lane.cards).find((card) => card.id === draggingId) : undefined;

  const onDragEnd = (event: DragEndEvent) => {
    setDraggingId(null);
    if (!event.over) return;
    const planned = planCardDrop(lanes, String(event.active.id), String(event.over.id));
    if (planned) void state.moveCard(String(event.active.id), planned.lanes, planned.columnId, planned.afterId);
  };

  const onKeyDown = (event: KeyboardEvent, cardId: string) => {
    if (!(event.ctrlKey && event.shiftKey) || !editable) return;
    const key = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as const)[
      event.key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
    ];
    if (!key) return;
    event.preventDefault();
    const planned = keyboardCardMove(lanes, cardId, key);
    if (planned) void state.moveCard(cardId, planned.lanes, planned.columnId, planned.afterId);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {editable ? (
        <p id={hintId} className="sr-only">
          Drag a card to move it, or press Control, Shift and an arrow key. Everyone on this board sees the same order.
        </p>
      ) : null}
      <DndContext
        id={`task-board-${board.board.id}`}
        sensors={sensors}
        onDragStart={(event) => setDraggingId(String(event.active.id))}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDraggingId(null)}
      >
        {/*
         * `w-max` + `min-h-full`: the row is as wide as its columns and at least as tall as the box.
         * ⚠ `relative`: a scroller clips an absolutely positioned descendant (every `sr-only`
         * label in a column) only when it is that descendant's containing block. Without it,
         * the labels of columns scrolled out of view escaped and widened the whole app cell,
         * giving it a second, sideways scrollbar.
         */}
        <div className="relative min-h-0 flex-1 overflow-auto overscroll-contain pb-2">
          <div className="flex min-h-full w-max gap-3">
            {lanes.map((lane, index) => (
              <Column
                key={lane.column.id}
                state={state}
                lane={lane}
                lanes={lanes}
                index={index}
                editable={editable}
                owner={owner}
                hintId={editable ? hintId : null}
                onKeyDown={onKeyDown}
              />
            ))}
            {owner ? <AddColumn state={state} boardId={board.board.id} count={lanes.length} /> : null}
          </div>
        </div>
        {typeof document === 'undefined'
          ? null
          : createPortal(
              // dnd-kit sizes the overlay to the card being dragged; the card fills it.
              <DragOverlay>
                {dragging ? (
                  <div className="h-full w-full cursor-grabbing rounded-md border border-border bg-card p-2.5 text-card-foreground shadow-lg">
                    <TaskCardBody card={dragging} />
                  </div>
                ) : null}
              </DragOverlay>,
              document.body,
            )}
      </DndContext>
      {board.truncated ? (
        <p role="status" className="text-xs text-muted-foreground">
          This board has more tasks than can be shown at once. Search or filter to find the rest.
        </p>
      ) : null}
    </div>
  );
}

function Column({
  state,
  lane,
  lanes,
  index,
  editable,
  owner,
  hintId,
  onKeyDown,
}: {
  state: TasksState;
  lane: ColumnLane;
  lanes: readonly ColumnLane[];
  index: number;
  editable: boolean;
  owner: boolean;
  hintId: string | null;
  onKeyDown: (event: KeyboardEvent, cardId: string) => void;
}) {
  const { column, cards } = lane;
  const headingId = useId();
  const { setNodeRef, isOver } = useDroppable({ id: columnDropId(column.id), disabled: !editable });
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'flex min-h-0 flex-col gap-2 rounded-lg border border-border bg-muted/40 p-2',
        'w-[min(18rem,85cqw)] shrink-0',
        isOver && 'ring-2 ring-ring',
      )}
    >
      <header className="flex items-center justify-between gap-1 px-1">
        <h2 id={headingId} className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
          {column.done ? (
            <CheckCircle2 aria-label="Done column" className="size-4 shrink-0 text-status-success" />
          ) : null}
          <span className="truncate">{column.name}</span>
          <span className="text-xs font-normal text-muted-foreground">{cards.length}</span>
        </h2>
        {owner ? <ColumnMenu state={state} column={column} lanes={lanes} index={index} /> : null}
      </header>
      <SortableContext items={cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} aria-labelledby={headingId} className="flex min-h-12 flex-1 flex-col gap-2">
          {cards.map((card) => (
            <SortableCard
              key={card.id}
              card={card}
              open={card.id === state.openTaskId}
              disabled={!editable}
              hintId={hintId}
              onOpen={() => state.open(card.id)}
              onKeyDown={(event) => onKeyDown(event, card.id)}
            />
          ))}
        </ul>
      </SortableContext>
      {editable ? <QuickAdd state={state} column={column} /> : null}
    </section>
  );
}

function SortableCard({
  card,
  open,
  disabled,
  hintId,
  onOpen,
  onKeyDown,
}: {
  card: TaskCardView;
  open: boolean;
  disabled: boolean;
  hintId: string | null;
  onOpen: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled,
  });
  /*
   * After the spreads, dnd-kit's own attributes are undone — notes' reasoning:
   * its role and "sortable" description, its Space-to-lift instructions (cards
   * move with Ctrl+Shift+arrows), and `aria-disabled`, which it sets wherever
   * dragging is off — a card still opens.
   */
  const undo: Record<string, unknown> = {
    role: undefined,
    'aria-roledescription': undefined,
    'aria-disabled': undefined,
    'aria-describedby': hintId ?? undefined,
  };
  return (
    <li>
      <button
        ref={setNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        {...undo}
        aria-current={open ? 'true' : undefined}
        onKeyDown={onKeyDown}
        onClick={onOpen}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        // While dragged, the card itself is the placeholder; the overlay is what moves.
        className={cn(
          'w-full touch-manipulation rounded-md border border-border bg-card p-2.5 text-left text-card-foreground shadow-sm',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          open && 'ring-2 ring-primary',
          isDragging && 'opacity-40',
        )}
      >
        <TaskCardBody card={card} />
      </button>
    </li>
  );
}

/** What a card shows. Shared by the board, the list and My tasks. */
export function TaskCardBody({ card, showBoard = false }: { card: TaskCardView; showBoard?: boolean }) {
  const dates = cardDates(card, localTaskDay(new Date()));
  return (
    <span className="flex flex-col gap-1.5">
      {showBoard ? <span className="text-xs text-muted-foreground">{card.boardName}</span> : null}
      <span className={cn('text-sm font-medium', card.completedAt !== null && 'text-muted-foreground line-through')}>
        {card.title}
      </span>
      {card.labels.length > 0 ? (
        <span className="flex flex-wrap gap-1">
          {card.labels.map((label) => (
            <span key={label} className="rounded bg-secondary px-1.5 text-xs text-secondary-foreground">
              {label}
            </span>
          ))}
        </span>
      ) : null}
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <PriorityTag priority={card.priority} />
        {dates.scheduled ? (
          <span className="inline-flex items-center gap-0.5">
            <CalendarClock aria-hidden="true" className="size-3" />
            <span className="sr-only">Scheduled </span>
            {dates.scheduled}
          </span>
        ) : null}
        {dates.due ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5',
              dates.overdue && 'font-medium text-destructive',
              // Due today or within a few days: marked before it is late (`isTaskDueSoon`).
              dates.dueSoon && 'rounded bg-status-warning px-1 font-medium text-status-warning-foreground',
            )}
          >
            {dates.overdue ? <TriangleAlert aria-hidden="true" className="size-3" /> : null}
            {dates.dueSoon ? <Clock aria-hidden="true" className="size-3" /> : null}
            {dates.overdue ? 'Overdue · ' : 'Due '}
            {dates.due}
          </span>
        ) : null}
        {dates.scheduledAfterDue ? (
          <span className="rounded bg-status-warning px-1 text-status-warning-foreground">
            Scheduled after it is due
          </span>
        ) : null}
        {card.checklistTotal > 0 ? (
          <span className="inline-flex items-center gap-0.5">
            <CheckSquare aria-hidden="true" className="size-3" />
            <span className="sr-only">Checklist </span>
            {card.checklistDone}/{card.checklistTotal}
          </span>
        ) : null}
        {card.commentCount > 0 ? (
          <span className="inline-flex items-center gap-0.5">
            <MessageSquare aria-hidden="true" className="size-3" />
            {card.commentCount}
            <span className="sr-only"> comments</span>
          </span>
        ) : null}
        {card.assignees.length > 0 ? (
          <span className="ml-auto flex -space-x-1.5">
            {card.assignees.slice(0, 4).map((person) => (
              <Avatar key={person.userId} person={person} />
            ))}
          </span>
        ) : null}
      </span>
    </span>
  );
}

/** A title and Enter: a new card at the bottom of this column. */
function QuickAdd({ state, column }: { state: TasksState; column: TaskColumnView }) {
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const boardId = state.board?.board.id;
  if (!adding) {
    return (
      <button type="button" className={cn(buttonClass('ghost', 'sm'), 'justify-start')} onClick={() => setAdding(true)}>
        <Plus aria-hidden="true" className="size-3.5" />
        Add a task
      </button>
    );
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim() || !boardId) return;
        void state
          .run(() => state.client.createTask(state.scope, boardId, { title, columnId: column.id }))
          .then((ok) => {
            if (ok) setTitle('');
          });
      }}
    >
      <input
        // biome-ignore lint/a11y/noAutofocus: the person just asked to add a task here.
        autoFocus
        aria-label={`New task in ${column.name}`}
        placeholder="Task title, then Enter"
        className={INPUT_CLASS}
        value={title}
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => {
          if (!title.trim()) setAdding(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setTitle('');
            setAdding(false);
          }
        }}
      />
    </form>
  );
}

/** The owner's menu on a column header. */
function ColumnMenu({
  state,
  column,
  lanes,
  index,
}: {
  state: TasksState;
  column: TaskColumnView;
  lanes: readonly ColumnLane[];
  index: number;
}) {
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [name, setName] = useState(column.name);
  const board = state.board?.board;
  if (!board) return null;
  const { client, scope } = state;
  const act = (action: () => Promise<unknown>) => void state.run(action);

  if (renaming) {
    return (
      <form
        className="flex-1"
        onSubmit={(event) => {
          event.preventDefault();
          setRenaming(false);
          if (name.trim() && name !== column.name) act(() => client.updateColumn(scope, board.id, column.id, { name }));
        }}
      >
        <input
          // biome-ignore lint/a11y/noAutofocus: the person just chose Rename.
          autoFocus
          aria-label={`Rename ${column.name}`}
          className={cn(INPUT_CLASS, 'h-7')}
          value={name}
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => setRenaming(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setRenaming(false);
          }}
        />
      </form>
    );
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={`${column.name} column options`} className={buttonClass('ghost', 'sm')}>
            <MoreHorizontal aria-hidden="true" className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setName(column.name);
              setRenaming(true);
            }}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => act(() => client.updateColumn(scope, board.id, column.id, { done: !column.done }))}
          >
            {column.done ? 'Mark as not done' : 'Mark as done'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={index === 0}
            onSelect={() =>
              act(() => client.moveColumn(scope, board.id, column.id, lanes[index - 2]?.column.id ?? null))
            }
          >
            Move left
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={index === lanes.length - 1}
            onSelect={() =>
              act(() => client.moveColumn(scope, board.id, column.id, lanes[index + 1]?.column.id ?? null))
            }
          >
            Move right
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setRemoving(true)}>Remove…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {removing ? (
        <RemoveColumn
          board={board}
          column={column}
          taskCount={lanes[index]?.cards.length ?? 0}
          busy={state.busy}
          onCancel={() => setRemoving(false)}
          onRemove={(destination) => {
            setRemoving(false);
            act(() => client.removeColumn(scope, board.id, column.id, destination));
          }}
        />
      ) : null}
    </>
  );
}

/** *Add column* at the end of the board — the owner's. */
function AddColumn({ state, boardId, count }: { state: TasksState; boardId: string; count: number }) {
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  if (count >= TASK_COLUMNS_MAX) return null;
  if (!adding) {
    return (
      <button
        type="button"
        className={cn(buttonClass('ghost'), 'h-10 w-48 shrink-0 self-start justify-start')}
        onClick={() => setAdding(true)}
      >
        <Plus aria-hidden="true" className="size-4" />
        Add column
      </button>
    );
  }
  return (
    <form
      className="w-60 shrink-0 self-start"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        void state
          .run(() => state.client.addColumn(state.scope, boardId, name, false))
          .then((ok) => {
            if (ok) {
              setName('');
              setAdding(false);
            }
          });
      }}
    >
      <input
        // biome-ignore lint/a11y/noAutofocus: the person just chose Add column.
        autoFocus
        aria-label="New column name"
        placeholder="Column name, then Enter"
        className={INPUT_CLASS}
        value={name}
        maxLength={40}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          if (!name.trim()) setAdding(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setAdding(false);
        }}
      />
    </form>
  );
}
