import { ModuleCompositionError } from './compose.js';
import { zonedDayKey, zonedMinuteOfDay, zonedWeekday } from './time-zone.js';

/**
 * BACKGROUND PROCESSES — work a module does on a schedule rather than on a
 * request: "remind people of what is due today", "let a stale request lapse".
 *
 * A module DECLARES a process, as it declares a feature key, and a runner it
 * has never heard of runs it (`docs/JOBS-PLAN.md`). The declaration is here
 * rather than in the runner's package for the reason `FeatureContribution` is
 * here rather than in the enforcer's: every module declares them and only one
 * module runs them, and a module may import nothing but this package.
 *
 * ⚠ THE DEVELOPER OF A PROCESS ANSWERS FOR ITS DESIGN (JOBS-PLAN §4c). The
 * runner is shared by every module, so a process:
 *
 *   - SWEEPS, and never sets a timer per item — a sweep survives a restart;
 *   - is IDEMPOTENT — it records what it did in its own module's tables, so a
 *     second run tells nobody twice;
 *   - works in BATCHES, inside `maxItems`, and stops when `signal` aborts;
 *   - assumes NOTHING ABOUT WHEN it runs — late, paused or twice in a row.
 *
 * The runner enforces the time limit, one run at a time, and that the limits
 * below were declared. It cannot see whether a process is idempotent: that is
 * shown by the module's own tests.
 */

export type ProcessScheduleKind = 'interval' | 'daily';

/**
 * WHEN a process runs. Two kinds, and an admin may change one for the other
 * inside the limits the module declares.
 *
 *   interval — every N minutes, everywhere at once.
 *   daily    — at set times of day on chosen weekdays, ⚠ in EACH WORKSPACE'S
 *              OWN time (JOBS-PLAN D6): "at 8:00" reaches a workspace at its
 *              8:00. `times` are `HH:MM`; `weekdays` are 0 (Sunday) to 6.
 *
 * Plain data, because it is stored: the admin's schedule is a JSON column.
 */
export type ProcessSchedule =
  | { kind: 'interval'; everyMinutes: number }
  | { kind: 'daily'; times: readonly string[]; weekdays: readonly number[] };

/** What an admin may change a schedule within. Declared by the module, in code. */
export interface ProcessScheduleLimits {
  /** The kinds that make sense for this process. A reminder "every 5 minutes" may not. */
  kinds: readonly ProcessScheduleKind[];
  /**
   * The shortest interval the process can bear, in minutes. ⚠ Also how often a
   * `daily` schedule is swept: a workspace's 8:00 is noticed within this many
   * minutes of it, so it is the accuracy of a time of day as well as a floor.
   */
  minEveryMinutes: number;
}

/**
 * One process, as DATA: everything about it except the code that runs.
 *
 * Split from `ProcessContribution` because two readers want it without the
 * handler — the seed task that mirrors it to the database, and the admin
 * screen — and neither can construct a Nest module to get it.
 *
 * ⚠ EVERY LIMIT IS REQUIRED. `composeProcesses` throws on a declaration that
 * leaves one out, so a process cannot join the shared queue with its cost
 * unsaid (JOBS-PLAN D11).
 */
export interface ProcessDeclaration {
  /** `<module>.<what>` in snake_case: `task.due_today`. Composition throws on a duplicate. */
  key: string;
  /** The module key, so the admin screen can group by it. */
  module: string;
  label: string;
  /** What it does, in plain words, for the person deciding whether to pause it. */
  description: string;
  /**
   * The feature of this module the process SERVES, so it reaches only the
   * workspaces of organizations whose plan includes it (JOBS-PLAN D12).
   *
   * ⚠ `null` must be WRITTEN, never implied: it means the process serves no
   * workspace at all (the runner's own history clean-up) and is handed none.
   */
  serves: string | null;
  /** What runs until an admin changes it, and what "Reset to default" returns to. */
  defaultSchedule: ProcessSchedule;
  scheduleLimits: ProcessScheduleLimits;
  /** The longest one run may take, in seconds. Past it the run is stopped and marked failed. */
  maxRunSeconds: number;
  /** How many items one run handles at most; the rest are left for the next. */
  maxItemsPerRun: number;
  /**
   * How late is too late, in minutes. After a pause or an outage a sweep finds
   * everything it missed, and a reminder that far past its time is worse than
   * none: the item is skipped, and counted.
   */
  tooLateAfterMinutes: number;
}

