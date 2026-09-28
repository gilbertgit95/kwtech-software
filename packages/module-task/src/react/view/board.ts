import {
  isScheduledAfterDue,
  isTaskDueSoon,
  isTaskOverdue,
  type TaskDay,
  type TaskDayGroup,
  taskDayGroup,
} from '../../domain/dates.js';
import type { TaskCardView, TaskColumnView } from '../task-client.js';

/**
 * The board's view rules — pure, and tested (`test/board-view.test.ts`), so
 * the components only draw.
 */

/** A column and its cards, in the board's order. */
export interface ColumnLane {
  column: TaskColumnView;
  cards: TaskCardView[];
}

/** Cards into their columns, keeping the server's order within each. A card in no known column is dropped. */
export function lanesOf(columns: readonly TaskColumnView[], cards: readonly TaskCardView[]): ColumnLane[] {
  return columns.map((column) => ({ column, cards: cards.filter((card) => card.columnId === column.id) }));
}

/** The drop target id for an empty column (or its free space), beside the card ids. */
export function columnDropId(columnId: string): string {
  return `column:${columnId}`;
}

/**
 * Where a dragged card lands, and what the lanes look like once it has — what
 * `moveTask` is told, and what the board shows while the server answers.
 *
 *   over a card in the SAME column  — it takes that card's place (the list
 *                                     moves up or down around it);
 *   over a card in ANOTHER column   — it lands just before that card;
 *   over a column's free space      — at the end of that column.
 *
 * `afterId` is the card it now follows in its column, or null at the top.
 * Null when nothing moved.
 */
export function planCardDrop(
  lanes: readonly ColumnLane[],
  activeId: string,
  overId: string,
): { lanes: ColumnLane[]; columnId: string; afterId: string | null } | null {
  const from = lanes.find((lane) => lane.cards.some((card) => card.id === activeId));
  const card = from?.cards.find((candidate) => candidate.id === activeId);
  if (!from || !card) return null;

  const overColumnId = overId.startsWith('column:') ? overId.slice('column:'.length) : null;
  const to = overColumnId
    ? lanes.find((lane) => lane.column.id === overColumnId)
    : lanes.find((lane) => lane.cards.some((candidate) => candidate.id === overId));
  if (!to) return null;

  const target = to.cards.filter((candidate) => candidate.id !== activeId);
  let index: number;
  if (overColumnId) {
    index = target.length;
  } else if (to.column.id === from.column.id) {
    index = to.cards.findIndex((candidate) => candidate.id === overId);
  } else {
    index = target.findIndex((candidate) => candidate.id === overId);
  }
  if (to.column.id === from.column.id && from.cards.findIndex((candidate) => candidate.id === activeId) === index) {
    return null;
  }

  const moved = { ...card, columnId: to.column.id };
  const nextTarget = [...target.slice(0, index), moved, ...target.slice(index)];
  const nextLanes = lanes.map((lane) => {
    if (lane.column.id === to.column.id) return { ...lane, cards: nextTarget };
    if (lane.column.id === from.column.id) return { ...lane, cards: lane.cards.filter((c) => c.id !== activeId) };
    return lane;
  });
  return { lanes: nextLanes, columnId: to.column.id, afterId: index > 0 ? (nextTarget[index - 1]?.id ?? null) : null };
}

/**
 * The keyboard's drag (Ctrl+Shift+arrows): ↑/↓ one place within the column,
 * ←/→ to the END of the neighbouring column. Null when there is nowhere to go.
 */
