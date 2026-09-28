import { TASK_NOT_FOUND_MESSAGE } from '../src/domain/tasks.js';
import { ANA, BEN, boardOf, CAL, harness, OTHER_WORKSPACE, SCOPE } from './harness.js';

describe('creating a board', () => {
  it('gives the creator the default columns in order, or their own', async () => {
    const h = harness();
    const { columns } = await h.boards.create(SCOPE, ANA, { name: 'Front desk' });
    expect(columns.map((c) => [c.name, c.done])).toEqual([
      ['To do', false],
      ['Doing', false],
      ['Done', true],
    ]);
    const own = await h.boards.create(SCOPE, ANA, {
      name: 'Hiring',
      columns: [{ name: 'Applied' }, { name: 'Interview' }, { name: 'Hired', done: true }],
    });
    expect(own.columns.map((c) => c.name)).toEqual(['Applied', 'Interview', 'Hired']);
  });

  it('⚠ holds the per-person cap, counting archived boards', async () => {
    const h = harness({
      limits: { check: async ({ current }) => ({ allowed: current < 1, limit: 1, current, remaining: 0 }) },
    });
    const { board } = await boardOf(h, ANA);
    await h.boards.archive(SCOPE, ANA, board.id);
    await expect(h.boards.create(SCOPE, ANA, { name: 'Two' })).rejects.toMatchObject({ reason: 'limit_reached' });
    await expect(h.boards.create(SCOPE, BEN, { name: 'Ben’s' })).resolves.toBeDefined();
  });
});

describe('⚠ who can open a board', () => {
  it('lists shared boards and your own private ones — never somebody else’s private one', async () => {
    const h = harness();
    await boardOf(h, ANA, 'workspace');
    await boardOf(h, ANA, 'private');
    await boardOf(h, BEN, 'private');
    expect((await h.boards.list(SCOPE, BEN)).map((b) => [b.ownerId, b.visibility]).sort()).toEqual([
      [ANA, 'workspace'],
      [BEN, 'private'],
    ]);
  });

  it('answers a private board and a missing one the same way', async () => {
    const h = harness();
    const { board } = await boardOf(h, ANA, 'private');
    expect(await h.boards.get(SCOPE, BEN, board.id)).toBeNull();
    expect(await h.boards.get(SCOPE, BEN, 'no-such-board')).toBeNull();
    await expect(h.boards.rename(SCOPE, BEN, board.id, 'Mine now')).rejects.toThrow(TASK_NOT_FOUND_MESSAGE);
  });

  it('⚠ never finds a board through another workspace', async () => {
    const h = harness();
    const { board } = await boardOf(h, ANA);
    expect(await h.boards.get(OTHER_WORKSPACE, ANA, board.id)).toBeNull();
  });
});

