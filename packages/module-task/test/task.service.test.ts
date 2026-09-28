import { TASK_CONFLICT_MESSAGE, TASK_NOT_FOUND_MESSAGE } from '../src/domain/tasks.js';
import { ANA, BEN, boardOf, CAL, harness, OTHER_WORKSPACE, SCOPE } from './harness.js';

describe('creating a task', () => {
  it('lands at the bottom of the first column, or the one named', async () => {
    const h = harness();
    const { board, todo, done } = await boardOf(h, ANA);
    await h.writes.create(SCOPE, ANA, board.id, { title: 'First' });
    await h.writes.create(SCOPE, ANA, board.id, { title: 'Second' });
    const finished = await h.writes.create(SCOPE, ANA, board.id, { title: 'Already done', columnId: done.id });
    const read = await h.tasks.board(SCOPE, ANA, board.id);
    expect(read?.tasks.filter((c) => c.task.columnId === todo.id).map((c) => c.task.title)).toEqual([
      'First',
      'Second',
    ]);
    expect(finished.completedAt).not.toBeNull();
  });

  it('⚠ refuses on a board the creator cannot open, as not found', async () => {
    const h = harness();
    const { board } = await boardOf(h, ANA, 'private');
    await expect(h.writes.create(SCOPE, BEN, board.id, { title: 'Sneaky' })).rejects.toThrow(TASK_NOT_FOUND_MESSAGE);
  });

  it('refuses a column from another board', async () => {
    const h = harness();
    const { board } = await boardOf(h, ANA);
    const other = await boardOf(h, ANA);
    await expect(h.writes.create(SCOPE, ANA, board.id, { title: 'T', columnId: other.todo.id })).rejects.toMatchObject({
      reason: 'invalid_column',
    });
  });

  it('⚠ holds the per-person cap', async () => {
    const h = harness({
      limits: { check: async ({ current }) => ({ allowed: current < 1, limit: 1, current, remaining: 0 }) },
    });
    const { board } = await boardOf(h, ANA);
    await h.writes.create(SCOPE, ANA, board.id, { title: 'One' });
    await expect(h.writes.create(SCOPE, ANA, board.id, { title: 'Two' })).rejects.toMatchObject({
      reason: 'limit_reached',
    });
  });
});