export function keyboardCardMove(
  lanes: readonly ColumnLane[],
  cardId: string,
  key: 'up' | 'down' | 'left' | 'right',
): ReturnType<typeof planCardDrop> {
  const laneIndex = lanes.findIndex((lane) => lane.cards.some((card) => card.id === cardId));
  const lane = lanes[laneIndex];
  if (!lane) return null;
  const at = lane.cards.findIndex((card) => card.id === cardId);
  switch (key) {
    case 'up':
    case 'down': {
      const over = lane.cards[at + (key === 'up' ? -1 : 1)];
      return over ? planCardDrop(lanes, cardId, over.id) : null;
    }
    case 'left':
    case 'right': {
      const next = lanes[laneIndex + (key === 'left' ? -1 : 1)];
      return next ? planCardDrop(lanes, cardId, columnDropId(next.column.id)) : null;
    }
  }
}

export const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

/** A day for a card: "Today", "Tomorrow", "Yesterday", else "Mon 5 Oct" — in the viewer's calendar. */
export function dayLabel(day: TaskDay, today: TaskDay): string {
  const date = new Date(`${day}T00:00:00`);
  const todayDate = new Date(`${today}T00:00:00`);
  const diff = Math.round((date.getTime() - todayDate.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const sameYear = date.getFullYear() === todayDate.getFullYear();
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** What a card says about its dates, and whether to warn. */
export function cardDates(card: Pick<TaskCardView, 'scheduledOn' | 'dueOn' | 'completedAt'>, today: TaskDay) {
  const completed = card.completedAt !== null;
  return {
    scheduled: card.scheduledOn ? dayLabel(card.scheduledOn, today) : null,
    due: card.dueOn ? dayLabel(card.dueOn, today) : null,
    overdue: isTaskOverdue({ dueOn: card.dueOn, completed }, today),
    dueSoon: isTaskDueSoon({ dueOn: card.dueOn, completed }, today),
    scheduledAfterDue: isScheduledAfterDue(card),
  };
}

export const DAY_GROUP_LABELS: Record<TaskDayGroup, string> = {
  overdue: 'Overdue',
  today: 'Today',
  this_week: 'This week',
  later: 'Later',
  no_date: 'No date',
};

const DAY_GROUP_ORDER: readonly TaskDayGroup[] = ['overdue', 'today', 'this_week', 'later', 'no_date'];

/** My tasks, grouped by day, groups in order and empty ones left out. */
export function groupMyTasks(
  cards: readonly TaskCardView[],
  today: TaskDay,
): { group: TaskDayGroup; cards: TaskCardView[] }[] {
  const grouped = new Map<TaskDayGroup, TaskCardView[]>();
  for (const card of cards) {
    const group = taskDayGroup({ ...card, completed: card.completedAt !== null }, today);
    grouped.set(group, [...(grouped.get(group) ?? []), card]);
  }
  return DAY_GROUP_ORDER.flatMap((group) => {
    const list = grouped.get(group);
    return list ? [{ group, cards: list }] : [];
  });
}

/** How to sort the list view. The board's own order is the shared rank; these are the viewer's alone. */
export type ListSort = 'board' | 'due' | 'scheduled' | 'priority';

const PRIORITY_WEIGHT: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export function sortCards(cards: readonly TaskCardView[], sort: ListSort): TaskCardView[] {
  if (sort === 'board') return [...cards];
  const byDay = (key: 'dueOn' | 'scheduledOn') => (a: TaskCardView, b: TaskCardView) => {
    const x = a[key] ?? '9999-12-31';
    const y = b[key] ?? '9999-12-31';
    return x === y ? 0 : x < y ? -1 : 1;
  };
  switch (sort) {
    case 'due':
      return [...cards].sort(byDay('dueOn'));
    case 'scheduled':
      return [...cards].sort(byDay('scheduledOn'));
    case 'priority':
      return [...cards].sort((a, b) => (PRIORITY_WEIGHT[a.priority] ?? 2) - (PRIORITY_WEIGHT[b.priority] ?? 2));
  }
}

/** Initials for an avatar: "Ana Reyes" → "AR"; nobody named → "?". */
export function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  const letters = (parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0]]).map((part) =>
    [...(part ?? '')][0]?.toUpperCase(),
  );
  return letters.join('') || '?';
}
