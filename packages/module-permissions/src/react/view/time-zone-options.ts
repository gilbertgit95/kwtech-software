/**
 * The workspace settings' time-zone picker, as pure rules: what each zone is
 * called, its offset from GMT, the order they are listed in, and what a search
 * finds. Tested without rendering (`test/time-zone-options.test.ts`).
 */

export interface TimeZoneOption {
  /** The IANA name that is saved ("America/Argentina/Buenos_Aires"). */
  zone: string;
  /** The place, for people: the last segment, spaced ("Buenos Aires"). */
  city: string;
  /** Everything before the place, spaced ("America / Argentina"), or "" for a bare zone like "UTC". */
  region: string;
  /** Its offset NOW, as the browser spells it ("GMT+8", "GMT+5:30", "GMT"). */
  offset: string;
  /** The same in minutes east of GMT, for ordering. */
  offsetMinutes: number;
}

/**
 * A zone's offset at `now`.
 *
 * AT `now`, because an offset is not a property of the zone: New York is
 * GMT-4 in summer and GMT-5 in winter. What people recognise is today's.
 */
export function zoneOffset(zone: string, now: Date): { offset: string; offsetMinutes: number } {
  let offset = 'GMT';
  try {
    offset =
      new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
        .formatToParts(now)
        .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  } catch {
    // A zone this runtime does not know. It is still listed, so the saved value
    // stays visible, and it is shown as GMT, not dropped.
    return { offset, offsetMinutes: 0 };
  }
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/u.exec(offset);
  if (!match) return { offset, offsetMinutes: 0 };
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return { offset, offsetMinutes: match[1] === '-' ? -minutes : minutes };
}

/** One zone, described. */
export function describeZone(zone: string, now: Date): TimeZoneOption {
  const segments = zone.split('/').map((segment) => segment.replaceAll('_', ' '));
  const city = segments.at(-1) ?? zone;
  return { zone, city, region: segments.slice(0, -1).join(' / '), ...zoneOffset(zone, now) };
}

/**
 * Every zone to choose from, west to east and then by name, so neighbours in
 * the list are neighbours on the clock.
 *
 * ⚠ The CURRENT value is always included, even when this browser does not
 * list it (an older browser, or a zone renamed since). A picker must be able
 * to show what is saved, or opening the settings would quietly change it.
 */
export function timeZoneOptions(zones: readonly string[], current: string, now: Date): TimeZoneOption[] {
  return [...new Set([current, ...zones])]
    .map((zone) => describeZone(zone, now))
    .sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.zone.localeCompare(b.zone));
}

/**
 * The options a search finds: every word of the query must appear in the
 * zone's name, its place, its region or its offset. So "manila", "asia man",
 * "gmt+8" and "+5:30" all find what a person would expect. Case and
 * underscores do not matter.
 */
export function filterTimeZones(options: readonly TimeZoneOption[], query: string): readonly TimeZoneOption[] {
  const words = query.toLowerCase().replaceAll('_', ' ').split(/\s+/u).filter(Boolean);
  if (words.length === 0) return options;
  return options.filter((option) => {
    const haystack =
      `${option.zone.replaceAll('_', ' ')} ${option.city} ${option.region} ${option.offset}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