describe('⚠ assigning', () => {
  it('lets anybody assign themselves, with no ports bound at all', async () => {
    const h = harness();
    const { board } = await boardOf(h, ANA);
    const task = await h.writes.create(SCOPE, BEN, board.id, { title: 'T', assigneeIds: [BEN] });
    expect((await h.tasks.get(SCOPE, BEN, task.id))?.card.assigneeIds).toEqual([BEN]);
  });

  it('needs task:assign to add somebody else — unbound means no', async () => {
    const h = harness({ members: [ANA, BEN] });
    const { board } = await boardOf(h, ANA);
    await expect(h.writes.create(SCOPE, ANA, board.id, { title: 'T', assigneeIds: [BEN] })).rejects.toMatchObject({
      reason: 'not_permitted',
    });
  });

  it('refuses the whole list when one person is not assignable here', async () => {
    const h = harness({ assigners: [ANA], members: [ANA, BEN] });
    const { board } = await boardOf(h, ANA);
    await expect(
      h.writes.create(SCOPE, ANA, board.id, { title: 'T', assigneeIds: [BEN, 'user-stranger'] }),
    ).rejects.toMatchObject({ reason: 'not_assignable' });
  });

  it('⚠ with no directory, nobody but yourself — even holding task:assign', async () => {
    const h = harness({ assigners: [ANA] });
    const { board } = await boardOf(h, ANA);
    await expect(h.writes.create(SCOPE, ANA, board.id, { title: 'T', assigneeIds: [BEN] })).rejects.toMatchObject({
      reason: 'not_assignable',
    });
  });

  it('on a private board, assigns only its owner', async () => {
    const h = harness({ assigners: [ANA], members: [ANA, BEN] });
    const { board } = await boardOf(h, ANA, 'private');
    const task = await h.writes.create(SCOPE, ANA, board.id, { title: 'T' });
    await expect(h.writes.setAssignees(SCOPE, ANA, task.id, [ANA, BEN])).rejects.toMatchObject({
      reason: 'not_assignable',
    });
    await expect(h.writes.setAssignees(SCOPE, ANA, task.id, [ANA])).resolves.toBeDefined();
  });

  it('removing people needs no task:assign', async () => {
    const h = harness({ assigners: [ANA], members: [ANA, BEN] });
    const { board } = await boardOf(h, ANA);
    const task = await h.writes.create(SCOPE, ANA, board.id, { title: 'T', assigneeIds: [BEN] });
    await h.writes.setAssignees(SCOPE, BEN, task.id, []);
    expect((await h.tasks.get(SCOPE, ANA, task.id))?.card.assigneeIds).toEqual([]);
  });

  it('tells only the people NEWLY assigned, never the person assigning', async () => {
    const h = harness({ assigners: [ANA], members: [ANA, BEN, CAL], notify: true });
    const { board } = await boardOf(h, ANA);
    const task = await h.writes.create(SCOPE, ANA, board.id, { title: 'Fix sink', assigneeIds: [ANA, BEN] });
    await h.writes.setAssignees(SCOPE, ANA, task.id, [ANA, BEN, CAL]);
    expect(h.notices.map((n) => [n.kind, n.notice.recipientIds, n.notice.taskTitle])).toEqual([
      ['assigned', [BEN], 'Fix sink'],
      ['assigned', [CAL], 'Fix sink'],
    ]);
  });

  it('a notifier that throws never fails the assignment', async () => {
    const h = harness({ assigners: [ANA], members: [ANA, BEN] });
    const broken = { assigned: async () => Promise.reject(new Error('mail down')), commented: async () => undefined };
    (h.writes as unknown as { notifier: unknown }).notifier = broken;
    const { board } = await boardOf(h, ANA);
    await expect(h.writes.create(SCOPE, ANA, board.id, { title: 'T', assigneeIds: [BEN] })).resolves.toBeDefined();
  });
});

describe('saving the text', () => {
  it('⚠ refuses a stale save, and a no-op save changes nothing', async () => {
    const h = harness();
    const { board } = await boardOf(h, ANA);
    const task = await h.writes.create(SCOPE, ANA, board.id, { title: 'T' });
    const saved = await h.writes.update(SCOPE, BEN, task.id, task.version, { description: 'Ben’s notes' });
    expect(saved.version).toBe(task.version + 1);
    await expect(h.writes.update(SCOPE, ANA, task.id, task.version, { description: 'Ana’s' })).rejects.toThrow(
      TASK_CONFLICT_MESSAGE,
    );
    const again = await h.writes.update(SCOPE, BEN, task.id, saved.version, { description: 'Ben’s notes' });
    expect(again.version).toBe(saved.version);
  });

  it('⚠ a card moved while somebody types is NOT a conflict', async () => {
    const h = harness();
    const { board, doing } = await boardOf(h, ANA);
    const task = await h.writes.create(SCOPE, ANA, board.id, { title: 'T' });
    await h.writes.move(SCOPE, BEN, task.id, { columnId: doing.id });
    await h.writes.setPriority(SCOPE, BEN, task.id, 'urgent');
    await expect(h.writes.update(SCOPE, ANA, task.id, task.version, { description: 'typed' })).resolves.toMatchObject({
      description: 'typed',
      priority: 'urgent',
    });
  });

  it('⚠ a conflict is never answered for a task the caller cannot see', async () => {
    const h = harness();
    const { board } = await boardOf(h, ANA, 'private');
    const task = await h.writes.create(SCOPE, ANA, board.id, { title: 'T' });
    await expect(h.writes.update(SCOPE, BEN, task.id, 999, { title: 'x' })).rejects.toThrow(TASK_NOT_FOUND_MESSAGE);
  });
});

