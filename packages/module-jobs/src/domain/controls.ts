import type { JobControlRefusal, JobProcessStanding, JobRunState } from '../types.js';

/**
 * What an admin may do to a process, and how a process stands (JOBS-PLAN §7).
 *
 * Pure: the control service asks these inside its transaction, and the admin
 * page asks the same ones to say what a button would do before it is pressed.
 */

/** The longest reason kept on a pause. A sentence or two, not a report. */
export const JOB_PAUSE_REASON_MAX = 300;

/** A pause's reason, trimmed — or why it will not do. A pause without a reason is refused (JOBS-PLAN §7). */
export function preparePauseReason(
  reason: string | null | undefined,
): { reason: string } | { refused: Extract<JobControlRefusal, 'reason_required' | 'reason_too_long'> } {
  const trimmed = (reason ?? '').trim();
  if (trimmed === '') return { refused: 'reason_required' };
  if (trimmed.length > JOB_PAUSE_REASON_MAX) return { refused: 'reason_too_long' };
  return { reason: trimmed };
}

type ControlledProcess = { deprecatedAt: Date | null; pausedAt: unknown } | null;

/**
 * Whether a process may be paused: a refusal, or null.
 *
 * ⚠ `pausedAt` is tested for PRESENCE, as the queue tests it (`checkEnqueue`):
 * a value that is not exactly "not paused" is paused.
 */
export function checkPause(process: ControlledProcess): JobControlRefusal | null {
  if (!process) return 'unknown_process';
  if (process.deprecatedAt !== null) return 'deprecated';
  if (process.pausedAt != null) return 'already_paused';
  return null;
}

/**
 * Whether a process may be resumed: a refusal, or null.
 *
 * A RETIRED process may still be resumed. Resuming only clears the pause; it
 * does not run again either way, and leaving it "paused by Ana" for ever would
 * be a record nobody could tidy.
 */
export function checkResume(process: ControlledProcess): JobControlRefusal | null {
  if (!process) return 'unknown_process';
  if (process.pausedAt == null) return 'not_paused';
  return null;
}

/** Whether a process's schedule may be changed or reset: a refusal, or null. */
export function checkReschedule(process: ControlledProcess): JobControlRefusal | null {
  if (!process) return 'unknown_process';
  if (process.deprecatedAt !== null) return 'deprecated';
  return null;
}

/**
 * How a process stands, in ONE word, by precedence: what stops it is said
 * before what it is doing, and what it is doing before how it last went.
 *
 * ⚠ `failing` is judged on the last run that FINISHED ITS WORK: `skipped` and
 * `interrupted` say nothing about the process (it was paused, or the server
 * stopped), so neither starts nor ends a failure.
 */
export function processStanding(facts: {
  synced: boolean;
  pausedAt: unknown;
  /** The state of the run `activeRunId` names, or null when none is queued or under way. */
  activeRunState: JobRunState | null;
  /** The state of the last run that ended `succeeded` or `failed`, or null when none has. */
  lastOutcome: 'succeeded' | 'failed' | null;
}): JobProcessStanding {
  if (!facts.synced) return 'unsynced';
  if (facts.pausedAt != null) return 'paused';
  if (facts.activeRunState === 'running') return 'running';
  if (facts.activeRunState === 'queued') return 'queued';
  if (facts.lastOutcome === 'failed') return 'failing';
  return 'idle';
}

/**
 * When the runner next queues a process: now if it never has, otherwise one
 * cadence after it last did — the mirror of `isRunDue`.
 *
 * ⚠ For a `daily` schedule this is the next SWEEP, not the next time of day:
 * the process is swept every `minEveryMinutes` and takes the workspaces whose
 * time has come (`processCadenceMinutes`). The page calls it "next check", not
 * "next run", for that reason.
 */
export function nextCheckAt(lastQueuedAt: Date | null, cadenceMinutes: number, now: Date): Date {
  if (lastQueuedAt === null) return now;
  const due = new Date(lastQueuedAt.getTime() + cadenceMinutes * 60_000);
  return due.getTime() < now.getTime() ? now : due;
}

/**
 * Each refusal as the sentence an admin reads. Here, in the pure core, because
 * the page says the same sentence BEFORE the request (a pause with no reason)
 * that the server says after it — one wording, not two.
 *
 * `invalid_schedule` is the fallback only: the service passes the sentence
 * naming the limit that was broken (`scheduleRefusalMessage`).
 */
export function controlRefusalMessage(reason: JobControlRefusal): string {
  switch (reason) {
    case 'not_signed_in':
      return 'Not signed in';
    case 'unknown_process':
      return 'This application has no such background process.';
    case 'deprecated':
      return 'This process was retired: no module declares it any more, and it does not run.';
    case 'already_paused':
      return 'This process is already paused.';
    case 'not_paused':
      return 'This process is not paused.';
    case 'reason_required':
      return 'Say why you are pausing it — the reason is shown to whoever looks next.';
    case 'reason_too_long':
      return `Keep the reason to ${JOB_PAUSE_REASON_MAX} characters.`;
    case 'paused':
      return 'This process is paused. Resume it before running it.';
    case 'already_queued':
      return 'A run of this process is already queued or under way.';
    case 'invalid_schedule':
      return 'This process cannot run on that schedule.';
    case 'already_default':
      return 'This process is already on its default schedule.';
    case 'invalid_cursor':
      return 'That page of history could not be found. Open the history again.';
  }
}
