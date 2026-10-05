import type { ProcessRunContext, ProcessSchedule, ProcessWorkspace } from '@kwtech/module-kit';
import { dueReminderRecipients } from '../src/domain/reminders.js';
import { TASK_PROCESS_REGISTRY } from '../src/processes.js';
import { ANA, BEN, boardOf, CAL, harness, OTHER_WORKSPACE, SCOPE } from './harness.js';

const MANILA: ProcessWorkspace = { ...SCOPE, timeZone: 'Asia/Manila' };
const NEW_YORK: ProcessWorkspace = { ...OTHER_WORKSPACE, timeZone: 'America/New_York' };

/** 00:10 UTC on Monday 5 Oct 2026: 08:10 that Monday in Manila, 20:10 on SUNDAY the 4th in New York. */
const EIGHT_TEN_MANILA = new Date('2026-10-05T00:10:00Z');

const AT_EIGHT: ProcessSchedule = { kind: 'daily', times: ['08:00'], weekdays: [0, 1, 2, 3, 4, 5, 6] };

/** What the runner hands a run: the declaration's own limits unless a test says otherwise. */
function contextOf(
  now: Date,
  workspaces: readonly ProcessWorkspace[] = [MANILA],
  overrides: Partial<ProcessRunContext> = {},
): ProcessRunContext {
  return {
    now,
    schedule: AT_EIGHT,
    maxItems: 500,
    tooLateAfterMinutes: 600,
    signal: new AbortController().signal,
    async workspaces(cursor) {
      return cursor === null ? { workspaces, nextCursor: null } : { workspaces: [], nextCursor: null };
    },
    ...overrides,
  };
}

const everybody = { notify: true, members: [ANA, BEN, CAL], assigners: [ANA] };

describe('the process as declared', () => {
  it('serves tasks’ own read key, runs at 8:00 every day, and says its limits', () => {
    expect(TASK_PROCESS_REGISTRY).toEqual([
      expect.objectContaining({
        key: 'task.due_today',
        module: 'task',
        serves: 'task:read',
        defaultSchedule: AT_EIGHT,
        scheduleLimits: { kinds: ['daily', 'interval'], minEveryMinutes: 15 },
        maxRunSeconds: 120,
        maxItemsPerRun: 500,
        tooLateAfterMinutes: 600,
      }),
    ]);
  });
});

describe('who is told a task is due', () => {
  const shared = { ownerId: ANA, visibility: 'workspace' } as const;
  const everyone = new Set([ANA, BEN, CAL]);

  it('is the people assigned, or its creator when nobody is', () => {
    expect(dueReminderRecipients(shared, ANA, [BEN, CAL], everyone)).toEqual([BEN, CAL]);
    expect(dueReminderRecipients(shared, ANA, [], everyone)).toEqual([ANA]);
  });

  it('⚠ is nobody who has left the workspace', () => {
    expect(dueReminderRecipients(shared, ANA, [BEN, CAL], new Set([ANA, CAL]))).toEqual([CAL]);
    expect(dueReminderRecipients(shared, BEN, [], new Set([ANA]))).toEqual([]);
  });

  it('⚠ is nobody a private board shuts out, even the task’s creator', () => {
    const mine = { ownerId: ANA, visibility: 'private' } as const;
    expect(dueReminderRecipients(mine, BEN, [], everyone)).toEqual([]);
    expect(dueReminderRecipients(mine, BEN, [ANA, BEN], everyone)).toEqual([ANA]);
  });
});