describe('moving', () => {
  it('places a card after another, at the top, and across columns — finishing it in a done column', async () => {
    const h = harness();
    const { board, todo, done } = await boardOf(h, ANA);
    const a = await h.writes.create(SCOPE, ANA, board.id, { title: 'A' });
    const b = await h.writes.create(SCOPE, ANA, board.id, { title: 'B' });
    const c = await h.writes.create(SCOPE, ANA, board.id, { title: 'C' });
    await h.writes.move(SCOPE, ANA, c.id, { columnId: todo.id, afterTaskId: null });
    await h.writes.move(SCOPE, ANA, a.id, { columnId: todo.id, afterTaskId: b.id });
    const order = async () => (await h.tasks.board(SCOPE, ANA, board.id))?.tasks.map((card) => card.task.title);
    expect(await order()).toEqual(['C', 'B', 'A']);

    const moved = await h.writes.move(SCOPE, ANA, b.id, { columnId: done.id });
    expect(moved.completedAt).not.toBeNull();
    const back = await h.writes.move(SCOPE, ANA, b.id, { columnId: todo.id });
    expect(back.completedAt).toBeNull();
  });

  it('rebalances a column that ran out of room, keeping the order', async () => {
    const h = harness();
    const { board, todo } = await boardOf(h, ANA);
    const first = await h.writes.create(SCOPE, ANA, board.id, { title: 'first' });
    const last = await h.writes.create(SCOPE, ANA, board.id, { title: 'last' });
    const moving = [];
    for (let i = 0; i < 60; i += 1) moving.push(await h.writes.create(SCOPE, ANA, board.id, { title: `m${i}` }));
    // Always drop just after `first`: the gap halves every time.
    for (const task of moving) await h.writes.move(SCOPE, ANA, task.id, { columnId: todo.id, afterTaskId: first.id });
    const titles = (await h.tasks.board(SCOPE, ANA, board.id))?.tasks.map((card) => card.task.title) ?? [];
    const expected = ['first', ...Array.from({ length: 60 }, (_, i) => `m${59 - i}`), last.title];
    expect(titles).toEqual(expected);
  });

  it('⚠ onto a private board, keeps only its owner assigned', async () => {
    const h = harness({ assigners: [ANA], members: [ANA, BEN] });
    const shared = await boardOf(h, ANA);
    const mine = await boardOf(h, ANA, 'private');
    const task = await h.writes.create(SCOPE, ANA, shared.board.id, { title: 'T', assigneeIds: [ANA, BEN] });
    await h.writes.move(SCOPE, ANA, task.id, { boardId: mine.board.id, columnId: mine.todo.id });
    const found = await h.tasks.get(SCOPE, ANA, task.id);
    expect([found?.card.task.boardId, found?.card.assigneeIds]).toEqual([mine.board.id, [ANA]]);
    expect(await h.tasks.get(SCOPE, BEN, task.id)).toBeNull();
  });

  it('refuses a move onto a board the mover cannot open, or a column of another board', async () => {
    const h = harness();
    const { board, todo } = await boardOf(h, ANA);
    const secret = await boardOf(h, CAL, 'private');
    const task = await h.writes.create(SCOPE, ANA, board.id, { title: 'T' });
    await expect(
      h.writes.move(SCOPE, ANA, task.id, { boardId: secret.board.id, columnId: secret.todo.id }),
    ).rejects.toThrow(TASK_NOT_FOUND_MESSAGE);
    await expect(h.writes.move(SCOPE, ANA, task.id, { columnId: secret.todo.id })).rejects.toMatchObject({
      reason: 'invalid_column',
    });
    expect(todo).toBeDefined();
  });
});

describe('the small fields', () => {
  it('sets and clears both dates, allowing scheduled after due', async () => {
    const h = harness();
    const { board } = await boardOf(h, ANA);
    const task = await h.writes.create(SCOPE, ANA, board.id, { title: 'T' });
    const dated = await h.writes.setDates(SCOPE, ANA, task.id, '2026-10-09', '2026-10-05');
    expect([dated.scheduledOn?.toISOString().slice(0, 10), dated.dueOn?.toISOString().slice(0, 10)]).toEqual([
      '2026-10-09',
      '2026-10-05',
    ]);
    const cleared = await h.writes.setDates(SCOPE, ANA, task.id, null, null);
    expect([cleared.scheduledOn, cleared.dueOn]).toEqual([null, null]);
    await expect(h.writes.setDates(SCOPE, ANA, task.id, '2026-02-30', null)).rejects.toMatchObject({
      reason: 'invalid_date',
    });
  });

  it('refuses a priority that is not one', async () => {
    const h = harness();
    const { board } = await boardOf(h, ANA);
    const task = await h.writes.create(SCOPE, ANA, board.id, { title: 'T' });
    await expect(h.writes.setPriority(SCOPE, ANA, task.id, 'critical')).rejects.toMatchObject({
      reason: 'invalid_priority',
    });
  });
});

