import { JobsWriteError } from '../src/server/jobs.errors.js';
import { directoryOf, harness, held, minutesAfter, NOW, processOf } from './harness.js';

const ANA = 'user-ana';
const PEOPLE = directoryOf({ [ANA]: 'Ana Cruz' });

describe('the list of processes', () => {
  it('lists what this build declares, by module and then key', async () => {
    const h = await harness([processOf('task.due_today'), processOf('booking.reminders'), processOf('task.cleanup')]);

    expect((await h.jobs.processes(NOW)).map((view) => view.declaration.key)).toEqual([
      'booking.reminders',
      'task.cleanup',
      'task.due_today',
    ]);
  });

  it('⚠ leaves out a row no module of this build declares', async () => {
    const h = await harness([processOf('task.due_today'), processOf('booking.reminders')]);
    // The same database, read by a build without booking.
    const without = await harness([processOf('task.due_today')]);
    without.prisma.state.jobProcess = h.prisma.state.jobProcess;

    expect((await without.jobs.processes(NOW)).map((view) => view.declaration.key)).toEqual(['task.due_today']);
  });

  it('⚠ shows a process never synced, as unable to run', async () => {
    const h = await harness([processOf('task.due_today')], { synced: false });
    const [view] = await h.jobs.processes(NOW);

    expect(view).toMatchObject({ standing: 'unsynced', nextCheckAt: null, activeRun: null, lastRun: null });
  });

  it('starts idle on its default schedule, due at once', async () => {
    const h = await harness([processOf('task.due_today')]);
    const [view] = await h.jobs.processes(NOW);

    expect(view).toMatchObject({
      standing: 'idle',
      schedule: { kind: 'interval', everyMinutes: 15 },
      scheduleIsDefault: true,
      scheduleOverrideIgnored: false,
      nextCheckAt: NOW,
    });
  });
});

describe('how a process stands on the page', () => {
  it('says where it is in the queue, in the order runs will be taken', async () => {
    const h = await harness([processOf('task.due_today'), processOf('booking.reminders')]);
    await h.queue.enqueue('task.due_today', 'scheduled', NOW);
    await h.queue.enqueue('booking.reminders', 'scheduled', minutesAfter(1));

    const views = await h.jobs.processes(minutesAfter(2));
    expect(views.map((view) => [view.declaration.key, view.standing, view.queuePosition])).toEqual([
      ['booking.reminders', 'queued', 2],
      ['task.due_today', 'queued', 1],
    ]);
    expect(views[0]?.nextCheckAt).toBeNull();
  });

  it('says a run is under way, and who forced it', async () => {
    const gate = held();
    const h = await harness([processOf('task.due_today', gate.run)], { directory: PEOPLE });
    await h.writes.runNow('task.due_today', ANA, NOW);
    await h.runner.tick(NOW);

    const view = await h.jobs.process('task.due_today', minutesAfter(1));
    expect(view).toMatchObject({ standing: 'running', queuePosition: null });
    expect(view.activeRun).toMatchObject({ state: 'running', trigger: 'forced', forcedByName: 'Ana Cruz' });

    gate.release();
    await h.runner.idle();
  });

  it('says paused, by whom and why, with no next check', async () => {
    const h = await harness([processOf('task.due_today')], { directory: PEOPLE });
    await h.writes.pause('task.due_today', ANA, 'The mail server is down.', NOW);

    expect(await h.jobs.process('task.due_today', minutesAfter(1))).toMatchObject({
      standing: 'paused',
      pausedAt: NOW,
      pausedByName: 'Ana Cruz',
      pauseReason: 'The mail server is down.',
      nextCheckAt: null,
    });
  });

  it('⚠ says failing, with the error, and still when it will be tried again', async () => {
    const h = await harness([
      processOf('task.due_today', async () => {
        throw new Error('The mail server refused.');
      }),
    ]);
    await h.runner.tick(NOW);
    await h.runner.idle();

    const view = await h.jobs.process('task.due_today', minutesAfter(1));
    expect(view).toMatchObject({
      standing: 'failing',
      failingError: 'The mail server refused.',
      nextCheckAt: minutesAfter(15),
    });
    expect(view.lastRun).toMatchObject({ state: 'failed', error: 'The mail server refused.' });
  });

  it('⚠ does not call a process failing because its last run was skipped', async () => {
    const h = await harness([processOf('task.due_today')]);
    await h.runner.tick(NOW);
    await h.runner.idle();
    // Queued, then paused before its turn: recorded as skipped.
    await h.queue.enqueue('task.due_today', 'scheduled', minutesAfter(20));
    await h.writes.pause('task.due_today', ANA, 'Checking something.', minutesAfter(21));
    await h.runner.tick(minutesAfter(22));
    await h.runner.idle();
    await h.writes.resume('task.due_today', ANA, minutesAfter(23));

    const view = await h.jobs.process('task.due_today', minutesAfter(24));
    expect(view.lastRun?.state).toBe('skipped');
    expect(view).toMatchObject({ standing: 'idle', failingError: null });
  });
});

