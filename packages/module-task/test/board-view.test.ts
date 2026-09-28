import type { TaskCardView } from '../src/react/task-client.js';
import {
  cardDates,
  columnDropId,
  dayLabel,
  groupMyTasks,
  initials,
  keyboardCardMove,
  lanesOf,
  planCardDrop,
  sortCards,
} from '../src/react/view/board.js';

const card = (id: string, columnId: string, over: Partial<TaskCardView> = {}): TaskCardView => ({
  id,
  boardId: 'b',
  boardName: 'Board',
  columnId,
  title: id,
  priority: 'normal',
  scheduledOn: null,
  dueOn: null,
  labels: [],
  assignees: [],
  checklistDone: 0,
  checklistTotal: 0,
  commentCount: 0,
  version: 1,
  mine: true,
  completedAt: null,
  archivedAt: null,
  ...over,
});

const columns = [
  { id: 'todo', name: 'To do', done: false },
  { id: 'doing', name: 'Doing', done: false },
  { id: 'done', name: 'Done', done: true },
];
const lanes = lanesOf(columns, [card('a', 'todo'), card('b', 'todo'), card('c', 'todo'), card('x', 'doing')]);
const ids = (result: ReturnType<typeof planCardDrop>) =>
  result?.lanes.map((lane) => `${lane.column.id}:${lane.cards.map((c) => c.id).join('')}`);

describe('planCardDrop', () => {
  it('reorders within a column, taking the place of the card dropped on', () => {
    const down = planCardDrop(lanes, 'a', 'c');
    expect([ids(down), down?.afterId]).toEqual([['todo:bca', 'doing:x', 'done:'], 'c']);
    const up = planCardDrop(lanes, 'c', 'a');
    expect([ids(up), up?.afterId]).toEqual([['todo:cab', 'doing:x', 'done:'], null]);
  });

  it('lands just before a card in another column', () => {
    const result = planCardDrop(lanes, 'b', 'x');
    expect([ids(result), result?.columnId, result?.afterId]).toEqual([['todo:ac', 'doing:bx', 'done:'], 'doing', null]);
  });

  it('lands at the end of a column dropped on its free space — empty or not', () => {
    const empty = planCardDrop(lanes, 'a', columnDropId('done'));
    expect([ids(empty), empty?.afterId]).toEqual([['todo:bc', 'doing:x', 'done:a'], null]);
    const end = planCardDrop(lanes, 'a', columnDropId('doing'));
    expect(end?.afterId).toBe('x');
  });

  it('marks the moved card with its new column, so the board shows it there at once', () => {
    expect(planCardDrop(lanes, 'a', 'x')?.lanes[1]?.cards[0]?.columnId).toBe('doing');
  });

  it('is null when nothing moved or the target is unknown', () => {
    expect(planCardDrop(lanes, 'a', 'a')).toBeNull();
    expect(planCardDrop(lanes, 'a', 'nowhere')).toBeNull();
    expect(planCardDrop(lanes, 'ghost', 'a')).toBeNull();
  });
});

describe('keyboardCardMove', () => {
  it('moves one place up or down, and to the end of the next column', () => {
    expect(ids(keyboardCardMove(lanes, 'b', 'up'))).toEqual(['todo:bac', 'doing:x', 'done:']);
    expect(ids(keyboardCardMove(lanes, 'b', 'right'))).toEqual(['todo:ac', 'doing:xb', 'done:']);
    expect(keyboardCardMove(lanes, 'a', 'up')).toBeNull();
    expect(keyboardCardMove(lanes, 'a', 'left')).toBeNull();
  });
});

describe('dates on a card', () => {
  const today = '2026-10-05';
  it('says today, tomorrow and yesterday, else the day', () => {
    expect(dayLabel('2026-10-05', today)).toBe('Today');
    expect(dayLabel('2026-10-06', today)).toBe('Tomorrow');
    expect(dayLabel('2026-10-04', today)).toBe('Yesterday');
    expect(dayLabel('2026-10-09', today)).toMatch(/9 Oct/u);
    expect(dayLabel('2027-01-09', today)).toMatch(/2027/u);
  });

  it('warns overdue only while unfinished, and scheduled after due', () => {
    expect(cardDates({ scheduledOn: null, dueOn: '2026-10-01', completedAt: null }, today).overdue).toBe(true);
    expect(cardDates({ scheduledOn: null, dueOn: '2026-10-01', completedAt: 'x' }, today).overdue).toBe(false);
    expect(
      cardDates({ scheduledOn: '2026-10-09', dueOn: '2026-10-08', completedAt: null }, today).scheduledAfterDue,
    ).toBe(true);
  });
});

describe('My tasks and the list', () => {
  it('groups by day in order, leaving empty groups out', () => {
    const groups = groupMyTasks(
      [card('later', 't', { dueOn: '2026-12-01' }), card('late', 't', { dueOn: '2026-10-01' }), card('none', 't')],
      '2026-10-05',
    );
    expect(groups.map((g) => [g.group, g.cards.map((c) => c.id)])).toEqual([
      ['overdue', ['late']],
      ['later', ['later']],
      ['no_date', ['none']],
    ]);
  });

  it('sorts by due day with no date last, and by priority', () => {
    const cards = [
      card('none', 't'),
      card('late', 't', { dueOn: '2026-12-01' }),
      card('soon', 't', { dueOn: '2026-10-01' }),
    ];
    expect(sortCards(cards, 'due').map((c) => c.id)).toEqual(['soon', 'late', 'none']);
    const prio = [card('low', 't', { priority: 'low' }), card('urgent', 't', { priority: 'urgent' })];
    expect(sortCards(prio, 'priority').map((c) => c.id)).toEqual(['urgent', 'low']);
  });

  it('makes initials, and a question mark for somebody unnamed', () => {
    expect([initials('Ana Reyes'), initials('ben'), initials(null)]).toEqual(['AR', 'B', '?']);
  });
});