/**
 * A declaration plus the code that runs it.
 *
 * ⚠ `handler` is an INJECTION TOKEN — the module's own `@Injectable()` class
 * implementing `ProcessHandler` — typed loosely so this package never imports
 * Nest, as `ServerModuleDescriptor.nestModule` is. The runner resolves it from
 * the container; a module's process therefore has its module's services.
 */
export interface ProcessContribution extends ProcessDeclaration {
  handler: unknown;
}

/** A workspace a run may work in, with the zone its days and times follow. */
export interface ProcessWorkspace {
  organizationId: string;
  workspaceId: string;
  timeZone: string;
}

export interface ProcessWorkspacePage {
  workspaces: readonly ProcessWorkspace[];
  /** Pass back for the next page. Null: that was the last. */
  nextCursor: string | null;
}

/** What one run is handed. Everything it may assume about when and where it runs. */
export interface ProcessRunContext {
  /** ⚠ The run's one clock. Never read the machine's inside a process. */
  now: Date;
  /** The schedule in force: the admin's, or the declared default. */
  schedule: ProcessSchedule;
  /** The declaration's `maxItemsPerRun`. */
  maxItems: number;
  /** The declaration's `tooLateAfterMinutes`. */
  tooLateAfterMinutes: number;
  /** Aborts at the time limit, and when the server stops. Check it between batches. */
  signal: AbortSignal;
  /**
   * The workspaces of organizations whose plan includes the feature this
   * process serves, a page at a time — never all of them in memory.
   *
   * ⚠ ENTITLEMENT, NOT GRANTS: a run is the app acting, not a person. Empty for
   * a process that serves nothing.
   */
  workspaces(cursor: string | null, limit: number): Promise<ProcessWorkspacePage>;
}

/**
 * What a run did — ⚠ COUNTS, NEVER NAMES (JOBS-PLAN D5): app-level staff read
 * these across every organization.
 */
export interface ProcessRunResult {
  handled: number;
  /** Skipped as past `tooLateAfterMinutes`. */
  skippedLate: number;
  /** Seen and left for the next run, because `maxItems` was reached. */
  leftForNext: number;
}

export interface ProcessHandler {
  run(context: ProcessRunContext): Promise<ProcessRunResult>;
}

/** Why a schedule is refused. Each is said to the admin with the limit it broke. */
export type ProcessScheduleRefusal =
  | 'malformed'
  | 'kind_not_allowed'
  | 'interval_too_short'
  | 'no_times'
  | 'invalid_time'
  | 'no_weekdays'
  | 'invalid_weekday';

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/u;
const PROCESS_KEY = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/u;

/** A day is 1440 minutes; an interval longer than a week is a mistake, not a schedule. */
const MAX_EVERY_MINUTES = 7 * 24 * 60;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

/**
 * A schedule as it comes back from a JSON column or over the wire, narrowed —
 * or null when it is not one. Shape only: `checkProcessSchedule` judges it
 * against a process's limits.
 */
export function parseProcessSchedule(raw: unknown): ProcessSchedule | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as { kind?: unknown; everyMinutes?: unknown; times?: unknown; weekdays?: unknown };

  if (candidate.kind === 'interval') {
    return isPositiveInteger(candidate.everyMinutes)
      ? { kind: 'interval', everyMinutes: candidate.everyMinutes }
      : null;
  }
  if (candidate.kind !== 'daily') return null;
  if (!Array.isArray(candidate.times) || !Array.isArray(candidate.weekdays)) return null;
  if (!candidate.times.every((time) => typeof time === 'string')) return null;
  if (!candidate.weekdays.every((weekday) => typeof weekday === 'number')) return null;
  return { kind: 'daily', times: candidate.times as string[], weekdays: candidate.weekdays as number[] };
}

