import {
  checkProcessSchedule,
  type ProcessSchedule,
  type ProcessScheduleKind,
  type ProcessScheduleLimits,
  parseProcessSchedule,
} from '@kwtech/module-kit';
import { describeMinutes, describeSchedule, scheduleRefusalMessage } from '../../domain/schedule.js';

/**
 * What the admin page SAYS, as pure functions: the page's components are thin,
 * and every sentence a person reads is decided — and tested — here.
 *
 * Structural inputs rather than the client's view types, so this file imports
 * no `'use client'` module and runs in a plain test.
 */

export type JobTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

interface ScheduleLike {
  kind: string;
  everyMinutes: number | null;
  times: readonly string[];
  weekdays: readonly number[];
}

interface RunLike {
  trigger: string;
  forcedByName: string | null;
  state: string;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  handled: number;
  skippedLate: number;
  leftForNext: number;
  note: string | null;
  error: string | null;
}

interface ProcessLike {
  module: string;
  standing: string;
  queuePosition: number | null;
  pausedByName: string | null;
  pauseReason: string | null;
  failingError: string | null;
}

interface ControlLike {
  action: string;
  actorName: string | null;
  reason: string | null;
  scheduleFrom: ScheduleLike | null;
  scheduleTo: ScheduleLike | null;
}

/** Who did it, or the words for "nobody can say": the directory is unbound, or the account is gone. */
export function actorLabel(name: string | null): string {
  return name ?? 'An administrator';
}

// ── grouping ────────────────────────────────────────────────────────────────