describe('reminding people of what is due today', () => {
  it('tells the assignees on the due day, once the workspace’s time has come', async () => {
    const h = harness(everybody);
    const { board } = await boardOf(h, ANA);
    const task = await h.writes.create(SCOPE, ANA, board.id, { title: 'File the report', dueOn: '2026-10-05' });
    await h.writes.setAssignees(SCOPE, ANA, task.id, [BEN, CAL]);

    // 07:50 in Manila: not yet.
    expect(await h.dueToday.run(contextOf(new Date('2026-10-04T23:50:00Z')))).toEqual({
      handled: 0,
      skippedLate: 0,
      leftForNext: 0,
    });
    expect(h.dueNotices).toHaveLength(0);

    expect(await h.dueToday.run(contextOf(EIGHT_TEN_MANILA))).toEqual({ handled: 1, skippedLate: 0, leftForNext: 0 });
    expect(h.dueNotices).toEqual([
      {
        recipientIds: [BEN, CAL],
        ...SCOPE,
        boardId: board.id,
        boardName: board.name,
        taskId: task.id,
        taskTitle: 'File the report',
        dueOn: '2026-10-05',
      },
    ]);
  });

  it('⚠ run twice, the second tells nobody', async () => {
    const h = harness(everybody);
    const { board } = await boardOf(h, ANA);
    await h.writes.create(SCOPE, ANA, board.id, { title: 'File the report', dueOn: '2026-10-05' });

    await h.dueToday.run(contextOf(EIGHT_TEN_MANILA));
    const again = await h.dueToday.run(contextOf(new Date('2026-10-05T00:25:00Z')));

    expect(again).toEqual({ handled: 0, skippedLate: 0, leftForNext: 0 });
    expect(h.dueNotices).toHaveLength(1);
    // Nobody was assigned, so its creator was the one told.
    expect(h.dueNotices[0]?.recipientIds).toEqual([ANA]);
  });

  it('⚠ tells nobody when another server has already claimed the reminder', async () => {
    const h = harness(everybody);
    const { board } = await boardOf(h, ANA);
    const task = await h.writes.create(SCOPE, ANA, board.id, { title: 'File the report', dueOn: '2026-10-05' });
    // The other server's row lands between this run's read and its own write.
    const create = h.prisma.taskDueReminder.create.bind(h.prisma.taskDueReminder);
    h.prisma.taskDueReminder.create = async (args) => {
      h.prisma.state.taskDueReminder.push({ ...SCOPE, taskId: task.id, dueOn: args.data.dueOn, outcome: 'sent' });
      return create(args);
    };

    expect((await h.dueToday.run(contextOf(EIGHT_TEN_MANILA))).handled).toBe(0);
    expect(h.dueNotices).toHaveLength(0);
  });

  it('⚠ means each workspace’s own today: due in Manila, not yet in New York, at one instant', async () => {
    const h = harness(everybody);
    const manila = await boardOf(h, ANA);
    const newYork = await h.boards.create(OTHER_WORKSPACE, ANA, { name: 'NY', visibility: 'workspace' });
    await h.writes.create(SCOPE, ANA, manila.board.id, { title: 'Manila, the 5th', dueOn: '2026-10-05' });
    await h.writes.create(OTHER_WORKSPACE, ANA, newYork.board.id, { title: 'New York, the 5th', dueOn: '2026-10-05' });

    // Monday the 5th in Manila; still Sunday the 4th in New York, where the 5th is tomorrow.
    await h.dueToday.run(contextOf(EIGHT_TEN_MANILA, [MANILA, NEW_YORK]));
    expect(h.dueNotices.map((notice) => notice.taskTitle)).toEqual(['Manila, the 5th']);

    // 12:10 UTC on the 5th: 08:10 Monday in New York. Manila's was dealt with and is not sent again.
    await h.dueToday.run(contextOf(new Date('2026-10-05T12:10:00Z'), [MANILA, NEW_YORK]));
    expect(h.dueNotices.map((notice) => notice.taskTitle)).toEqual(['Manila, the 5th', 'New York, the 5th']);
  });

  it('⚠ skips what is past the window, counts it, and never sends it later', async () => {
    const h = harness(everybody);
    const { board } = await boardOf(h, ANA);
    await h.writes.create(SCOPE, ANA, board.id, { title: 'File the report', dueOn: '2026-10-05' });

    // 18:01 in Manila: ten hours and a minute after 8:00.
    const late = await h.dueToday.run(contextOf(new Date('2026-10-05T10:01:00Z')));
    expect(late).toEqual({ handled: 0, skippedLate: 1, leftForNext: 0 });
    expect(h.prisma.state.taskDueReminder[0]?.outcome).toBe('skipped_late');

    // Counted once: the next run does not count it again.
    expect((await h.dueToday.run(contextOf(new Date('2026-10-05T10:20:00Z')))).skippedLate).toBe(0);
    expect(h.dueNotices).toHaveLength(0);
  });

  it('⚠ stopped at its item limit, the next run finishes the rest', async () => {
    const h = harness(everybody);
    const { board } = await boardOf(h, ANA);
    for (const title of ['One', 'Two', 'Three']) {
      await h.writes.create(SCOPE, ANA, board.id, { title, dueOn: '2026-10-05' });
    }

    const first = await h.dueToday.run(contextOf(EIGHT_TEN_MANILA, [MANILA], { maxItems: 2 }));
    expect(first).toEqual({ handled: 2, skippedLate: 0, leftForNext: 1 });

    const second = await h.dueToday.run(contextOf(EIGHT_TEN_MANILA, [MANILA], { maxItems: 2 }));
    expect(second).toEqual({ handled: 1, skippedLate: 0, leftForNext: 0 });
    expect(h.dueNotices.map((notice) => notice.taskTitle).sort()).toEqual(['One', 'Three', 'Two']);
  });

  it('stops when it is told to, and leaves the rest unmarked for the next run', async () => {
    const h = harness(everybody);
    const { board } = await boardOf(h, ANA);
    for (const title of ['One', 'Two']) await h.writes.create(SCOPE, ANA, board.id, { title, dueOn: '2026-10-05' });
    const controller = new AbortController();
    controller.abort();

    await h.dueToday.run(contextOf(EIGHT_TEN_MANILA, [MANILA], { signal: controller.signal }));
    expect(h.prisma.state.taskDueReminder).toHaveLength(0);

    expect((await h.dueToday.run(contextOf(EIGHT_TEN_MANILA))).handled).toBe(2);
  });

  it('leaves alone what is finished, archived, on an archived board, or due another day', async () => {
    const h = harness(everybody);
    const { board, done } = await boardOf(h, ANA);
    const shelved = await boardOf(h, ANA);
    await h.writes.create(SCOPE, ANA, board.id, { title: 'Finished', dueOn: '2026-10-05', columnId: done.id });
    const archived = await h.writes.create(SCOPE, ANA, board.id, { title: 'Archived', dueOn: '2026-10-05' });
    await h.writes.archive(SCOPE, ANA, archived.id);
    await h.writes.create(SCOPE, ANA, board.id, { title: 'Tomorrow', dueOn: '2026-10-06' });
    await h.writes.create(SCOPE, ANA, board.id, { title: 'No date' });
    await h.writes.create(SCOPE, ANA, shelved.board.id, { title: 'Shelved', dueOn: '2026-10-05' });
    await h.boards.archive(SCOPE, ANA, shelved.board.id);

    expect(await h.dueToday.run(contextOf(EIGHT_TEN_MANILA))).toEqual({ handled: 0, skippedLate: 0, leftForNext: 0 });
    expect(h.dueNotices).toHaveLength(0);
  });

  it('reminds again when the task is moved to a new due day', async () => {
    const h = harness(everybody);
    const { board } = await boardOf(h, ANA);
    const task = await h.writes.create(SCOPE, ANA, board.id, { title: 'File the report', dueOn: '2026-10-05' });
    await h.dueToday.run(contextOf(EIGHT_TEN_MANILA));

    await h.writes.setDates(SCOPE, ANA, task.id, null, '2026-10-06');
    await h.dueToday.run(contextOf(new Date('2026-10-06T00:10:00Z')));

    expect(h.dueNotices.map((notice) => notice.dueOn)).toEqual(['2026-10-05', '2026-10-06']);
  });

  it('⚠ tells nobody who has left, and records that there was nobody to tell', async () => {
    const h = harness({ notify: true, members: [ANA], assigners: [ANA] });
    const { board } = await boardOf(h, ANA);
    // Ben created it while he worked here; the directory no longer lists him.
    h.prisma.state.task.push({
      ...SCOPE,
      id: 'task-left',
      boardId: board.id,
      columnId: 'c',
      rank: 1,
      creatorId: BEN,
      title: 'Ben’s old task',
      description: '',
      priority: 'normal',
      scheduledOn: null,
      dueOn: new Date('2026-10-05T00:00:00.000Z'),
      labels: [],
      version: 1,
      commentCount: 0,
      completedAt: null,
      archivedAt: null,
      updatedById: BEN,
    });

    expect((await h.dueToday.run(contextOf(EIGHT_TEN_MANILA))).handled).toBe(1);
    expect(h.dueNotices).toHaveLength(0);
    expect(h.prisma.state.taskDueReminder[0]?.outcome).toBe('no_recipient');
  });

  it('⚠ tells nobody when nothing can say who still works here', async () => {
    const h = harness({ notify: true });
    const { board } = await boardOf(h, ANA);
    await h.writes.create(SCOPE, ANA, board.id, { title: 'File the report', dueOn: '2026-10-05' });

    await h.dueToday.run(contextOf(EIGHT_TEN_MANILA));
    expect(h.dueNotices).toHaveLength(0);
  });

  it('does nothing, and marks nothing, while no notifier is bound', async () => {
    const h = harness({ members: [ANA] });
    const { board } = await boardOf(h, ANA);
    await h.writes.create(SCOPE, ANA, board.id, { title: 'File the report', dueOn: '2026-10-05' });

    expect(await h.dueToday.run(contextOf(EIGHT_TEN_MANILA))).toEqual({ handled: 0, skippedLate: 0, leftForNext: 0 });
    expect(h.prisma.state.taskDueReminder).toHaveLength(0);
  });

  it('reaches no workspace it was not handed', async () => {
    const h = harness(everybody);
    const { board } = await boardOf(h, ANA);
    await h.writes.create(SCOPE, ANA, board.id, { title: 'File the report', dueOn: '2026-10-05' });

    // The organization's plan has no tasks: the runner hands over nothing.
    expect((await h.dueToday.run(contextOf(EIGHT_TEN_MANILA, []))).handled).toBe(0);
    expect(h.dueNotices).toHaveLength(0);
  });
});
