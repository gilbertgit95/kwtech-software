import type { ProcessDeclaration } from '@kwtech/module-kit';
import { JOB_QUEUE_LOCK_ID } from '../domain/queue.js';
import type { JobProcessMirror, JobsTransaction } from './jobs.repository.js';

/** What the sync needs of a client: two delegates, and no transaction. */
export type JobsSyncClient = Pick<JobsTransaction, 'jobProcess' | 'jobQueueLock'>;

export interface JobsSyncResult {
  upserted: number;
  /** Keys that were live and are declared by no module any more. */
  deprecated: readonly string[];
}

/**
 * Mirrors the declared processes into `job_process` — the algorithm `db:sync`
 * runs, here so it agrees with the runner's own reads.
 *
 * Upsert every declaration, deprecate what is gone, NEVER delete (principle 4):
 * a deprecated process keeps its history, and never runs. A process declared
 * again is live again.
 *
 * ⚠ IT WRITES ONLY WHAT THE CODE OWNS. An admin's schedule and pause, and the
 * queue's own `activeRunId`, are not in the update: a deploy must not un-pause
 * a process somebody paused on purpose.
 *
 * ⚠ It also writes the queue lock's one row. Until it has run, no process has
 * a row and no run can be claimed — the runner is closed, not open.
 *
 * Idempotent: running it twice is running it once.
 */
export async function syncJobProcesses(
  client: JobsSyncClient,
  declarations: readonly ProcessDeclaration[],
  now: Date = new Date(),
): Promise<JobsSyncResult> {
  // Sequential on purpose: a handful of rows, and one failing names itself.
  for (const declaration of declarations) {
    const mirror = processMirror(declaration);
    await client.jobProcess.upsert({
      where: { key: declaration.key },
      create: { key: declaration.key, ...mirror },
      update: mirror,
    });
  }

  const declared = declarations.map((declaration) => declaration.key);
  const live = await client.jobProcess.findMany({ where: { deprecatedAt: null }, orderBy: [{ key: 'asc' }] });
  const deprecated = live.map((row) => row.key).filter((key) => !declared.includes(key));
  if (deprecated.length > 0) {
    await client.jobProcess.updateMany({
      where: { key: { notIn: declared }, deprecatedAt: null },
      data: { deprecatedAt: now },
    });
  }

  await client.jobQueueLock.upsert({
    where: { id: JOB_QUEUE_LOCK_ID },
    create: { id: JOB_QUEUE_LOCK_ID },
    update: { touchedAt: now },
  });

  return { upserted: declarations.length, deprecated };
}

/** A declaration as its row. `deprecatedAt: null` is what brings a re-declared process back. */
function processMirror(declaration: ProcessDeclaration): JobProcessMirror {
  return {
    module: declaration.module,
    label: declaration.label,
    description: declaration.description,
    serves: declaration.serves,
    defaultSchedule: declaration.defaultSchedule,
    scheduleLimits: declaration.scheduleLimits,
    maxRunSeconds: declaration.maxRunSeconds,
    maxItemsPerRun: declaration.maxItemsPerRun,
    tooLateAfterMinutes: declaration.tooLateAfterMinutes,
    deprecatedAt: null,
  };
}
