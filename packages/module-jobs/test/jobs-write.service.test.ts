import { JobsWriteError } from '../src/server/jobs.errors.js';
import { harness, minutesAfter, NOW, processOf } from './harness.js';

const ANA = 'user-ana';
const BEN = 'user-ben';

/** The refusal's reason, so a test asserts why and not merely that something threw. */
async function refusal(action: Promise<unknown>): Promise<string> {
  try {
    await action;
  } catch (error) {
    if (error instanceof JobsWriteError) return error.reason;
    throw error;
  }
  return 'not refused';
}

describe('pausing', () => {
  it('pauses the process and records who, when and why', async () => {
    const h = await harness([processOf('task.due_today')]);
    await h.writes.pause('task.due_today', ANA, '  The mail server is down.  ', NOW);

    expect(h.process('task.due_today')).toMatchObject({
      pausedAt: NOW,
      pausedById: ANA,
      pauseReason: 'The mail server is down.',
    });
    expect(h.controls()).toEqual([
      expect.objectContaining({
        processKey: 'task.due_today',
        action: 'paused',
        actorId: ANA,
        reason: 'The mail server is down.',
        createdAt: NOW,
      }),
    ]);
  });

  it('⚠ stops the schedule queueing it', async () => {
    const h = await harness([processOf('task.due_today')]);
    await h.writes.pause('task.due_today', ANA, 'Checking something.', NOW);

    expect((await h.queue.enqueueDue(minutesAfter(60))).queued).toEqual([]);
    expect(h.runs()).toHaveLength(0);
  });

  it('⚠ refuses a pause with no reason, and writes nothing', async () => {
    const h = await harness([processOf('task.due_today')]);

    expect(await refusal(h.writes.pause('task.due_today', ANA, '  ', NOW))).toBe('reason_required');
    expect(h.process('task.due_today')?.pausedAt).toBeNull();
    expect(h.controls()).toHaveLength(0);
  });

  it('refuses a second pause, keeping the first person’s reason and one audit row', async () => {
    const h = await harness([processOf('task.due_today')]);
    await h.writes.pause('task.due_today', ANA, 'First.', NOW);

    expect(await refusal(h.writes.pause('task.due_today', BEN, 'Second.', minutesAfter(1)))).toBe('already_paused');
    expect(h.process('task.due_today')).toMatchObject({ pausedById: ANA, pauseReason: 'First.' });
    expect(h.controls()).toHaveLength(1);
  });

  it('refuses a retired process, and one this build does not declare', async () => {
    const h = await harness([processOf('task.due_today')]);
    Object.assign(h.prisma.state.jobProcess[0] ?? {}, { deprecatedAt: NOW });

    expect(await refusal(h.writes.pause('task.due_today', ANA, 'Why.', NOW))).toBe('deprecated');
    expect(await refusal(h.writes.pause('booking.reminders', ANA, 'Why.', NOW))).toBe('unknown_process');
  });
});

describe('resuming', () => {
  it('clears the pause and records who resumed it', async () => {
    const h = await harness([processOf('task.due_today')]);
    await h.writes.pause('task.due_today', ANA, 'Checking something.', NOW);
    await h.writes.resume('task.due_today', BEN, minutesAfter(30));

    expect(h.process('task.due_today')).toMatchObject({ pausedAt: null, pausedById: null, pauseReason: null });
    expect(h.controls().map((row) => [row.action, row.actorId])).toEqual([
      ['paused', ANA],
      ['resumed', BEN],
    ]);
  });

  it('lets the schedule queue it again', async () => {
    const h = await harness([processOf('task.due_today')]);
    await h.writes.pause('task.due_today', ANA, 'Checking something.', NOW);
    await h.writes.resume('task.due_today', ANA, minutesAfter(30));

    expect((await h.queue.enqueueDue(minutesAfter(31))).queued).toEqual(['task.due_today']);
  });

  it('refuses one that is not paused', async () => {
    const h = await harness([processOf('task.due_today')]);

    expect(await refusal(h.writes.resume('task.due_today', ANA, NOW))).toBe('not_paused');
    expect(h.controls()).toHaveLength(0);
  });
});

describe('run now', () => {
  it('queues a forced run by that person, and records the action', async () => {
    const h = await harness([processOf('task.due_today')]);
    await h.writes.runNow('task.due_today', ANA, NOW);

    expect(h.runs()).toEqual([expect.objectContaining({ trigger: 'forced', forcedById: ANA, state: 'queued' })]);
    expect(h.controls()).toEqual([expect.objectContaining({ action: 'forced', actorId: ANA, createdAt: NOW })]);
  });

  it('⚠ is refused while a run is queued or under way, and queues no second (D2)', async () => {
    const h = await harness([processOf('task.due_today')]);
    await h.queue.enqueue('task.due_today', 'scheduled', NOW);

    expect(await refusal(h.writes.runNow('task.due_today', ANA, minutesAfter(1)))).toBe('already_queued');
    expect(h.runs()).toHaveLength(1);
    expect(h.controls()).toHaveLength(0);
  });

  it('is refused while the process is paused', async () => {
    const h = await harness([processOf('task.due_today')]);
    await h.writes.pause('task.due_today', ANA, 'Checking something.', NOW);

    expect(await refusal(h.writes.runNow('task.due_today', ANA, minutesAfter(1)))).toBe('paused');
    expect(h.runs()).toHaveLength(0);
  });

  it('is refused for a process never synced — it has no row to queue', async () => {
    const h = await harness([processOf('task.due_today')], { synced: false });

    expect(await refusal(h.writes.runNow('task.due_today', ANA, NOW))).toBe('unknown_process');
  });
});

