import type { ProcessContribution, ProcessRunContext, ProcessRunResult, ProcessWorkspace } from '@kwtech/module-kit';
import { type JobsModuleOptions, resolveJobsOptions } from '../src/server/jobs.options.js';
import { syncJobProcesses } from '../src/server/jobs.sync.js';
import { JobsQueueService } from '../src/server/jobs-queue.service.js';
import { JobsRunnerService } from '../src/server/jobs-runner.service.js';
import type { JobsEntitledWorkspaces } from '../src/server/ports.js';
import { type FakeClient, fakeClient } from './fake-client.js';

/** Shared set-up for the queue, runner and sync suites. */

/** 00:00 UTC on Monday 5 Oct 2026 — 08:00 that morning in Manila. */
export const NOW = new Date('2026-10-05T00:00:00Z');

export const minutesAfter = (minutes: number, from: Date = NOW) => new Date(from.getTime() + minutes * 60_000);

export const MANILA: ProcessWorkspace = { organizationId: 'org-1', workspaceId: 'ws-1', timeZone: 'Asia/Manila' };

const DONE: ProcessRunResult = { handled: 0, skippedLate: 0, leftForNext: 0 };

/** A process whose handler is the given function, recording every context it was run with. */
export function processOf(
  key: string,
  run: (context: ProcessRunContext) => Promise<ProcessRunResult> = async () => DONE,
  overrides: Partial<ProcessContribution> = {},
): ProcessContribution & { runs: ProcessRunContext[] } {
  const runs: ProcessRunContext[] = [];
  return {
    key,
    module: key.split('.')[0] ?? 'task',
    label: key,
    description: `What ${key} does.`,
    serves: null,
    defaultSchedule: { kind: 'interval', everyMinutes: 15 },
    scheduleLimits: { kinds: ['interval', 'daily'], minEveryMinutes: 15 },
    maxRunSeconds: 60,
    maxItemsPerRun: 100,
    tooLateAfterMinutes: 120,
    handler: {
      async run(context: ProcessRunContext) {
        runs.push(context);
        return run(context);
      },
    },
    runs,
    ...overrides,
  };
}

/** A handler that waits until the test lets it finish — to hold a slot open. */
export function held(): { run: () => Promise<ProcessRunResult>; release: () => void } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    async run() {
      await gate;
      return DONE;
    },
    release,
  };
}

export interface HarnessOptions extends Pick<JobsModuleOptions, 'maxConcurrentRuns' | 'maxRunSecondsCeiling'> {
  /** Omitted: the entitled-workspaces port is UNBOUND. */
  entitled?: JobsEntitledWorkspaces;
  /** False leaves `job_process` and the queue lock unwritten, as before the first `db:sync`. */
  synced?: boolean;
}

export async function harness(processes: readonly ProcessContribution[], options: HarnessOptions = {}) {
  const prisma: FakeClient = fakeClient();
  const resolved = resolveJobsOptions({ processes, ...options });
  if (options.synced ?? true) await syncJobProcesses(prisma, processes, NOW);

  const queue = new JobsQueueService(prisma, resolved);
  const runner = new JobsRunnerService(queue, resolved, undefined, options.entitled);
  // Resolves the handlers. The runner's own timer is never left running in a test.
  runner.onApplicationBootstrap();
  runner.onModuleDestroy();
  const driven = new JobsRunnerService(queue, { ...resolved, runner: false }, undefined, options.entitled);
  driven.onApplicationBootstrap();

  const runs = () => prisma.state.jobRun as unknown as import('../src/server/jobs.repository.js').JobRunRow[];
  const process = (key: string) =>
    prisma.state.jobProcess.find((row) => row.key === key) as unknown as
      | import('../src/server/jobs.repository.js').JobProcessRow
      | undefined;

  return { prisma, queue, runner: driven, runs, process };
}
