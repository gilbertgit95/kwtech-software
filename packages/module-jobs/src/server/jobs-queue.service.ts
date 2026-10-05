import { randomUUID } from 'node:crypto';
import { effectiveProcessSchedule, type ProcessContribution, processCadenceMinutes } from '@kwtech/module-kit';
import { Inject, Injectable } from '@nestjs/common';
import { checkEnqueue, isRunDue, JOB_QUEUE_LOCK_ID, runLeaseExpiry } from '../domain/queue.js';
import type { JobEnqueueRefusal, JobRunOutcome, JobRunTrigger } from '../types.js';
import type { ResolvedJobsOptions } from './jobs.options.js';
import type { JobProcessRow, JobRunRow, JobsTransaction, JobsWriteClient } from './jobs.repository.js';
import { JOBS_OPTIONS, JOBS_PRISMA_WRITE } from './jobs.tokens.js';

/** What taking the head of the queue came to. */
export type JobClaim =
  /** Nothing queued, the limit on runs at once is reached, or the queue was never synced. */
  | { kind: 'none' }
  /** The head could not run (paused, retired, not in this build) and was recorded as skipped. Ask again. */
  | { kind: 'skipped' }
  | { kind: 'claimed'; run: JobRunRow; process: JobProcessRow; declaration: ProcessContribution };

/** How a claimed run ended, as it is written on its row. */
export interface JobRunSettlement {
  state: JobRunOutcome;
  handled?: number;
  skippedLate?: number;
  leftForNext?: number;
  note?: string;
  error?: string;
}

/**
 * THE QUEUE (JOBS-PLAN §4b): a table in Postgres, so the backlog is in the same
 * audit trail as everything else and there is nothing new to operate.
 *
 * Three promises, each kept by the DATABASE rather than by this process, so
 * they hold when the server runs as several instances:
 *
 *   - a process is queued AT MOST ONCE — a compare-and-set on
 *     `job_process.activeRunId`;
 *   - AT MOST N RUN AT ONCE — every claim first takes the queue lock's row, so
 *     "how many are running" is counted by one server at a time;
 *   - NOTHING WAITS ON A DEAD SERVER — a running row is believed only until
 *     its lease, and `reapLapsed` lets it go.
 *
 * ⚠ Every method takes `now`. This class never reads the clock.
 */
@Injectable()
export class JobsQueueService {
  private readonly declarations: ReadonlyMap<string, ProcessContribution>;

  constructor(
    @Inject(JOBS_PRISMA_WRITE) private readonly prisma: JobsWriteClient,
    @Inject(JOBS_OPTIONS) private readonly options: ResolvedJobsOptions,
  ) {
    if (!prisma) {
      throw new Error(
        'JobsQueueService needs a client. Bind JOBS_PRISMA_WRITE via prismaWriteProvider in jobsServerModule.',
      );
    }
    this.declarations = new Map(options.processes.map((process) => [process.key, process]));
  }

