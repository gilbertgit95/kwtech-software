import type { JobEnqueueRefusal } from '../types.js';

/**
 * The queue's decisions (JOBS-PLAN §4b), as pure functions: what may be queued,
 * what is due, and how long a running row is believed.
 */

/** How many runs may be under way at once, across every server, when the host says nothing. */
export const JOBS_MAX_CONCURRENT_RUNS = 2;

/** Seconds between the runner's wake-ups. Schedules are accurate to minutes, so this is under one. */
export const JOBS_TICK_SECONDS = 30;

/**
 * Seconds. The longest any process may declare for one run, when the host says
 * nothing: with two at a time, this bounds how long a slow process can delay
 * the ones behind it.
 */
export const JOBS_MAX_RUN_SECONDS_CEILING = 300;

/**
 * Seconds a lease outlasts its run's time limit. The runner stops a run AT the
 * limit; the lease is for a server that died and stops nothing, so it must
 * lapse only after a live server would certainly have finished.
 */
export const JOBS_LEASE_GRACE_SECONDS = 30;

/** The one row of `job_queue_lock`. */
export const JOB_QUEUE_LOCK_ID = 'queue';

/** The longest error kept on a run. A stack trace is for the log, not the audit trail. */
export const JOB_RUN_ERROR_MAX = 500;

/**
 * Whether a process may be queued: a refusal, or null.
 *
 * ⚠ FAIL CLOSED. No row refuses, and `pausedAt` is tested for presence, never
 * compared: a value that is not exactly "not paused" is paused.
 */
export function checkEnqueue(
  process: { deprecatedAt: Date | null; pausedAt: unknown; activeRunId: string | null } | null,
): JobEnqueueRefusal | null {
  if (!process) return 'unknown_process';
  if (process.deprecatedAt !== null) return 'deprecated';
  if (process.pausedAt != null) return 'paused';
  if (process.activeRunId !== null) return 'already_queued';
  return null;
}

/**
 * Whether a schedule has come round: never queued, or last queued at least
 * `cadenceMinutes` ago. Measured from when it was last QUEUED, not finished, so
 * a slow run does not push the next one later and later.
 */
export function isRunDue(lastQueuedAt: Date | null, cadenceMinutes: number, now: Date): boolean {
  if (lastQueuedAt === null) return true;
  return now.getTime() - lastQueuedAt.getTime() >= cadenceMinutes * 60_000;
}

/** Until when a run started at `startedAt` is believed to be alive. */
export function runLeaseExpiry(startedAt: Date, maxRunSeconds: number): Date {
  return new Date(startedAt.getTime() + (maxRunSeconds + JOBS_LEASE_GRACE_SECONDS) * 1000);
}

/** A thrown value as the text kept on the run: its message, cut to `JOB_RUN_ERROR_MAX`. */
export function runErrorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const trimmed = text.trim() === '' ? 'It failed without saying why.' : text.trim();
  return trimmed.length > JOB_RUN_ERROR_MAX ? `${trimmed.slice(0, JOB_RUN_ERROR_MAX - 1)}…` : trimmed;
}

/** A count a process reported, made safe to store: a whole number, never negative. */
export function runCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