describe('the schedule on the page', () => {
  it('shows an admin’s schedule, and who set it', async () => {
    const h = await harness([processOf('task.due_today')], { directory: PEOPLE });
    await h.writes.setSchedule('task.due_today', ANA, { kind: 'interval', everyMinutes: 30 }, NOW);

    expect(await h.jobs.process('task.due_today', NOW)).toMatchObject({
      schedule: { kind: 'interval', everyMinutes: 30 },
      scheduleIsDefault: false,
      scheduleSetAt: NOW,
      scheduleSetByName: 'Ana Cruz',
    });
  });

  it('shows the default again after a reset, with nobody’s name on it', async () => {
    const h = await harness([processOf('task.due_today')], { directory: PEOPLE });
    await h.writes.setSchedule('task.due_today', ANA, { kind: 'interval', everyMinutes: 30 }, NOW);
    await h.writes.resetSchedule('task.due_today', ANA, minutesAfter(1));

    expect(await h.jobs.process('task.due_today', minutesAfter(2))).toMatchObject({
      schedule: { kind: 'interval', everyMinutes: 15 },
      scheduleIsDefault: true,
      scheduleSetAt: null,
      scheduleSetByName: null,
    });
  });

  it('⚠ says so when an admin’s schedule no longer fits the declared limits', async () => {
    const h = await harness([processOf('task.due_today')]);
    await h.writes.setSchedule('task.due_today', ANA, { kind: 'interval', everyMinutes: 15 }, NOW);
    // A later release tightens the limit.
    const tightened = await harness([
      processOf('task.due_today', undefined, {
        defaultSchedule: { kind: 'interval', everyMinutes: 60 },
        scheduleLimits: { kinds: ['interval'], minEveryMinutes: 60 },
      }),
    ]);
    tightened.prisma.state.jobProcess = h.prisma.state.jobProcess;

    expect(await tightened.jobs.process('task.due_today', NOW)).toMatchObject({
      schedule: { kind: 'interval', everyMinutes: 60 },
      scheduleIsDefault: false,
      scheduleOverrideIgnored: true,
    });
  });
});

describe('names', () => {
  it('⚠ are simply absent when nobody answers who people are', async () => {
    const h = await harness([processOf('task.due_today')]);
    await h.writes.pause('task.due_today', ANA, 'Checking something.', NOW);

    expect((await h.jobs.process('task.due_today', NOW)).pausedByName).toBeNull();
  });

  it('⚠ never fail the page when the look-up throws', async () => {
    const h = await harness([processOf('task.due_today')], {
      directory: {
        async names() {
          throw new Error('The accounts database is away.');
        },
      },
    });
    await h.writes.pause('task.due_today', ANA, 'Checking something.', NOW);

    expect(await h.jobs.process('task.due_today', NOW)).toMatchObject({ standing: 'paused', pausedByName: null });
  });
});

describe('a process’s history', () => {
  it('is its runs and its control actions as one list, newest first, with names', async () => {
    const h = await harness([processOf('task.due_today')], { directory: PEOPLE });
    await h.runner.tick(NOW);
    await h.runner.idle();
    await h.writes.pause('task.due_today', ANA, 'Checking something.', minutesAfter(5));
    await h.writes.resume('task.due_today', ANA, minutesAfter(10));

    const page = await h.jobs.history('task.due_today', null, null);
    expect(page.entries.map((entry) => entry.control?.action ?? entry.run?.state)).toEqual([
      'resumed',
      'paused',
      'succeeded',
    ]);
    expect(page.entries[1]?.control).toMatchObject({ actorName: 'Ana Cruz', reason: 'Checking something.' });
    expect(page.nextCursor).toBeNull();
  });

  it('carries the schedules a change went from and to', async () => {
    const h = await harness([processOf('task.due_today')]);
    await h.writes.setSchedule('task.due_today', ANA, { kind: 'interval', everyMinutes: 30 }, NOW);

    const [entry] = (await h.jobs.history('task.due_today', null, null)).entries;
    expect(entry?.control).toMatchObject({
      action: 'rescheduled',
      from: { kind: 'interval', everyMinutes: 15 },
      to: { kind: 'interval', everyMinutes: 30 },
    });
  });

  it('pages back through everything, each entry once', async () => {
    const h = await harness([processOf('task.due_today')]);
    for (let i = 0; i < 4; i += 1) {
      await h.writes.runNow('task.due_today', ANA, minutesAfter(i * 20));
      await h.runner.tick(minutesAfter(i * 20));
      await h.runner.idle();
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await h.jobs.history('task.due_today', cursor, 3);
      seen.push(...page.entries.map((entry) => entry.id));
      cursor = page.nextCursor;
    } while (cursor !== null);

    // Four runs and the four "Run now" rows that share their instants.
    expect(seen).toHaveLength(8);
    expect(new Set(seen).size).toBe(8);
  });

  it('keeps one process’s history out of another’s', async () => {
    const h = await harness([processOf('task.due_today'), processOf('booking.reminders')]);
    await h.writes.runNow('booking.reminders', ANA, NOW);

    expect((await h.jobs.history('task.due_today', null, null)).entries).toEqual([]);
  });

  it('refuses a process this build does not have, and a cursor it did not issue', async () => {
    const h = await harness([processOf('task.due_today')]);

    await expect(h.jobs.history('booking.reminders', null, null)).rejects.toMatchObject({ reason: 'unknown_process' });
    await expect(h.jobs.history('task.due_today', 'not-a-cursor', null)).rejects.toBeInstanceOf(JobsWriteError);
  });
});
