'use client';

import { useWorkspaceTimeZone } from '@kwtech/module-kit/react';
import { cn, LIST_ITEM, LIST_KEYS } from '@kwtech/web-ui/react';
import { useId, useState } from 'react';
import { workspaceTaskDay } from '../../domain/dates.js';
import type { TaskCardView } from '../task-client.js';
import type { TasksState } from '../use-tasks.js';
import { DAY_GROUP_LABELS, groupMyTasks, type ListSort, sortCards } from '../view/board.js';
import { TaskCardBody } from './board-view.js';
import { INPUT_CLASS } from './controls.js';

const SORTS: readonly { sort: ListSort; label: string }[] = [
  { sort: 'board', label: 'Board order' },
  { sort: 'due', label: 'Due date' },
  { sort: 'scheduled', label: 'Scheduled date' },
  { sort: 'priority', label: 'Priority' },
];

/**
 * The board as a list, grouped by column. Sorting is the viewer's alone: the
 * board's own order is the shared one, and this never changes it.
 */
export function ListView({ state }: { state: TasksState }) {
  const sortId = useId();
  const [sort, setSort] = useState<ListSort>('board');
  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <div className="flex items-center gap-2">
        <label htmlFor={sortId} className="text-sm text-muted-foreground">
          Sort by
        </label>
        <select
          id={sortId}
          className={cn(INPUT_CLASS, 'w-auto')}
          value={sort}
          onChange={(event) => setSort(event.target.value as ListSort)}
        >
          {SORTS.map((option) => (
            <option key={option.sort} value={option.sort}>
              {option.label}
            </option>
          ))}
        </select>
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
    return <p className="text-sm text-muted-foreground">Nothing is assigned to you on the boards you can open.</p>;
  }
  const groups = groupMyTasks(state.myTasks, workspaceTaskDay(new Date(), timeZone));
  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
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
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <h2 id={headingId} className="text-sm font-semibold">
        {title} <span className="font-normal text-muted-foreground">{cards.length}</span>
      </h2>
      {cards.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing here.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card" {...LIST_KEYS}>
          {cards.map((card) => (
            <li key={card.id}>
              <button
                type="button"
                {...LIST_ITEM}
                aria-current={card.id === state.openTaskId ? 'true' : undefined}
                onClick={() => state.open(card.id)}
                className={cn(
                  'w-full px-3 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
