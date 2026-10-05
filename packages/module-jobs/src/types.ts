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

/** What an admin did to a process. Mirrors `JobControlAction` in prisma/jobs.prisma. */
export type JobControlAction = 'paused' | 'resumed' | 'forced' | 'rescheduled' | 'reset_schedule';

/**
 * How a process stands, as the admin page says it. One answer, in this order
 * of precedence — see `processStanding`.
 *
 *   unsynced — declared in code, no row yet: it cannot run until `db:sync`.
 *   paused   — an admin paused it.
 *   running  — a run of it is under way.
 *   queued   — a run of it is waiting its turn.
 *   failing  — its last finished run failed.
 *   idle     — waiting for its schedule to come round.
 */
export type JobProcessStanding = 'unsynced' | 'paused' | 'running' | 'queued' | 'failing' | 'idle';

/**
 * Why a control action was refused. Each is said to the admin in a sentence
 * (`jobs.errors.ts`); the schedule ones name the limit that was broken.
 *
 *   not_signed_in    — nobody is behind the request.
 *   unknown_process  — no such process in this application.
 *   deprecated       — no build declares it any more.
 *   already_paused / not_paused — the state the action needs is not the state it is in.
 *   reason_required / reason_too_long — a pause says why, briefly.
 *   paused / already_queued — Run now, on a paused process or one with a run under way (D2).
 *   invalid_schedule — the schedule is outside what the process declares it can bear.
 *   already_default  — Reset to default, with no schedule of an admin's in force.
 *   invalid_cursor   — a history cursor this server did not issue.
 */
export type JobControlRefusal =
  | 'not_signed_in'
  | 'unknown_process'
  | 'deprecated'
  | 'already_paused'
  | 'not_paused'
  | 'reason_required'
  | 'reason_too_long'
  | 'paused'
  | 'already_queued'
  | 'invalid_schedule'
  | 'already_default'
  | 'invalid_cursor';