describe('configuring a board', () => {
  it('is the owner’s alone', async () => {
    const h = harness();
    const { board } = await boardOf(h, ANA);
    await expect(h.boards.rename(SCOPE, BEN, board.id, 'Ours')).rejects.toMatchObject({ reason: 'not_owner' });
    await expect(h.boards.rename(SCOPE, ANA, board.id, 'Ours')).resolves.toMatchObject({ board: { name: 'Ours' } });
  });

  it('adds, renames, reorders and removes columns', async () => {
    const h = harness();
    const { board, todo, doing, done } = await boardOf(h, ANA);
    let result = await h.boards.addColumn(SCOPE, ANA, board.id, { name: 'Review', afterColumnId: doing.id });
    expect(result.columns.map((c) => c.name)).toEqual(['To do', 'Doing', 'Review', 'Done']);
    result = await h.boards.updateColumn(SCOPE, ANA, board.id, todo.id, { name: 'Backlog' });
    expect(result.columns[0]?.name).toBe('Backlog');
    result = await h.boards.moveColumn(SCOPE, ANA, board.id, done.id, null);
    expect(result.columns.map((c) => c.name)).toEqual(['Done', 'Backlog', 'Doing', 'Review']);
    result = await h.boards.removeColumn(SCOPE, ANA, board.id, doing.id, null);
    expect(result.columns.map((c) => c.name)).toEqual(['Done', 'Backlog', 'Review']);
  });

  it('refuses a second column with the same name, ignoring case', async () => {
    const h = harness();
    const { board } = await boardOf(h, ANA);
    await expect(h.boards.addColumn(SCOPE, ANA, board.id, { name: 'done' })).rejects.toMatchObject({
      reason: 'duplicate_column',
    });
  });

  it('⚠ moves a removed column’s tasks to the destination, finishing them if it is done', async () => {
    const h = harness();
    const { board, doing, done } = await boardOf(h, ANA);
    const first = await h.writes.create(SCOPE, ANA, board.id, { title: 'One', columnId: doing.id });
    await h.writes.create(SCOPE, ANA, board.id, { title: 'Two', columnId: doing.id });
    await expect(h.boards.removeColumn(SCOPE, ANA, board.id, doing.id, null)).rejects.toMatchObject({
      reason: 'invalid_destination',
    });
    await h.boards.removeColumn(SCOPE, ANA, board.id, doing.id, done.id);
    const read = await h.tasks.board(SCOPE, ANA, board.id);
    expect(read?.tasks.map((card) => [card.task.title, card.task.columnId, card.task.completedAt !== null])).toEqual([
      ['One', done.id, true],
      ['Two', done.id, true],
    ]);
    expect(read?.tasks[0]?.task.id).toBe(first.id);
  });

  it('marking a column done finishes its tasks; unmarking un-finishes them', async () => {
    const h = harness();
    const { board, doing } = await boardOf(h, ANA);
    const task = await h.writes.create(SCOPE, ANA, board.id, { title: 'One', columnId: doing.id });
    await h.boards.updateColumn(SCOPE, ANA, board.id, doing.id, { done: true });
    expect((await h.tasks.get(SCOPE, ANA, task.id))?.card.task.completedAt).not.toBeNull();
    await h.boards.updateColumn(SCOPE, ANA, board.id, doing.id, { done: false });
    expect((await h.tasks.get(SCOPE, ANA, task.id))?.card.task.completedAt).toBeNull();
  });
});

describe('⚠ making a shared board private', () => {
  it('removes everyone else’s assignments, keeps the owner’s, and tells the others to drop it', async () => {
    const h = harness({ assigners: [ANA], members: [ANA, BEN, CAL] });
    const { board } = await boardOf(h, ANA);
    const task = await h.writes.create(SCOPE, ANA, board.id, { title: 'T', assigneeIds: [ANA, BEN, CAL] });
    expect((await h.boards.get(SCOPE, ANA, board.id)) && (await h.boards.assignmentsOfOthers(board, ANA))).toBe(2);

    await h.boards.setVisibility(SCOPE, ANA, board.id, 'private');
    expect((await h.tasks.get(SCOPE, ANA, task.id))?.card.assigneeIds).toEqual([ANA]);
    expect(h.pubsub.sent.at(-1)).toMatchObject({ change: 'hidden', visibility: 'private' });
    expect(await h.boards.get(SCOPE, BEN, board.id)).toBeNull();
  });
});

describe('archive and delete', () => {
  it('⚠ deletes a board forever only from the archive, with everything on it', async () => {
    const h = harness();
    const { board } = await boardOf(h, ANA);
    await h.writes.create(SCOPE, ANA, board.id, { title: 'T' });
    await expect(h.boards.deleteForever(SCOPE, ANA, board.id)).rejects.toMatchObject({ reason: 'board_not_archived' });
    await h.boards.archive(SCOPE, ANA, board.id);
    await h.boards.deleteForever(SCOPE, ANA, board.id);
    expect(
      [h.prisma.state.taskBoard, h.prisma.state.taskColumn, h.prisma.state.task].map((rows) => rows.length),
    ).toEqual([0, 0, 0]);
  });
});

describe('⚠ taking over an orphaned board', () => {
  it('lists only boards whose owner has left, by name and size, and hands one on', async () => {
    const h = harness({ members: [BEN, CAL] });
    const { board } = await boardOf(h, ANA, 'private');
    await boardOf(h, BEN);
    expect((await h.boards.orphaned(SCOPE)).map((o) => [o.board.id, o.taskCount])).toEqual([[board.id, 0]]);

    await h.boards.transfer(SCOPE, CAL, board.id, BEN);
    expect((await h.boards.get(SCOPE, BEN, board.id))?.board.ownerId).toBe(BEN);
  });

  it('never takes a board from an owner who is still here', async () => {
    const h = harness({ members: [ANA, BEN] });
    const { board } = await boardOf(h, ANA);
    await expect(h.boards.transfer(SCOPE, BEN, board.id, BEN)).rejects.toThrow(TASK_NOT_FOUND_MESSAGE);
  });
});