/** Whether a process may run on `schedule`: a refusal reason, or null. */
export function checkProcessSchedule(
  schedule: ProcessSchedule,
  limits: ProcessScheduleLimits,
): ProcessScheduleRefusal | null {
  if (!limits.kinds.includes(schedule.kind)) return 'kind_not_allowed';

  switch (schedule.kind) {
    case 'interval': {
      if (!isPositiveInteger(schedule.everyMinutes) || schedule.everyMinutes > MAX_EVERY_MINUTES) return 'malformed';
      return schedule.everyMinutes < limits.minEveryMinutes ? 'interval_too_short' : null;
    }
    case 'daily': {
      if (schedule.times.length === 0) return 'no_times';
      if (!schedule.times.every((time) => TIME_OF_DAY.test(time))) return 'invalid_time';
      if (schedule.weekdays.length === 0) return 'no_weekdays';
      const valid = schedule.weekdays.every((weekday) => Number.isInteger(weekday) && weekday >= 0 && weekday <= 6);
      return valid ? null : 'invalid_weekday';
    }
  }
}

/**
 * The schedule in force: the admin's, when it still fits the declared limits,
 * otherwise the default.
 *
 * ⚠ AN OVERRIDE THE DECLARATION NO LONGER ALLOWS IS IGNORED, not honoured and
 * not an error: a release may tighten a process's limits, and a row written
 * under the old ones must not keep it running faster than it can now bear.
 * `overrideIgnored` is there so the admin screen can say so.
 */
export function effectiveProcessSchedule(
  declaration: Pick<ProcessDeclaration, 'defaultSchedule' | 'scheduleLimits'>,
  override: unknown,
): { schedule: ProcessSchedule; overrideIgnored: boolean } {
  if (override == null) return { schedule: declaration.defaultSchedule, overrideIgnored: false };
  const parsed = parseProcessSchedule(override);
  if (!parsed || checkProcessSchedule(parsed, declaration.scheduleLimits) !== null) {
    return { schedule: declaration.defaultSchedule, overrideIgnored: true };
  }
  return { schedule: parsed, overrideIgnored: false };
}

/**
 * How often the runner starts a run, in minutes.
 *
 * ⚠ A `daily` schedule is NOT run once a day. Its time is each workspace's own,
 * and no single instant is 8:00 everywhere, so the process is swept every
 * `minEveryMinutes` and takes the workspaces whose time has come
 * (`processOccurrence`). The schedule is a floor on how often, not a promise
 * of when.
 */
export function processCadenceMinutes(schedule: ProcessSchedule, limits: ProcessScheduleLimits): number {
  return schedule.kind === 'interval' ? schedule.everyMinutes : limits.minEveryMinutes;
}

/**
 * Whether a process's time has come in ONE workspace, and for which day.
 *
 *   none     — not yet today, or not a chosen weekday. Do nothing.
 *   due      — do the work for `dayKey`.
 *   too_late — its time today passed more than `tooLateAfterMinutes` ago: skip
 *              what is still undone, and count it.
 *
 * `dayKey` is the WORKSPACE's day, and what a process keys its "already done"
 * record on, so the answer staying `due` for hours tells nobody twice.
 *
 * An `interval` schedule is always `due`, for the workspace's today: how often
 * is then the runner's business alone.
 *
 * ⚠ An occurrence does not carry past its workspace's midnight. A 23:50
 * reminder still unsent at 00:10 is yesterday's, and is not sent: a "due today"
 * notice arriving the day after would be wrong, not late.
 */