/** "task" → "Task", "basic_pos" → "Basic pos". The app may give better names (`moduleLabels`). */
export function moduleLabel(module: string, labels: Readonly<Record<string, string>> = {}): string {
  const given = labels[module];
  if (given) return given;
  const words = module.replace(/[_-]+/gu, ' ').trim();
  return words === '' ? 'Other' : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** The processes under their module's heading, headings in alphabetical order, each group as the server ordered it. */
export function groupByModule<T extends { module: string }>(
  processes: readonly T[],
  labels: Readonly<Record<string, string>> = {},
): Array<{ module: string; label: string; processes: T[] }> {
  const groups = new Map<string, T[]>();
  for (const process of processes) {
    groups.set(process.module, [...(groups.get(process.module) ?? []), process]);
  }
  return [...groups.entries()]
    .map(([module, members]) => ({ module, label: moduleLabel(module, labels), processes: members }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ── how a process stands ────────────────────────────────────────────────────

/** The chip beside a process's name. An unknown standing is said as it came, never dressed as fine. */
export function standingChip(standing: string): { label: string; tone: JobTone } {
  switch (standing) {
    case 'idle':
      // Nothing is wrong and nothing is happening: it is waiting for its schedule.
      return { label: 'On schedule', tone: 'success' };
    case 'queued':
      return { label: 'Queued', tone: 'info' };
    case 'running':
      return { label: 'Running', tone: 'info' };
    case 'paused':
      return { label: 'Paused', tone: 'warning' };
    case 'failing':
      return { label: 'Failing', tone: 'danger' };
    case 'unsynced':
      return { label: 'Not synced', tone: 'warning' };
    default:
      return { label: standing, tone: 'warning' };
  }
}

/**
 * The numbers at the top of the page: how many processes there are, and how
 * many are in each state somebody might need to act on.
 *
 * `active` is queued and running together: both mean "a run of it exists now".
 */
export function summarizeProcesses(processes: ReadonlyArray<{ standing: string }>): {
  total: number;
  active: number;
  paused: number;
  failing: number;
} {
  const count = (...standings: string[]) => processes.filter((process) => standings.includes(process.standing)).length;
  return {
    total: processes.length,
    active: count('queued', 'running'),
    paused: count('paused'),
    failing: count('failing'),
  };
}

const ORDINALS = ['Next', 'Second', 'Third', 'Fourth', 'Fifth'] as const;

/** "Next in the queue", "Second in the queue", "Number 7 in the queue". */
export function queuePositionText(position: number): string {
  const word = ORDINALS[position - 1];
  return word ? `${word} in the queue` : `Number ${position} in the queue`;
}

/**
 * The sentence under a process's name when it is not simply waiting: what
 * stops it or what it is doing, and why. Null when there is nothing to add.
 */
export function standingDetail(process: ProcessLike): string | null {
  switch (process.standing) {
    case 'paused':
      return `Paused by ${actorLabel(process.pausedByName).replace(/^An /u, 'an ')}${
        process.pauseReason ? ` — ${process.pauseReason}` : ''
      }`;
    case 'queued':
      return process.queuePosition === null ? 'Waiting its turn' : queuePositionText(process.queuePosition);
    case 'running':
      return 'A run is under way';
    case 'failing':
      return process.failingError ? `Its last run failed: ${process.failingError}` : 'Its last run failed.';
    case 'unsynced':
      return 'Declared in code but not synced, so it cannot run. Run db:sync on the server.';
    default:
      return null;
  }
}

/**
 * A string that changes whenever a process's HISTORY has: a run queued, started
 * or finished, a pause or a resume, a schedule set or reset. The page re-reads
 * the open history when it does, and not otherwise.
 */
export function historySignature(process: {
  activeRun: { id: string; state: string } | null;
  lastRun: { id: string } | null;
  pausedAt: string | null;
  scheduleSetAt: string | null;
}): string {
  return [
    process.activeRun ? `${process.activeRun.id}:${process.activeRun.state}` : '',
    process.lastRun?.id ?? '',
    process.pausedAt ?? '',
    process.scheduleSetAt ?? '',
  ].join('|');
}

// ── schedules ───────────────────────────────────────────────────────────────

/** The wire shape back to a `ProcessSchedule`, or null when it is not one. */
export function scheduleOf(view: ScheduleLike): ProcessSchedule | null {
  return parseProcessSchedule(
    view.kind === 'interval'
      ? { kind: 'interval', everyMinutes: view.everyMinutes }
      : { kind: view.kind, times: [...view.times], weekdays: [...view.weekdays] },
  );
}

/** A schedule from the API as a sentence: "Every 15 minutes", "At 08:00 every day". */
export function scheduleText(view: ScheduleLike): string {
  const schedule = scheduleOf(view);
  return schedule ? describeSchedule(schedule) : 'An unreadable schedule';
}

/**
 * What a schedule means for when things actually happen — the part the
 * sentence alone leaves out. ⚠ A time of day is EACH WORKSPACE'S OWN (D6).
 */
export function scheduleNote(view: ScheduleLike, minEveryMinutes: number): string {
  if (view.kind !== 'daily') return 'Everywhere at once.';
  return `In each workspace’s own time zone. Checked every ${describeMinutes(minEveryMinutes)}, so a time is met within that long.`;
}

/** The schedule form's state: text as typed, so a half-typed number is not yet a refusal. */
export interface ScheduleDraft {
  kind: ProcessScheduleKind;
  everyMinutes: string;
  times: string[];
  weekdays: number[];
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/** The form opened on a schedule. The fields of the kind NOT in force start from sensible values, not blank. */
export function scheduleDraftOf(view: ScheduleLike, minEveryMinutes: number): ScheduleDraft {
  return {
    kind: view.kind === 'daily' ? 'daily' : 'interval',
    everyMinutes: String(view.everyMinutes ?? Math.max(minEveryMinutes, 60)),
    times: view.times.length > 0 ? [...view.times] : ['08:00'],
    weekdays: view.kind === 'daily' ? [...view.weekdays] : EVERY_DAY,
  };
}

/** The schedule a draft asks for. Shape only: `checkScheduleDraft` judges it. */
export function scheduleOfDraft(draft: ScheduleDraft): ProcessSchedule {
  if (draft.kind === 'interval') {
    const everyMinutes = /^\d+$/u.test(draft.everyMinutes.trim()) ? Number(draft.everyMinutes.trim()) : Number.NaN;
    return { kind: 'interval', everyMinutes };
  }
  return { kind: 'daily', times: draft.times.filter((time) => time !== ''), weekdays: [...draft.weekdays] };
}

/**
 * What is wrong with a draft, in the server's own sentence — or null.
 *
 * ⚠ THE SAME VALIDATOR THE SERVER RUNS (`checkProcessSchedule`), and the same
 * wording (`scheduleRefusalMessage`): the form refuses before the request
 * exactly what the API would refuse after it.
 */
export function checkScheduleDraft(draft: ScheduleDraft, limits: ProcessScheduleLimits): string | null {
  const refusal = checkProcessSchedule(scheduleOfDraft(draft), limits);
  return refusal ? scheduleRefusalMessage(refusal, limits) : null;
}

// ── runs and control actions ────────────────────────────────────────────────

export function runStateChip(state: string): { label: string; tone: JobTone } {
  switch (state) {
    case 'queued':
      return { label: 'Queued', tone: 'info' };
    case 'running':
      return { label: 'Running', tone: 'info' };
    case 'succeeded':
      return { label: 'Succeeded', tone: 'success' };
    case 'failed':
      return { label: 'Failed', tone: 'danger' };
    case 'skipped':
      return { label: 'Skipped', tone: 'neutral' };
    case 'interrupted':
      return { label: 'Interrupted', tone: 'warning' };
    default:
      return { label: state, tone: 'warning' };
  }
}

/** "Scheduled run", "Run forced by Ana Cruz". */
export function runTitle(run: Pick<RunLike, 'trigger' | 'forcedByName'>): string {
  if (run.trigger !== 'forced') return 'Scheduled run';
  return `Run forced by ${actorLabel(run.forcedByName).replace(/^An /u, 'an ')}`;
}

/**
 * What a run did, in one line. ⚠ Counts, never names (JOBS-PLAN D5).
 *
 * A failure or a skip says why instead: the counts of a run that did not
 * finish its work are not what the reader came for.
 */
export function runSummary(run: RunLike): string {
  switch (run.state) {
    case 'queued':
      return 'Waiting its turn.';
    case 'running':
      return 'Under way.';
    case 'failed':
    case 'interrupted':
      return run.error ?? 'It did not finish, and did not say why.';
    case 'skipped':
      return run.note ?? 'It was skipped.';
    default:
      return countsText(run);
  }
}

function countsText(run: Pick<RunLike, 'handled' | 'skippedLate' | 'leftForNext'>): string {
  const parts = [`${run.handled} handled`];
  if (run.skippedLate > 0) parts.push(`${run.skippedLate} skipped as too late`);
  if (run.leftForNext > 0) parts.push(`${run.leftForNext} left for the next run`);
  return run.handled === 0 && parts.length === 1 ? 'Nothing was due.' : `${parts.join(', ')}.`;
}

/** How long a run took: "under a second", "12 seconds", "2 minutes". Null until it has both ends. */
export function runDurationText(run: Pick<RunLike, 'startedAt' | 'finishedAt'>): string | null {
  if (!run.startedAt || !run.finishedAt) return null;
  const seconds = Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 1) return 'under a second';
  if (seconds < 90) return seconds === 1 ? '1 second' : `${seconds} seconds`;
  return describeMinutes(Math.round(seconds / 60));
}

/** A control action as a sentence: who did what, and for a pause, why. */
export function controlSummary(control: ControlLike): string {
  const who = actorLabel(control.actorName);
  switch (control.action) {
    case 'paused':
      return `${who} paused it${control.reason ? ` — ${control.reason}` : '.'}`;
    case 'resumed':
      return `${who} resumed it.`;
    case 'forced':
      return `${who} asked for a run now.`;
    case 'rescheduled':
      return `${who} changed the schedule${scheduleChangeText(control)}.`;
    case 'reset_schedule':
      return `${who} reset the schedule to its default${scheduleChangeText(control)}.`;
    default:
      return `${who}: ${control.action}.`;
  }
}

function scheduleChangeText(control: Pick<ControlLike, 'scheduleFrom' | 'scheduleTo'>): string {
  if (!control.scheduleFrom || !control.scheduleTo) return '';
  return `, from “${scheduleText(control.scheduleFrom)}” to “${scheduleText(control.scheduleTo)}”`;
}

// ── times ───────────────────────────────────────────────────────────────────

/**
 * An instant for the page, in the VIEWER's own zone.
 *
 * ⚠ Not a workspace's: this is an app-level screen outside any workspace, where
 * the viewer's zone is the right one (typescript rules, "Days, times and time
 * zones"). `timeZone` is a parameter so a test can pin it.
 */
export function whenText(iso: string | null, timeZone?: string): string {
  if (!iso) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  return at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) });
}

/**
 * How long ago an instant was, for a glance: "just now", "5 minutes ago", "2
 * hours ago", "3 days ago". The exact time is shown beside it, never instead.
 */
export function agoText(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const minutes = Math.floor((now.getTime() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes)) return null;
  // A clock a little ahead of the server's must not say "in the future".
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${describeMinutes(minutes)} ago`;
  if (minutes < 24 * 60) return `${describeMinutes(Math.floor(minutes / 60) * 60)} ago`;
  return `${describeMinutes(Math.floor(minutes / (24 * 60)) * 24 * 60)} ago`;
}

/** "now", "in 4 minutes", "in 2 hours" — how long until the runner next looks at a process. */
export function untilText(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const minutes = Math.ceil((Date.parse(iso) - now.getTime()) / 60_000);
  if (!Number.isFinite(minutes)) return null;
  return minutes <= 0 ? 'now' : `in ${describeMinutes(minutes)}`;
}
