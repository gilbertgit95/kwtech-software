/**
 * The vocabulary of a run. Mirrors `JobRunState` and `JobRunTrigger` in
 * prisma/jobs.prisma; string unions, never enums.
 */

/** `queued` and `running` are the queue; the rest are history, never edited. */
export type JobRunState = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'interrupted';

export type JobRunTrigger = 'scheduled' | 'forced';

/** How a run that was claimed ends. `interrupted` is not here: the reaper writes it, never the runner. */
export type JobRunOutcome = 'succeeded' | 'failed' | 'skipped';

/**
 * Why a process was not queued.
 *
 *   unknown_process — no row: never synced, or never declared.
 *   deprecated      — no build declares it any more.
 *   paused          — an admin paused it.
 *   already_queued  — a run of it is queued or under way (JOBS-PLAN D2).
 */
export type JobEnqueueRefusal = 'unknown_process' | 'deprecated' | 'paused' | 'already_queued';
