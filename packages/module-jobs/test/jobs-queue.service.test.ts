import { harness, minutesAfter, NOW, processOf } from './harness.js';

describe('queueing a process', () => {
  it('adds a queued run and takes the process', async () => {
    const h = await harness([processOf('task.due_today')]);
    const result = await h.queue.enqueue('task.due_today', 'scheduled', NOW);

    expect('run' in result && result.run.state).toBe('queued');
    expect(h.process('task.due_today')?.activeRunId).toBe(h.runs()[0]?.id);
    expect(h.process('task.due_today')?.lastQueuedAt).toEqual(NOW);
  });

  it('⚠ refuses a second run while one is queued, whoever asks', async () => {
    const h = await harness([processOf('task.due_today')]);
    await h.queue.enqueue('task.due_today', 'scheduled', NOW);

    expect(await h.queue.enqueue('task.due_today', 'forced', NOW, 'user-ana')).toEqual({ refused: 'already_queued' });
    expect(h.runs()).toHaveLength(1);
  });

  it('refuses a process that is paused, retired or unknown, and writes no run', async () => {
    const h = await harness([processOf('task.due_today'), processOf('task.old')]);
    Object.assign(h.prisma.state.jobProcess[0] ?? {}, { pausedAt: NOW });
    Object.assign(h.prisma.state.jobProcess[1] ?? {}, { deprecatedAt: NOW });

    expect(await h.queue.enqueue('task.due_today', 'scheduled', NOW)).toEqual({ refused: 'paused' });
    expect(await h.queue.enqueue('task.old', 'scheduled', NOW)).toEqual({ refused: 'deprecated' });
    expect(await h.queue.enqueue('task.never', 'scheduled', NOW)).toEqual({ refused: 'unknown_process' });
    expect(h.runs()).toHaveLength(0);
  });
});

describe('queueing what is due', () => {
  it('queues a process never run, then not again until its cadence has passed', async () => {
    const h = await harness([processOf('task.due_today')]);

    expect((await h.queue.enqueueDue(NOW)).queued).toEqual(['task.due_today']);
    // Still queued: nothing took it.
    expect((await h.queue.enqueueDue(minutesAfter(20))).queued).toEqual([]);

    const claim = await h.queue.claimNext(NOW);
    if (claim.kind !== 'claimed') throw new Error('expected a claim');
    await h.queue.finish(claim.run.id, { state: 'succeeded' }, NOW);

    expect((await h.queue.enqueueDue(minutesAfter(14))).queued).toEqual([]);
    expect((await h.queue.enqueueDue(minutesAfter(15))).queued).toEqual(['task.due_today']);
  });

  it('follows the admin’s schedule while it fits the declared limits', async () => {
    const h = await harness([processOf('task.due_today')]);
    Object.assign(h.prisma.state.jobProcess[0] ?? {}, {
      schedule: { kind: 'interval', everyMinutes: 60 },
      scheduleSetAt: NOW,
      lastQueuedAt: NOW,
    });

    expect((await h.queue.enqueueDue(minutesAfter(30))).queued).toEqual([]);
    expect((await h.queue.enqueueDue(minutesAfter(60))).queued).toEqual(['task.due_today']);
  });

  it('⚠ ignores a schedule faster than the process declared it can bear', async () => {
    const h = await harness([processOf('task.due_today')]);
    Object.assign(h.prisma.state.jobProcess[0] ?? {}, {
      schedule: { kind: 'interval', everyMinutes: 1 },
      scheduleSetAt: NOW,
      lastQueuedAt: NOW,
    });

    expect((await h.queue.enqueueDue(minutesAfter(5))).queued).toEqual([]);
    expect((await h.queue.enqueueDue(minutesAfter(15))).queued).toEqual(['task.due_today']);
  });

  it('⚠ ignores an admin’s schedule that was reset, though the column still holds it', async () => {
    const h = await harness([processOf('task.due_today')]);
    Object.assign(h.prisma.state.jobProcess[0] ?? {}, {
      schedule: { kind: 'interval', everyMinutes: 60 },
      scheduleSetAt: null,
      lastQueuedAt: NOW,
    });

    // The default, every 15 — not the 60 left behind.
    expect((await h.queue.enqueueDue(minutesAfter(15))).queued).toEqual(['task.due_today']);
  });

  it('⚠ queues nothing that was never synced, and names it', async () => {
    const h = await harness([processOf('task.due_today')], { synced: false });

    expect(await h.queue.enqueueDue(NOW)).toEqual({ queued: [], unsynced: ['task.due_today'] });
    expect(h.runs()).toHaveLength(0);
  });

  it('skips a paused process without a word', async () => {
    const h = await harness([processOf('task.due_today')]);
    Object.assign(h.prisma.state.jobProcess[0] ?? {}, { pausedAt: NOW });

    expect(await h.queue.enqueueDue(NOW)).toEqual({ queued: [], unsynced: [] });
  });
});

