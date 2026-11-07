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
    Object.assign(h.prisma.state.jobProcess[0] ?? {}, {
      schedule: { kind: 'interval', everyMinutes: 30 },
      scheduleSetAt: NOW,
    });

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

/*
 * A process that reaches EVERY organization (#94): billing's daily check must
 * reach one whose plan expired, which the workspace gate would hide. The port
 * answers every organization; the plan is not asked.
 */
describe('the organizations a run may reach', () => {
  const ORGS = ['org-1', 'org-2', 'org-expired', 'org-no-plan', 'org-5'].map((organizationId) => ({ organizationId }));
  const everyOrganization = {
    async page(cursor: string | null, limit: number) {
      const start = cursor === null ? 0 : ORGS.findIndex((one) => one.organizationId === cursor) + 1;
      const organizations = ORGS.slice(start, start + limit);
      const last = organizations.at(-1);
      return { organizations, nextCursor: start + limit < ORGS.length && last ? last.organizationId : null };
    },
  };

  /*
   * A test process shaped like billing's: sweeps by pages, records what it did
   * in a set (its own "row under @@unique"), skips what it already did, and
   * stops at maxItems with the rest left for the next run.
   */
  function sweeper(done: Set<string>) {
    return processOf(
      'billing.daily',
      async (context) => {
        let handled = 0;
        let leftForNext = 0;
        let cursor: string | null = null;
        do {
          const page = await context.organizations(cursor, 2);
          for (const one of page.organizations) {
            if (done.has(one.organizationId)) continue;
            if (handled >= context.maxItems) {
              leftForNext += 1;
              continue;
            }
            done.add(one.organizationId);
            handled += 1;
          }
          cursor = page.nextCursor;
        } while (cursor !== null && !context.signal.aborted);
        return { handled, skippedLate: 0, leftForNext };
      },
      { module: 'billing', serves: null, reach: 'organizations', maxItemsPerRun: 3 },
    );
  }

  it('⚠ sweeps every organization, the one with no plan and the expired one included, page by page', async () => {
    const done = new Set<string>();
    const h = await harness([sweeper(done)], { organizations: everyOrganization });

    await h.runner.tick(NOW);
    await h.runner.idle();
    expect(h.runs()[0]).toMatchObject({ state: 'succeeded', handled: 3, leftForNext: 2 });

    // Stopped at its item limit; the next run finishes, and a third finds nothing left.
    await h.runner.tick(minutesAfter(15));
    await h.runner.idle();
    await h.runner.tick(minutesAfter(30));
    await h.runner.idle();
    expect(h.runs().map((run) => run.handled)).toEqual([3, 2, 0]);
    expect([...done].sort()).toEqual(ORGS.map((one) => one.organizationId).sort());
  });

  it('⚠ reaches none when nothing answers, and the run says so without running', async () => {
    const process = sweeper(new Set());
    const h = await harness([process]);

    await h.runner.tick(NOW);
    await h.runner.idle();

    expect(process.runs).toHaveLength(0);
    expect(h.runs()[0]).toMatchObject({ state: 'skipped' });
    expect(h.runs()[0]?.note).toMatch(/JOBS_ORGANIZATIONS/u);
  });

  it('is skipped, not failed, when the organizations cannot be read', async () => {
    const h = await harness([sweeper(new Set())], {
      organizations: {
        async page() {
          throw new Error('connection refused');
        },
      },
    });

    await h.runner.tick(NOW);
    await h.runner.idle();

    expect(h.runs()[0]?.note).toBe('The organizations could not be read, so it reached none: connection refused');
  });

  it('a workspace process never sees every organization, nor this one any workspace', async () => {
    const workspaceProcess = processOf(
      'task.due_today',
      async (context) => ({
        handled: (await context.organizations(null, 50)).organizations.length,
        skippedLate: 0,
        leftForNext: 0,
      }),
      { serves: 'task:read' },
    );
    const h = await harness([workspaceProcess], {
      organizations: everyOrganization,
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
