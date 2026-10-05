/**
 * A WORKSPACE'S CALENDAR. "Today" in a workspace is the workspace's day — not
 * the server's (UTC), nor the viewer's browser's: an 11:30 PM sale in Manila
 * is that day's sale, and a task due "today" is due on the workspace's today
 * wherever the person reading it happens to be.
 *
 * Each workspace keeps its time zone (`perm_workspace.timeZone`, module-
 * permissions); a module reads it through the app — `useWorkspaceTimeZone()`
 * in the browser, a port on the server — and asks these helpers the rest.
 *
 * Here because it has TWO consumers (`module-basic-pos`, `module-task`) and
 * one rule: two copies of "which day is this instant" drift, and then a
 * report and a board disagree about what today is (principle 5).
 *
 * No date library (typescript rules): `Intl` knows every IANA zone and its
 * daylight-saving rules, which is the part nobody should hand-write.
 */

/** The zone a workspace starts with, and the fallback wherever one is not known yet. */
export const DEFAULT_TIME_ZONE = 'Asia/Manila';

/** Whether `timeZone` is an IANA name this runtime knows ("Asia/Manila"). */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.length === 0 || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

/** The store's calendar day of an instant, as `YYYY-MM-DD`. The key every per-day report groups by. */
export function zonedDayKey(instant: Date, timeZone: string): string {
  const { year, month, day } = zonedParts(instant, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The store's calendar month of an instant, as `YYYY-MM`. */
export function zonedMonthKey(instant: Date, timeZone: string): string {
  return zonedDayKey(instant, timeZone).slice(0, 7);
}

/** The store's hour (0–23) of an instant: sales by hour. */
export function zonedHour(instant: Date, timeZone: string): number {
  return zonedParts(instant, timeZone).hour;
}

/**
 * How many minutes into the store's day an instant is (0–1439): what "at 8:00"
 * is compared against, for a schedule kept in the workspace's own time.
 */
export function zonedMinuteOfDay(instant: Date, timeZone: string): number {
  const { hour, minute } = zonedParts(instant, timeZone);
  return hour * 60 + minute;
}

/**
 * The store's day of the week for an instant: 0 is Sunday, as `Date#getDay`
 * numbers them. Read off the store's own day, so a Sunday evening in Manila is
 * Sunday there while the server, in UTC, may already disagree.
 */
export function zonedWeekday(instant: Date, timeZone: string): number {
  const { year, month, day } = zonedParts(instant, timeZone);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * The instant a store day (`YYYY-MM-DD`) begins, so the server can ask for
 * "rows from this instant until the next day's".
 *
 * Found by guessing midnight UTC and correcting by the zone's offset at the
 * guess, twice — the second pass settles a guess that landed on the other side
 * of a daylight-saving change. Returns null for a malformed day.
 */
export function zonedStartOfDay(dayKey: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(dayKey);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const wanted = Date.UTC(year, month - 1, day);
  if (new Date(wanted).getUTCDate() !== day) return null;
  let guess = wanted;
  for (let pass = 0; pass < 2; pass += 1) {
    const seen = zonedParts(new Date(guess), timeZone);
    const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
    guess += wanted - seenAsUtc;
  }
  return new Date(guess);
}

/** The day after `dayKey`, as `YYYY-MM-DD`. Calendar arithmetic, zone-free. */
export function nextDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const next = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + 1));
  return next.toISOString().slice(0, 10);
}
