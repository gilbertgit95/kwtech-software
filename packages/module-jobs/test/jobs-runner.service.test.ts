import { resolveJobsOptions } from '../src/server/jobs.options.js';
import { JobsQueueService } from '../src/server/jobs-queue.service.js';
import { JobsRunnerService } from '../src/server/jobs-runner.service.js';
import { fakeClient } from './fake-client.js';
import { harness, held, MANILA, minutesAfter, NOW, processOf } from './harness.js';

describe('a wake-up', () => {
  it('queues what is due, runs it, and records what it did', async () => {
    const reminders = processOf('task.due_today', async () => ({ handled: 12, skippedLate: 1, leftForNext: 0 }));
    const h = await harness([reminders]);

    await h.runner.tick(NOW);
    await h.runner.idle();

    expect(reminders.runs).toHaveLength(1);
    expect(h.runs()[0]).toMatchObject({ state: 'succeeded', trigger: 'scheduled', handled: 12, skippedLate: 1 });
    expect(h.process('task.due_today')?.activeRunId).toBeNull();
  });

  it('hands the process its own limits, and the schedule in force', async () => {
    const reminders = processOf('task.due_today', undefined, { maxItemsPerRun: 40, tooLateAfterMinutes: 90 });
    const h = await harness([reminders]);
    Object.assign(h.prisma.state.jobProcess[0] ?? {}, { schedule: { kind: 'interval', everyMinutes: 30 } });

    await h.runner.tick(NOW);
    await h.runner.idle();

    expect(reminders.runs[0]).toMatchObject({
      maxItems: 40,
      tooLateAfterMinutes: 90,
      schedule: { kind: 'interval', everyMinutes: 30 },
    });
  });

  it('⚠ records a process that throws as failed, and still runs the others', async () => {
    const broken = processOf('a.broken', async () => {
      throw new Error('The mail server refused.');
    });
    const fine = processOf('b.fine', async () => ({ handled: 3, skippedLate: 0, leftForNext: 0 }));
    const h = await harness([broken, fine]);

    await h.runner.tick(NOW);
    await h.runner.idle();

    expect(h.runs().map((run) => [run.processKey, run.state, run.error])).toEqual([
      ['a.broken', 'failed', 'The mail server refused.'],
      ['b.fine', 'succeeded', null],
    ]);
    // A failed process is free to run again when its schedule comes round.
    expect((await h.queue.enqueueDue(minutesAfter(15))).queued).toEqual(['a.broken', 'b.fine']);
  });

  it('⚠ runs no more than the limit at once, and the next starts as soon as one ends', async () => {
    const first = held();
    const second = held();
    const third = processOf('c.three');
    const h = await harness([processOf('a.one', first.run), processOf('b.two', second.run), third], {
      maxConcurrentRuns: 2,
    });

    await h.runner.tick(NOW);
    expect(h.runs().map((run) => run.state)).toEqual(['running', 'running', 'queued']);
    expect(third.runs).toHaveLength(0);

    // No second wake-up: the slot opening is what starts the third.
    first.release();
    second.release();
    await h.runner.idle();
    expect(h.runs().map((run) => run.state)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    expect(third.runs).toHaveLength(1);
  });

  it('⚠ does not start a second run of a process while one is under way', async () => {
    const slow = held();
    // An hour-long run, so its lease is still good when the schedule comes round again.
    const process = processOf('task.due_today', slow.run, { maxRunSeconds: 3600 });
    const h = await harness([process], { maxRunSecondsCeiling: 3600 });

    await h.runner.tick(NOW);
    await h.runner.tick(minutesAfter(30));
    expect(h.runs()).toHaveLength(1);
    expect(h.runs()[0]?.state).toBe('running');

    slow.release();
    await h.runner.idle();
  });

  it('⚠ stops a run at its time limit, tells it to stop, and marks it failed', async () => {
    let told = false;
    const stuck = processOf(
      'task.due_today',
      (context) =>
        new Promise(() => {
          context.signal.addEventListener('abort', () => {
            told = true;
          });
        }),
      { maxRunSeconds: 1 },
    );
    const h = await harness([stuck]);

    await h.runner.tick(NOW);
    await h.runner.idle();

    expect(h.runs()[0]).toMatchObject({
      state: 'failed',
      error: 'It ran past its limit of 1 seconds and was stopped.',
    });
    expect(told).toBe(true);
    expect(h.process('task.due_today')?.activeRunId).toBeNull();
  });

  it('does nothing while nothing was synced', async () => {
    const process = processOf('task.due_today');
    const h = await harness([process], { synced: false });

    await h.runner.tick(NOW);
    await h.runner.idle();

    expect(process.runs).toHaveLength(0);
    expect(h.runs()).toHaveLength(0);
  });
});

describe('the workspaces a run may reach', () => {
  const serving = (run?: Parameters<typeof processOf>[1]) =>
    processOf('task.due_today', run ?? (async (context) => ({ ...(await count(context)) })), { serves: 'task:read' });

  async function count(context: Parameters<NonNullable<Parameters<typeof processOf>[1]>>[0]) {
    const page = await context.workspaces(null, 50);
    return { handled: page.workspaces.length, skippedLate: 0, leftForNext: 0 };
  }

  it('are the ones entitled to the feature it serves, asked for by that feature', async () => {
    const asked: string[] = [];
    const h = await harness([serving()], {
      entitled: {
        async page(featureKey) {
          asked.push(featureKey);
          return { workspaces: [MANILA], nextCursor: null };
        },
      },
    });

    await h.runner.tick(NOW);
    await h.runner.idle();

    expect(asked).toEqual(['task:read']);
    expect(h.runs()[0]).toMatchObject({ state: 'succeeded', handled: 1 });
  });

  it('⚠ are none when nothing answers, and the run says so without running', async () => {
    const process = serving();
    const h = await harness([process]);

    await h.runner.tick(NOW);
    await h.runner.idle();

    expect(process.runs).toHaveLength(0);
    expect(h.runs()[0]?.state).toBe('skipped');
    expect(h.runs()[0]?.note).toMatch(/reached none/u);
  });

  it('⚠ are none when the answer cannot be read: skipped, not failed', async () => {
    const h = await harness([serving()], {
      entitled: {
        async page() {
          throw new Error('connection refused');
        },
      },
    });

    await h.runner.tick(NOW);
    await h.runner.idle();

    expect(h.runs()[0]).toMatchObject({ state: 'skipped', error: null });
    expect(h.runs()[0]?.note).toBe('The entitled workspaces could not be read, so it reached none: connection refused');
  });

  it('⚠ are none for a process that serves nothing, whatever the port would say', async () => {
    const cleanUp = processOf('jobs.history', count, { module: 'jobs', serves: null });
    const h = await harness([cleanUp], {
      entitled: {
        async page() {
          return { workspaces: [MANILA], nextCursor: null };
        },
      },
    });

    await h.runner.tick(NOW);
    await h.runner.idle();

    expect(h.runs()[0]).toMatchObject({ state: 'succeeded', handled: 0 });
  });
});

describe('at boot', () => {
  it('⚠ refuses a process that declares a longer run than the runner allows', () => {
    expect(() =>
      resolveJobsOptions({ processes: [processOf('task.due_today', undefined, { maxRunSeconds: 900 })] }),
    ).toThrow(/above the runner's ceiling of 300/u);
  });

  it('⚠ refuses a process whose handler cannot be resolved', () => {
    const options = resolveJobsOptions({
      runner: false,
      processes: [{ ...processOf('task.due_today'), handler: class NotAProvider {} }],
    });
    const runner = new JobsRunnerService(new JobsQueueService(fakeClient(), options), options);

    expect(() => runner.onApplicationBootstrap()).toThrow(/has no handler the runner can resolve/u);
  });

  it('runs with no process at all — the test of being core', async () => {
    const h = await harness([]);
    await h.runner.tick(NOW);
    await h.runner.idle();
    expect(h.runs()).toHaveLength(0);
  });
});