describe('reading a board', () => {
  it('⚠ searches with % and _ as literal characters', async () => {
    const h = harness();
    const { board } = await boardOf(h, ANA);
    await h.writes.create(SCOPE, ANA, board.id, { title: 'Raise prices 10%' });
    await h.writes.create(SCOPE, ANA, board.id, { title: 'Raise prices 100 pesos' });
    const read = await h.tasks.board(SCOPE, ANA, board.id, { search: '10%' });
    expect(read?.tasks.map((card) => card.task.title)).toEqual(['Raise prices 10%']);
  });

  it('filters by label and assignment, and lists the board’s labels whatever the filter', async () => {
    const h = harness();
    const { board } = await boardOf(h, ANA);
    await h.writes.create(SCOPE, ANA, board.id, { title: 'A', labels: ['kitchen'], assigneeIds: [ANA] });
    await h.writes.create(SCOPE, ANA, board.id, { title: 'B', labels: ['front'] });
    const read = await h.tasks.board(SCOPE, ANA, board.id, { label: 'Kitchen' });
    expect([read?.tasks.map((c) => c.task.title), read?.labels]).toEqual([['A'], ['front', 'kitchen']]);
    const mine = await h.tasks.board(SCOPE, ANA, board.id, { assignedToMe: true });
    expect(mine?.tasks.map((c) => c.task.title)).toEqual(['A']);
  });

  it('⚠ My tasks leaves out boards you can no longer open, archived tasks and archived boards', async () => {
    const h = harness({ assigners: [ANA], members: [ANA, BEN] });
    const shared = await boardOf(h, ANA);
    const other = await boardOf(h, ANA);
    const keep = await h.writes.create(SCOPE, ANA, shared.board.id, { title: 'Keep', assigneeIds: [BEN] });
    const archived = await h.writes.create(SCOPE, ANA, shared.board.id, { title: 'Old', assigneeIds: [BEN] });
    await h.writes.archive(SCOPE, ANA, archived.id);
    await h.writes.create(SCOPE, ANA, other.board.id, { title: 'Gone private', assigneeIds: [BEN] });
    await h.boards.setVisibility(SCOPE, ANA, other.board.id, 'private');
    expect((await h.tasks.myTasks(SCOPE, BEN)).map(({ card }) => card.task.id)).toEqual([keep.id]);
  });

  it('⚠ never reads a task through another workspace', async () => {
    const h = harness();
    const { board } = await boardOf(h, ANA);
    const task = await h.writes.create(SCOPE, ANA, board.id, { title: 'T' });
    expect(await h.tasks.get(OTHER_WORKSPACE, ANA, task.id)).toBeNull();
  });
});

describe('the checklist', () => {
  it('adds, ticks, reorders and removes items — only through their own task', async () => {
    const h = harness();
    const { board } = await boardOf(h, ANA);
    const task = await h.writes.create(SCOPE, ANA, board.id, { title: 'T' });
    const other = await h.writes.create(SCOPE, ANA, board.id, { title: 'Other' });
    await h.writes.addChecklistItem(SCOPE, ANA, task.id, 'one');
    await h.writes.addChecklistItem(SCOPE, ANA, task.id, 'two');
    const items = () => h.tasks.get(SCOPE, ANA, task.id).then((f) => f?.card.checklist ?? []);
    const [one, two] = await items();
    if (!one || !two) throw new Error('items missing');
    await h.writes.updateChecklistItem(SCOPE, BEN, task.id, one.id, { done: true });
    await h.writes.moveChecklistItem(SCOPE, ANA, task.id, two.id, null);
    expect((await items()).map((i) => [i.text, i.done, i.doneById])).toEqual([
      ['two', false, null],
      ['one', true, BEN],
    ]);
    await expect(h.writes.removeChecklistItem(SCOPE, ANA, other.id, one.id)).rejects.toMatchObject({
      reason: 'invalid_checklist_item',
    });
    await h.writes.removeChecklistItem(SCOPE, ANA, task.id, one.id);
    expect((await items()).map((i) => i.text)).toEqual(['two']);
  });
});

