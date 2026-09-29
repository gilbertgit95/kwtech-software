/**
 * The store's calendar (D22). "Today" is the STORE's day, not the server's
 * (UTC) nor the browser's: an 11:30 PM sale in Manila is that day's sale, not
 * the next day's. The workspace has no time zone of its own (PLAN §12.83), so
 * the POS keeps one in its settings.
 *
 * No date library (typescript rules): `Intl` knows every IANA zone and its
 * daylight-saving rules, which is the part nobody should hand-write.
 */

export const POS_DEFAULT_TIME_ZONE = 'Asia/Manila';

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
