import type { ProcessRunContext, ProcessWorkspace } from '@kwtech/module-kit';
import { harness, OTHER_WORKSPACE, SCOPE } from './harness.js';

const NOW = new Date('2026-10-05T03:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const WORKSPACES: ProcessWorkspace[] = [
  { ...SCOPE, timeZone: 'Asia/Manila' },
  { ...OTHER_WORKSPACE, timeZone: 'Europe/London' },
];

function context(overrides: Partial<ProcessRunContext> = {}, workspaces: readonly ProcessWorkspace[] = WORKSPACES) {
  return {
    now: NOW,
    schedule: { kind: 'daily', times: ['03:00'], weekdays: [0, 1, 2, 3, 4, 5, 6] },
    maxItems: 2000,
    tooLateAfterMinutes: 1440,
    signal: new AbortController().signal,
    // One workspace a page, so paging is exercised.
    async workspaces(cursor: string | null) {
      const at = cursor === null ? 0 : Number(cursor);
      const next = at + 1 < workspaces.length ? String(at + 1) : null;
      return { workspaces: workspaces.slice(at, at + 1), nextCursor: next };
    },
    ...overrides,
  } satisfies ProcessRunContext;
}

function seed(h: ReturnType<typeof harness>, scope: typeof SCOPE, daysOld: number, id: string) {
  h.prisma.state.studioLog.push({
    id,
    ...scope,
    userId: 'user-ana',
    fileNames: ['juan.jpg'],
    createdAt: new Date(NOW.getTime() - daysOld * DAY),
  });
}

describe('studio.prune_logs', () => {
  it('deletes what is older than the keep, in every workspace it is handed, and nothing newer', async () => {
    const h = harness();
    seed(h, SCOPE, 91, 'old-1');
    seed(h, SCOPE, 89, 'new-1');
    seed(h, OTHER_WORKSPACE, 200, 'old-2');

    expect(await h.prune.run(context())).toEqual({ handled: 2, skippedLate: 0, leftForNext: 0 });
    expect(h.prisma.state.studioLog.map((row) => row.id)).toEqual(['new-1']);
  });

  it('does nothing the second time', async () => {
    const h = harness();
    seed(h, SCOPE, 100, 'old');
    await h.prune.run(context());
    expect(await h.prune.run(context())).toEqual({ handled: 0, skippedLate: 0, leftForNext: 0 });
  });

  it('keeps for as long as the host says', async () => {
    const h = harness({ options: { logRetentionDays: 7 } });
    seed(h, SCOPE, 8, 'old');
    seed(h, SCOPE, 6, 'new');
    expect((await h.prune.run(context())).handled).toBe(1);
    expect(h.prisma.state.studioLog.map((row) => row.id)).toEqual(['new']);
  });

  it('⚠ touches only the workspaces it is handed — an organization whose plan lacks the studio is left alone', async () => {
    const h = harness();
    seed(h, SCOPE, 100, 'entitled');
    seed(h, OTHER_WORKSPACE, 100, 'not-entitled');
    await h.prune.run(context({}, [WORKSPACES[0] as ProcessWorkspace]));
    expect(h.prisma.state.studioLog.map((row) => row.id)).toEqual(['not-entitled']);
  });

  it('stops at its workspace limit and the next run finishes', async () => {
    const h = harness();
    seed(h, SCOPE, 100, 'first');
    seed(h, OTHER_WORKSPACE, 100, 'second');

    expect(await h.prune.run(context({ maxItems: 1 }))).toEqual({ handled: 1, skippedLate: 0, leftForNext: 1 });
    expect(h.prisma.state.studioLog.map((row) => row.id)).toEqual(['second']);
    // ⚠ The SAME limit: the first workspace has nothing left, so it does not use the budget up again.
    expect(await h.prune.run(context({ maxItems: 1 }))).toEqual({ handled: 1, skippedLate: 0, leftForNext: 0 });
    expect(h.prisma.state.studioLog).toEqual([]);
  });

  it('stops between workspaces when told to', async () => {
    const h = harness();
    seed(h, SCOPE, 100, 'old');
    const controller = new AbortController();
    controller.abort();
    expect((await h.prune.run(context({ signal: controller.signal }))).handled).toBe(0);
    expect(h.prisma.state.studioLog).toHaveLength(1);
  });

  it('measures the keep from the run’s clock, not the machine’s', async () => {
    const h = harness();
    seed(h, SCOPE, 10, 'recent');
    // A run "a year later" by its own clock prunes it.
    const later = new Date(NOW.getTime() + 365 * DAY);
    expect((await h.prune.run(context({ now: later }))).handled).toBe(1);
  });
});
