import type { ProcessSchedule, ProcessScheduleLimits, ProcessScheduleRefusal } from '@kwtech/module-kit';

/**
 * A schedule in words, and the admin's schedule as it is stored (JOBS-PLAN §7).
 *
 * Pure, and in the root rather than `/react`, because the server says the same
 * sentences: a refusal names the limit that was broken, and the page must not
 * word that limit a second way.
 */

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/**
 * The admin's schedule on a process's row, or null when none is in force.
 *
 * ⚠ `scheduleSetAt` IS THE SWITCH, not the column being null. "Reset to
 * default" clears `scheduleSetAt` and leaves `schedule` as it was, because
 * writing SQL NULL into a Json column needs a sentinel from the generated
 * Prisma client, which a module may not import (PLAN §9). Every reader — the
 * queue, the runner, the admin page — goes through here, so a schedule an
 * admin took back can never come round again.
 */
export function adminSchedule(row: { schedule: unknown; scheduleSetAt: Date | null }): unknown {
  return row.scheduleSetAt === null ? null : row.schedule;
}

/** A schedule with its times and weekdays in order and said once each — what is stored and compared. */
export function normalizeSchedule(schedule: ProcessSchedule): ProcessSchedule {
  if (schedule.kind === 'interval') return { kind: 'interval', everyMinutes: schedule.everyMinutes };
  return {
    kind: 'daily',
    times: [...new Set(schedule.times)].sort(),
    weekdays: [...new Set(schedule.weekdays)].sort((a, b) => a - b),
  };
}

/** Whether two schedules run a process at the same times, however they were written. */
export function isSameSchedule(a: ProcessSchedule, b: ProcessSchedule): boolean {
  return JSON.stringify(normalizeSchedule(a)) === JSON.stringify(normalizeSchedule(b));
}

/** "15 minutes", "1 hour", "2 hours", "1 day" — the largest whole unit, so 90 stays "90 minutes". */
export function describeMinutes(minutes: number): string {
  if (minutes % MINUTES_PER_DAY === 0) return plural(minutes / MINUTES_PER_DAY, 'day');
  if (minutes % MINUTES_PER_HOUR === 0) return plural(minutes / MINUTES_PER_HOUR, 'hour');
  return plural(minutes, 'minute');
}

/**
 * A schedule as a sentence without its full stop: "Every 15 minutes", "At
 * 08:00 every day", "At 08:00 and 17:00 on Monday and Friday".
 *
 * ⚠ A `daily` time is EACH WORKSPACE'S OWN (JOBS-PLAN D6). This says only the
 * time; the page says whose beside it, once.
 */
export function describeSchedule(schedule: ProcessSchedule): string {
  if (schedule.kind === 'interval') return `Every ${describeMinutes(schedule.everyMinutes)}`;
  const { times, weekdays } = normalizeSchedule(schedule) as Extract<ProcessSchedule, { kind: 'daily' }>;
  return `At ${listOf(times)} ${describeWeekdays(weekdays)}`;
}

function describeWeekdays(weekdays: readonly number[]): string {
  if (weekdays.length === WEEKDAY_NAMES.length) return 'every day';
  return `on ${listOf(weekdays.map((weekday) => WEEKDAY_NAMES[weekday] ?? `day ${weekday}`))}`;
}

/**
 * Why a schedule is refused, as a sentence naming the limit it broke
 * (JOBS-PLAN §7: "This process can run at most every 5 minutes").
 */
export function scheduleRefusalMessage(refusal: ProcessScheduleRefusal, limits: ProcessScheduleLimits): string {
  switch (refusal) {
    case 'malformed':
      return 'That is not a schedule: give a whole number of minutes, of at most a week.';
    case 'kind_not_allowed':
      return limits.kinds.includes('interval')
        ? 'This process can only run every so many minutes, not at set times of day.'
        : 'This process can only run at set times of day, not every so many minutes.';
    case 'interval_too_short':
      return `This process can run at most every ${describeMinutes(limits.minEveryMinutes)}.`;
    case 'no_times':
      return 'Give at least one time of day.';
    case 'invalid_time':
      return 'A time of day is written as hours and minutes, like 08:00.';
    case 'no_weekdays':
      return 'Choose at least one day of the week.';
    case 'invalid_weekday':
      return 'That is not a day of the week.';
  }
}

function plural(count: number, unit: string): string {
  return count === 1 ? `1 ${unit}` : `${count} ${unit}s`;
}

/** "a", "a and b", "a, b and c". */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
