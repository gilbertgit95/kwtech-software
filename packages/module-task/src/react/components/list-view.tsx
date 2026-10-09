'use client';

import { useWorkspaceTimeZone } from '@kwtech/module-kit/react';
import { cn, LIST_ITEM, LIST_KEYS } from '@kwtech/web-ui/react';
import { CircleCheckBig } from 'lucide-react';
import { useId, useState } from 'react';
import { workspaceTaskDay } from '../../domain/dates.js';
import type { TaskCardView } from '../task-client.js';
import type { TasksState } from '../use-tasks.js';
import { DAY_GROUP_LABELS, groupMyTasks, type ListSort, sortCards } from '../view/board.js';
import { TaskCardBody } from './board-view.js';
import { Select } from './select.js';

const SORTS: readonly { value: ListSort; label: string }[] = [
  { value: 'board', label: 'Board order' },
  { value: 'due', label: 'Due date' },
  { value: 'scheduled', label: 'Scheduled date' },
  { value: 'priority', label: 'Priority' },
];

/**
 * The board as a list, grouped by column. Sorting is the viewer's alone: the
 * board's own order is the shared one, and this never changes it.
 */
export function ListView({ state }: { state: TasksState }) {
  const sortId = useId();
  const [sort, setSort] = useState<ListSort>('board');
  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
      <div className="flex items-center gap-2">
        <label htmlFor={sortId} className="text-xs text-muted-foreground">
          Sort by
        </label>
        <Select id={sortId} size="sm" className="w-40" value={sort} options={SORTS} onChange={setSort} />
      </div>
      {state.lanes.map((lane) => (
        <CardGroup key={lane.column.id} title={lane.column.name} cards={sortCards(lane.cards, sort)} state={state} />
      ))}
    </div>
  );
}

/** Everything assigned to the viewer, across boards, by day. */
export function MyTasksView({ state }: { state: TasksState }) {
  const timeZone = useWorkspaceTimeZone();
  if (state.myTasks === null) return <p className="text-sm text-muted-foreground">Gathering your tasks…</p>;
  if (state.myTasks.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-12 text-center">
        <span aria-hidden="true" className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
          <CircleCheckBig className="size-6" />
        </span>
        <p className="text-sm text-muted-foreground">Nothing is assigned to you on the boards you can open.</p>
      </div>
    );
  }
  const groups = groupMyTasks(state.myTasks, workspaceTaskDay(new Date(), timeZone));
  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
      {groups.map((group) => (
        <CardGroup
          key={group.group}
          title={DAY_GROUP_LABELS[group.group]}
          cards={group.cards}
          state={state}
          showBoard
        />
      ))}
    </div>
  );
}

function CardGroup({
  title,
  cards,
  state,
  showBoard = false,
}: {
  title: string;
  cards: readonly TaskCardView[];
  state: TasksState;
  showBoard?: boolean;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="flex items-center gap-2 text-sm font-semibold">
        {title}
        <span className="rounded-full bg-muted px-2 py-px text-xs font-medium text-muted-foreground">
          {cards.length}
        </span>
      </h2>
      {cards.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
          Nothing here.
        </p>
      ) : (
        <ul
          className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-xs"
          {...LIST_KEYS}
        >
          {cards.map((card) => (
            <li key={card.id}>
              <button
                type="button"
                {...LIST_ITEM}
                aria-current={card.id === state.openTaskId ? 'true' : undefined}
                onClick={() => state.open(card.id)}
                className={cn(
                  'w-full px-3.5 py-2.5 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                  card.id === state.openTaskId && 'bg-accent',
                )}
              >
                <TaskCardBody card={card} showBoard={showBoard} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