describe('setting a schedule', () => {
  const every30 = { kind: 'interval', everyMinutes: 30 };

  it('stores it, in force, and records from what to what', async () => {
    const h = await harness([processOf('task.due_today')]);
    await h.writes.setSchedule('task.due_today', ANA, every30, NOW);

    expect(h.process('task.due_today')).toMatchObject({
      schedule: every30,
      scheduleSetById: ANA,
      scheduleSetAt: NOW,
    });
    expect(h.controls()).toEqual([
      expect.objectContaining({
        action: 'rescheduled',
        actorId: ANA,
        scheduleFrom: { kind: 'interval', everyMinutes: 15 },
        scheduleTo: every30,
      }),
    ]);
  });

  it('⚠ changes how often the runner queues it', async () => {
    const h = await harness([processOf('task.due_today')]);
    await h.writes.setSchedule('task.due_today', ANA, every30, NOW);
    await h.runner.tick(NOW);
    await h.runner.idle();

    // The default was every 15: at 20 minutes it would have been due.
    expect((await h.queue.enqueueDue(minutesAfter(20))).queued).toEqual([]);
    expect((await h.queue.enqueueDue(minutesAfter(30))).queued).toEqual(['task.due_today']);
  });

  it('stores times and weekdays in order, once each', async () => {
    const h = await harness([processOf('task.due_today')]);
    await h.writes.setSchedule(
      'task.due_today',
      ANA,
      { kind: 'daily', times: ['17:00', '08:00', '08:00'], weekdays: [5, 1] },
      NOW,
    );

    expect(h.process('task.due_today')?.schedule).toEqual({
      kind: 'daily',
      times: ['08:00', '17:00'],
      weekdays: [1, 5],
    });
  });

  it('⚠ refuses one faster than the process declares it can bear, naming the limit', async () => {
    const h = await harness([processOf('task.due_today')]);
    const attempt = h.writes.setSchedule('task.due_today', ANA, { kind: 'interval', everyMinutes: 5 }, NOW);

    await expect(attempt).rejects.toMatchObject({
      reason: 'invalid_schedule',
      message: 'This process can run at most every 15 minutes.',
    });
    expect(h.process('task.due_today')?.scheduleSetAt).toBeNull();
    expect(h.controls()).toHaveLength(0);
  });

  it('refuses a kind the process does not allow, and anything that is not a schedule', async () => {
    const limits = { kinds: ['daily'] as const, minEveryMinutes: 15 };
    const daily = { kind: 'daily' as const, times: ['08:00'], weekdays: [1] };
    const h = await harness([
      processOf('task.due_today', undefined, { scheduleLimits: limits, defaultSchedule: daily }),
    ]);

    expect(await refusal(h.writes.setSchedule('task.due_today', ANA, every30, NOW))).toBe('invalid_schedule');
    expect(await refusal(h.writes.setSchedule('task.due_today', ANA, { kind: 'hourly' }, NOW))).toBe(
      'invalid_schedule',
    );
    expect(await refusal(h.writes.setSchedule('task.due_today', ANA, { ...daily, times: ['8am'] }, NOW))).toBe(
      'invalid_schedule',
    );
  });

  it('writes nothing when it is the schedule already in force', async () => {
    const h = await harness([processOf('task.due_today')]);
    await h.writes.setSchedule('task.due_today', ANA, every30, NOW);
    await h.writes.setSchedule('task.due_today', BEN, every30, minutesAfter(5));

    expect(h.process('task.due_today')).toMatchObject({ scheduleSetById: ANA, scheduleSetAt: NOW });
    expect(h.controls()).toHaveLength(1);
  });
});

describe('resetting a schedule', () => {
  it('⚠ puts the default back in force, and the runner follows it', async () => {
    const h = await harness([processOf('task.due_today')]);
    await h.writes.setSchedule('task.due_today', ANA, { kind: 'interval', everyMinutes: 60 }, NOW);
    await h.writes.resetSchedule('task.due_today', BEN, minutesAfter(1));
    await h.runner.tick(minutesAfter(1));
    await h.runner.idle();

    expect(h.process('task.due_today')).toMatchObject({ scheduleSetById: null, scheduleSetAt: null });
    // Every 15 again, not every 60 — though the column still holds the old value.
    expect((await h.queue.enqueueDue(minutesAfter(17))).queued).toEqual(['task.due_today']);
    expect(h.controls().at(-1)).toMatchObject({
      action: 'reset_schedule',
      actorId: BEN,
      scheduleFrom: { kind: 'interval', everyMinutes: 60 },
      scheduleTo: { kind: 'interval', everyMinutes: 15 },
    });
  });

  it('is refused when no schedule of an admin’s is in force', async () => {
    const h = await harness([processOf('task.due_today')]);

    expect(await refusal(h.writes.resetSchedule('task.due_today', ANA, NOW))).toBe('already_default');
    expect(h.controls()).toHaveLength(0);
  });
});