describe('taking runs off the queue', () => {
  it('takes the oldest first, and gives it a lease', async () => {
    const h = await harness([processOf('pos.carts'), processOf('task.due_today')]);
    await h.queue.enqueue('task.due_today', 'scheduled', NOW);
    await h.queue.enqueue('pos.carts', 'scheduled', minutesAfter(1));

    const claim = await h.queue.claimNext(minutesAfter(2));
    expect(claim.kind === 'claimed' && claim.run.processKey).toBe('task.due_today');
    expect(h.runs()[0]).toMatchObject({ state: 'running', startedAt: minutesAfter(2) });
    // 60 seconds of run, 30 of grace.
    expect(h.runs()[0]?.leaseExpiresAt).toEqual(new Date(minutesAfter(2).getTime() + 90_000));
  });

  it('⚠ takes no more than the limit on runs at once', async () => {
    const h = await harness([processOf('a.one'), processOf('b.two'), processOf('c.three')], { maxConcurrentRuns: 2 });
    for (const key of ['a.one', 'b.two', 'c.three']) await h.queue.enqueue(key, 'scheduled', NOW);

    expect((await h.queue.claimNext(NOW)).kind).toBe('claimed');
    const second = await h.queue.claimNext(NOW);
    expect(second.kind).toBe('claimed');
    expect((await h.queue.claimNext(NOW)).kind).toBe('none');

    // A slot opens when one ends.
    if (second.kind !== 'claimed') throw new Error('expected a claim');
    await h.queue.finish(second.run.id, { state: 'succeeded' }, NOW);
    const third = await h.queue.claimNext(NOW);
    expect(third.kind === 'claimed' && third.run.processKey).toBe('c.three');
  });

  it('⚠ takes nothing while the queue lock was never written', async () => {
    const h = await harness([processOf('task.due_today')]);
    await h.queue.enqueue('task.due_today', 'scheduled', NOW);
    h.prisma.state.jobQueueLock = [];

    expect((await h.queue.claimNext(NOW)).kind).toBe('none');
    expect(h.runs()[0]?.state).toBe('queued');
  });

  it('⚠ skips a run whose process was paused after it was queued, and frees the process', async () => {
    const h = await harness([processOf('task.due_today')]);
    await h.queue.enqueue('task.due_today', 'scheduled', NOW);
    Object.assign(h.prisma.state.jobProcess[0] ?? {}, { pausedAt: NOW });

    expect((await h.queue.claimNext(NOW)).kind).toBe('skipped');
    expect(h.runs()[0]).toMatchObject({ state: 'skipped', note: 'The process was paused after this run was queued.' });
    expect(h.process('task.due_today')?.activeRunId).toBeNull();
  });
});

describe('ending a run', () => {
  it('writes its counts and frees the process for the next', async () => {
    const h = await harness([processOf('task.due_today')]);
    await h.queue.enqueue('task.due_today', 'scheduled', NOW);
    const claim = await h.queue.claimNext(NOW);
    if (claim.kind !== 'claimed') throw new Error('expected a claim');

    const settled = { state: 'succeeded', handled: 12, skippedLate: 1, leftForNext: 3 } as const;
    expect(await h.queue.finish(claim.run.id, settled, minutesAfter(1))).toBe(true);
    expect(h.runs()[0]).toMatchObject({ ...settled, finishedAt: minutesAfter(1), leaseExpiresAt: null });
    expect(h.process('task.due_today')?.activeRunId).toBeNull();
  });

  it('⚠ lets go of a run whose server died, once its lease lapses, and not before', async () => {
    const h = await harness([processOf('task.due_today')]);
    await h.queue.enqueue('task.due_today', 'scheduled', NOW);
    await h.queue.claimNext(NOW);

    expect(await h.queue.reapLapsed(minutesAfter(1))).toBe(0);
    expect(await h.queue.reapLapsed(minutesAfter(2))).toBe(1);
    expect(h.runs()[0]?.state).toBe('interrupted');
    expect(h.process('task.due_today')?.activeRunId).toBeNull();
    // …and the process can be queued again.
    expect((await h.queue.enqueueDue(minutesAfter(16))).queued).toEqual(['task.due_today']);
  });

  it('⚠ drops a result that arrives after the run was let go', async () => {
    const h = await harness([processOf('task.due_today')]);
    await h.queue.enqueue('task.due_today', 'scheduled', NOW);
    const claim = await h.queue.claimNext(NOW);
    if (claim.kind !== 'claimed') throw new Error('expected a claim');
    await h.queue.reapLapsed(minutesAfter(2));

    expect(await h.queue.finish(claim.run.id, { state: 'succeeded', handled: 9 }, minutesAfter(3))).toBe(false);
    expect(h.runs()[0]).toMatchObject({ state: 'interrupted', handled: 0 });
  });
});