describe('archive and delete', () => {
  it('⚠ deletes forever only from the archive, and only creator, owner or manage_all', async () => {
    const h = harness({ managers: [CAL] });
    const { board } = await boardOf(h, ANA);
    const task = await h.writes.create(SCOPE, BEN, board.id, { title: 'T' });
    await expect(h.writes.deleteForever(SCOPE, BEN, task.id)).rejects.toMatchObject({ reason: 'not_archived' });
    await h.writes.archive(SCOPE, CAL, task.id);
    await expect(h.writes.deleteForever(SCOPE, 'user-dan', task.id)).rejects.toMatchObject({ reason: 'not_permitted' });
    await h.writes.deleteForever(SCOPE, CAL, task.id);
    expect(h.prisma.state.task).toHaveLength(0);
  });

  it('an archived task is read-only until restored', async () => {
    const h = harness();
    const { board } = await boardOf(h, ANA);
    const task = await h.writes.create(SCOPE, ANA, board.id, { title: 'T' });
    await h.writes.archive(SCOPE, ANA, task.id);
    await expect(h.writes.setPriority(SCOPE, ANA, task.id, 'high')).rejects.toMatchObject({ reason: 'archived' });
    await h.writes.restore(SCOPE, ANA, task.id);
    await expect(h.writes.setPriority(SCOPE, ANA, task.id, 'high')).resolves.toMatchObject({ priority: 'high' });
  });
});

describe('comments', () => {
  it('counts on the task, notifies assignees and creator but not the commenter', async () => {
    const h = harness({ assigners: [ANA], members: [ANA, BEN, CAL], notify: true });
    const { board } = await boardOf(h, ANA);
    const task = await h.writes.create(SCOPE, ANA, board.id, { title: 'T', assigneeIds: [BEN] });
    h.notices.length = 0;
    await h.comments.add(SCOPE, BEN, task.id, 'On it');
    expect((await h.tasks.get(SCOPE, ANA, task.id))?.card.task.commentCount).toBe(1);
    expect(h.notices.map((n) => [n.kind, n.notice.recipientIds])).toEqual([['commented', [ANA]]]);
  });

  it('⚠ are edited only by their author; removed by author, board owner or manage_all', async () => {
    const h = harness({ managers: [CAL] });
    const { board } = await boardOf(h, ANA);
    const task = await h.writes.create(SCOPE, ANA, board.id, { title: 'T' });
    const comment = await h.comments.add(SCOPE, BEN, task.id, 'Mine');
    await expect(h.comments.update(SCOPE, ANA, comment.id, 'Edited by Ana')).rejects.toMatchObject({
      reason: 'not_permitted',
    });
    await expect(h.comments.remove(SCOPE, 'user-dan', comment.id)).rejects.toMatchObject({ reason: 'not_permitted' });
    await h.comments.remove(SCOPE, ANA, comment.id);
    expect((await h.tasks.get(SCOPE, ANA, task.id))?.card.task.commentCount).toBe(0);
  });

  it('⚠ a comment on a private board’s task is not found to anybody else', async () => {
    const h = harness();
    const { board } = await boardOf(h, ANA, 'private');
    const task = await h.writes.create(SCOPE, ANA, board.id, { title: 'T' });
    const comment = await h.comments.add(SCOPE, ANA, task.id, 'note to self');
    await expect(h.comments.remove(SCOPE, BEN, comment.id)).rejects.toThrow(TASK_NOT_FOUND_MESSAGE);
    expect(await h.tasks.comments(SCOPE, BEN, task.id)).toBeNull();
  });
});
