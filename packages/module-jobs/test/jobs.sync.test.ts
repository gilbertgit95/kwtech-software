import { syncJobProcesses } from '../src/server/jobs.sync.js';
import { fakeClient } from './fake-client.js';
import { minutesAfter, NOW, processOf } from './harness.js';

describe('mirroring the declared processes', () => {
  it('writes a row for each, and the queue lock', async () => {
    const prisma = fakeClient();
    const result = await syncJobProcesses(prisma, [processOf('task.due_today')], NOW);

    expect(result).toEqual({ upserted: 1, deprecated: [] });
    expect(prisma.state.jobProcess[0]).toMatchObject({
      key: 'task.due_today',
      module: 'task',
      maxRunSeconds: 60,
      defaultSchedule: { kind: 'interval', everyMinutes: 15 },
      deprecatedAt: null,
    });
    expect(prisma.state.jobQueueLock).toHaveLength(1);
  });

  it('is the same run twice as once', async () => {
    const prisma = fakeClient();
    await syncJobProcesses(prisma, [processOf('task.due_today')], NOW);
    await syncJobProcesses(prisma, [processOf('task.due_today')], minutesAfter(1));

    expect(prisma.state.jobProcess).toHaveLength(1);
    expect(prisma.state.jobQueueLock).toHaveLength(1);
  });

  it('⚠ leaves what an admin set alone: a deploy un-pauses nothing', async () => {
    const prisma = fakeClient();
    await syncJobProcesses(prisma, [processOf('task.due_today')], NOW);
    const admin = {
      pausedAt: NOW,
      pausedById: 'user-ana',
      pauseReason: 'The mail server is down.',
      schedule: { kind: 'interval', everyMinutes: 60 },
      activeRunId: 'run-1',
    };
    Object.assign(prisma.state.jobProcess[0] ?? {}, admin);

    await syncJobProcesses(prisma, [processOf('task.due_today', undefined, { label: 'Renamed' })], minutesAfter(1));

    expect(prisma.state.jobProcess[0]).toMatchObject({ ...admin, label: 'Renamed' });
  });

  it('⚠ deprecates a process nobody declares any more, and never deletes it', async () => {
    const prisma = fakeClient();
    await syncJobProcesses(prisma, [processOf('task.due_today'), processOf('pos.carts')], NOW);

    const result = await syncJobProcesses(prisma, [processOf('task.due_today')], minutesAfter(1));

    expect(result.deprecated).toEqual(['pos.carts']);
    expect(prisma.state.jobProcess).toHaveLength(2);
    expect(prisma.state.jobProcess.find((row) => row.key === 'pos.carts')?.deprecatedAt).toEqual(minutesAfter(1));
  });

  it('brings a process back when it is declared again', async () => {
    const prisma = fakeClient();
    await syncJobProcesses(prisma, [processOf('pos.carts')], NOW);
    await syncJobProcesses(prisma, [], minutesAfter(1));
    await syncJobProcesses(prisma, [processOf('pos.carts')], minutesAfter(2));

    expect(prisma.state.jobProcess[0]?.deprecatedAt).toBeNull();
  });
});