  /**
   * Adds a run to the back of the queue, unless one of this process is already
   * queued or under way.
   *
   * ⚠ The claim on the process and the run's row are ONE transaction: a run
   * row with no claim would run beside another, and a claim with no row would
   * lock the process for ever.
   */
  async enqueue(
    processKey: string,
    trigger: JobRunTrigger,
    now: Date,
    forcedById: string | null = null,
  ): Promise<{ run: JobRunRow } | { refused: JobEnqueueRefusal }> {
    const id = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const taken = await tx.jobProcess.updateMany({
        where: { key: processKey, activeRunId: null, deprecatedAt: null, pausedAt: null },
        data: { activeRunId: id, lastQueuedAt: now },
      });
      if (taken.count === 0) {
        // Read only to say WHY. The compare-and-set above already decided.
        const process = await tx.jobProcess.findUnique({ where: { key: processKey } });
        return { refused: checkEnqueue(process) ?? 'already_queued' };
      }
      const run = await tx.jobRun.create({
        data: { id, processKey, trigger, forcedById, state: 'queued', queuedAt: now },
      });
      return { run };
    });
  }

  /**
   * Queues every process whose schedule has come round. Returns the keys it
   * queued, and the keys this build declares that have NO ROW — never synced,
   * so they cannot run, and the caller says so.
   *
   * ⚠ The schedule is read from the CODE's declaration with the row's override
   * applied (`effectiveProcessSchedule`): a row is not a way to run a process
   * more often than it declared it can bear.
   */
  async enqueueDue(now: Date): Promise<{ queued: readonly string[]; unsynced: readonly string[] }> {
    const rows = await this.prisma.jobProcess.findMany({ where: { deprecatedAt: null }, orderBy: [{ key: 'asc' }] });
    const byKey = new Map(rows.map((row) => [row.key, row]));
    const queued: string[] = [];
    const unsynced: string[] = [];

    // One at a time, in key order: each is its own small transaction, and a
    // stable order is what makes "first in, first out" mean something when
    // several come due on one tick.
    for (const declaration of this.declarations.values()) {
      const row = byKey.get(declaration.key);
      if (!row) {
        unsynced.push(declaration.key);
        continue;
      }
      if (checkEnqueue(row) !== null) continue;
      const { schedule } = effectiveProcessSchedule(declaration, row.schedule);
      if (!isRunDue(row.lastQueuedAt, processCadenceMinutes(schedule, declaration.scheduleLimits), now)) continue;
      const result = await this.enqueue(declaration.key, 'scheduled', now);
      if ('run' in result) queued.push(declaration.key);
    }
    return { queued, unsynced };
  }

  /**
   * Takes the oldest queued run, if a slot is free.
   *
   * ⚠ THE LOCK ROW IS UPDATED FIRST, so two servers claiming at once wait on
   * each other and the second counts what the first committed. Without it both
   * would count one running, both would start one, and the limit would be per
   * server — which is not a limit.
   *
   * A run whose process was paused or retired after it was queued, or that
   * this build does not declare, is recorded as `skipped` here and never
   * started: fail closed, and say why on the row.
   */
  async claimNext(now: Date): Promise<JobClaim> {
    return this.prisma.$transaction(async (tx): Promise<JobClaim> => {
      const locked = await tx.jobQueueLock.updateMany({ where: { id: JOB_QUEUE_LOCK_ID }, data: { touchedAt: now } });
      if (locked.count === 0) return { kind: 'none' };

      const running = await tx.jobRun.count({ where: { state: 'running' } });
      if (running >= this.options.maxConcurrentRuns) return { kind: 'none' };

      // First in, first out. Runs queued by one wake-up share an instant, so the
      // process key breaks the tie: the order is then the same on every server.
      const [run] = await tx.jobRun.findMany({
        where: { state: 'queued' },
        orderBy: [{ queuedAt: 'asc' }, { processKey: 'asc' }, { id: 'asc' }],
        take: 1,
      });
      if (!run) return { kind: 'none' };

      const process = await tx.jobProcess.findUnique({ where: { key: run.processKey } });
      const declaration = this.declarations.get(run.processKey);
      const blocked = whyNotStarted(process, declaration);
      if (blocked !== null || !process || !declaration) {
        await settle(tx, run.id, 'queued', { state: 'skipped', note: blocked ?? NOT_IN_THIS_BUILD }, now);
        return { kind: 'skipped' };
      }

      const started = await tx.jobRun.updateMany({
        where: { id: run.id, state: 'queued' },
        data: { state: 'running', startedAt: now, leaseExpiresAt: runLeaseExpiry(now, declaration.maxRunSeconds) },
      });
      if (started.count === 0) return { kind: 'none' };
      return { kind: 'claimed', run: { ...run, state: 'running', startedAt: now }, process, declaration };
    });
  }

  /**
   * Writes how a claimed run ended, and frees its process for the next.
   *
   * False when the run was no longer `running` — its lease lapsed and it was
   * already let go as `interrupted`. The late result is dropped, not written
   * over the record of what the system actually believed.
   */
  async finish(runId: string, settlement: JobRunSettlement, now: Date): Promise<boolean> {
    return this.prisma.$transaction((tx) => settle(tx, runId, 'running', settlement, now));
  }

  /**
   * Lets go of runs whose server died: `running` past their lease. Marked
   * `interrupted`, and their process freed. Returns how many.
   *
   * Nothing is lost by it: a process sweeps and is idempotent, so the next run
   * simply does what this one did not.
   */
  async reapLapsed(now: Date): Promise<number> {
    const lapsed = await this.prisma.jobRun.findMany({
      where: { state: 'running', leaseExpiresAt: { lt: now } },
      orderBy: [{ queuedAt: 'asc' }, { processKey: 'asc' }, { id: 'asc' }],
      take: REAP_BATCH,
    });
    let reaped = 0;
    // One transaction each, so one that another server already settled does not undo the rest.
    for (const run of lapsed) {
      const done = await this.prisma.$transaction((tx) =>
        settle(tx, run.id, 'running', { state: 'interrupted', error: INTERRUPTED }, now),
      );
      if (done) reaped += 1;
    }
    return reaped;
  }
}

/** How many lapsed runs one wake-up lets go of. There are at most a few: the limit on runs at once. */
const REAP_BATCH = 20;

const NOT_IN_THIS_BUILD = 'This server does not have the process: it was queued by a build that did.';
const INTERRUPTED = 'The server running it stopped before it finished. The next run picks up what it left.';

/** Why a queued run must not start, in words for its row — or null. */
function whyNotStarted(process: JobProcessRow | null, declaration: ProcessContribution | undefined): string | null {
  if (!process) return 'Its process has no row any more.';
  if (process.deprecatedAt !== null) return 'The process was retired after this run was queued.';
  if (process.pausedAt != null) return 'The process was paused after this run was queued.';
  if (!declaration) return NOT_IN_THIS_BUILD;
  return null;
}

/**
 * Ends a run and frees its process, in the caller's transaction.
 *
 * ⚠ Conditional on the state the caller believed, and the process is freed
 * only when the run's row actually moved AND the process still names this run.
 */
async function settle(
  tx: JobsTransaction,
  runId: string,
  from: 'queued' | 'running',
  settlement: Omit<JobRunSettlement, 'state'> & { state: JobRunOutcome | 'interrupted' },
  now: Date,
): Promise<boolean> {
  const moved = await tx.jobRun.updateMany({
    where: { id: runId, state: from },
    data: {
      state: settlement.state,
      finishedAt: now,
      leaseExpiresAt: null,
      handled: settlement.handled ?? 0,
      skippedLate: settlement.skippedLate ?? 0,
      leftForNext: settlement.leftForNext ?? 0,
      note: settlement.note ?? null,
      error: settlement.error ?? null,
    },
  });
  if (moved.count === 0) return false;
  await tx.jobProcess.updateMany({ where: { activeRunId: runId }, data: { activeRunId: null } });
  return true;
}