export function processOccurrence(
  schedule: ProcessSchedule,
  now: Date,
  timeZone: string,
  tooLateAfterMinutes: number,
): { kind: 'none' } | { kind: 'due' | 'too_late'; dayKey: string } {
  const dayKey = zonedDayKey(now, timeZone);
  if (schedule.kind === 'interval') return { kind: 'due', dayKey };
  if (!schedule.weekdays.includes(zonedWeekday(now, timeZone))) return { kind: 'none' };

  const minuteNow = zonedMinuteOfDay(now, timeZone);
  // The LATEST time that has come: lateness is measured from the most recent
  // one, so a second time in the day is a second chance for whatever became
  // due since the first — which is what an admin adding it asked for.
  let latest: number | null = null;
  for (const time of schedule.times) {
    const minute = minuteOfDay(time);
    if (minute === null || minute > minuteNow) continue;
    if (latest === null || minute > latest) latest = minute;
  }
  if (latest === null) return { kind: 'none' };
  return { kind: minuteNow - latest > tooLateAfterMinutes ? 'too_late' : 'due', dayKey };
}

function minuteOfDay(time: string): number | null {
  const match = TIME_OF_DAY.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * What is wrong with a declaration, as a sentence — or null.
 *
 * At composition rather than at the first run, because every mistake here is
 * in the declaration: it is found at boot, by the developer who wrote it,
 * instead of by an operator reading a failed run.
 */
export function checkProcessDeclaration(declaration: ProcessDeclaration): string | null {
  const { key, module } = declaration;
  if (!PROCESS_KEY.test(key) || !key.startsWith(`${module}.`)) {
    return `its key must be '${module}.<what>' in snake_case`;
  }
  if (!declaration.label?.trim() || !declaration.description?.trim()) return 'it needs a label and a description';
  if (declaration.serves === undefined) {
    return "it must declare the feature it serves ('serves'), or write null for a process that serves no workspace";
  }
  if (declaration.serves !== null && !declaration.serves.startsWith(`${module}:`)) {
    return `it may only serve a feature of its own module ('${module}:…')`;
  }
  if (!isPositiveInteger(declaration.maxRunSeconds))
    return "it must declare 'maxRunSeconds', the longest one run may take";
  if (!isPositiveInteger(declaration.maxItemsPerRun))
    return "it must declare 'maxItemsPerRun', the most one run handles";
  if (!isPositiveInteger(declaration.tooLateAfterMinutes)) {
    return "it must declare 'tooLateAfterMinutes', how late is too late";
  }
  const limits = declaration.scheduleLimits;
  if (
    !limits ||
    !Array.isArray(limits.kinds) ||
    limits.kinds.length === 0 ||
    !isPositiveInteger(limits.minEveryMinutes)
  ) {
    return "it must declare 'scheduleLimits': the kinds of schedule it allows and its shortest interval";
  }
  const refusal = declaration.defaultSchedule ? checkProcessSchedule(declaration.defaultSchedule, limits) : 'malformed';
  return refusal === null ? null : `its default schedule breaks its own limits (${refusal})`;
}

/**
 * Every process declared across every module, for the runner and the seed task.
 *
 * Duplicate keys throw, as duplicate feature keys do: a process is paused,
 * forced and audited BY KEY, and two answering to one would have an operator
 * pausing the wrong one. ⚠ An incomplete declaration throws too — see
 * `checkProcessDeclaration`. Never catch either.
 *
 * Generic so the handler survives: given descriptors it returns contributions,
 * given the seed's handler-less list it returns declarations.
 */
export function composeProcesses<T extends ProcessDeclaration>(
  modules: readonly { key: string; processes?: readonly T[] }[],
): T[] {
  const seen = new Map<string, string>();
  const processes: T[] = [];

  for (const mod of modules) {
    for (const declaration of mod.processes ?? []) {
      const owner = seen.get(declaration.key);
      if (owner) {
        throw new ModuleCompositionError(`Process '${declaration.key}' declared by both '${owner}' and '${mod.key}'`);
      }
      const problem = checkProcessDeclaration(declaration);
      if (problem) {
        throw new ModuleCompositionError(
          `Process '${declaration.key}' in '${mod.key}' cannot be composed: ${problem}.`,
        );
      }
      seen.set(declaration.key, mod.key);
      processes.push(declaration);
    }
  }
  return processes;
}
