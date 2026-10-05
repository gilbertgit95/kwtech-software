import type { BookingSettingsValues } from '../../domain/catalogue.js';
import { durationText } from './time.js';

/**
 * The settings screen's choices, as a person makes them: "1 hr before", not
 * "60" in a box labelled minutes. Pure, so what each choice MEANS is tested
 * and the screen only draws it.
 *
 * ⚠ A STORED VALUE THAT IS NOT ON A LIST IS STILL OFFERED (`withCurrent`). The
 * domain allows any whole number in range, and another client — or an older
 * version of this screen — may have saved one. Leaving it off the list would
 * make the control show a different value from the one in force, and saving
 * anything else would silently change it.
 */

export interface SettingOption {
  value: number;
  label: string;
}

/** A length in minutes as words, by the day when it is whole days: 1440 → "1 day". */
export function spanText(minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  return durationText(minutes);
}

/** A number of days as words: 7 → "1 week", 30 → "30 days", 365 → "1 year". */
export function daysText(days: number): string {
  if (days === 365) return '1 year';
  if (days % 7 === 0 && days <= 28) {
    const weeks = days / 7;
    return `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
  }
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** A number of hours as words, by the day when it is whole days: 48 → "2 days". */
export function hoursText(hours: number): string {
  if (hours >= 24 && hours % 24 === 0) return spanText(hours * 60);
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

const options = (values: readonly number[], label: (value: number) => string): SettingOption[] =>
  values.map((value) => ({ value, label: label(value) }));

/** When staff are reminded. 0 is off, said as a choice rather than as a magic number. */
export const REMINDER_OPTIONS: readonly SettingOption[] = options([0, 5, 10, 15, 30, 60, 120, 1440], (minutes) =>
  minutes === 0 ? 'Off — no reminder' : `${spanText(minutes)} before`,
);

/** The least notice a customer must give. */
export const LEAD_OPTIONS: readonly SettingOption[] = options([0, 30, 60, 120, 240, 720, 1440, 2880], (minutes) =>
  minutes === 0 ? 'No notice needed' : `At least ${spanText(minutes)} ahead`,
);

/** How far ahead a customer may book. */
export const HORIZON_OPTIONS: readonly SettingOption[] = options(
  [7, 14, 30, 60, 90, 180, 365],
  (days) => `Up to ${daysText(days)} ahead`,
);

/** Until when a customer may cancel or move a booking themselves. */
export const CUTOFF_OPTIONS: readonly SettingOption[] = options([0, 60, 120, 240, 720, 1440, 2880], (minutes) =>
  minutes === 0 ? 'Right up to the start' : `Until ${spanText(minutes)} before`,
);

/** How long a request waits for staff before it lapses. */
export const LAPSE_OPTIONS: readonly SettingOption[] = options(
  [1, 2, 4, 12, 24, 48, 72, 168],
  (hours) => `After ${hoursText(hours)}`,
);

/**
 * The list, with the value in force added when it is not one of the presets —
 * in its place by size, and labelled in the list's own words.
 */
export function withCurrent(
  presets: readonly SettingOption[],
  current: number,
  label: (value: number) => string,
): SettingOption[] {
  if (presets.some((option) => option.value === current)) return [...presets];
  return [...presets, { value: current, label: label(current) }].sort((a, b) => a.value - b.value);
}

/** The settings a person edits on the screen: everything but the link, which the server makes. */
export type SettingsDraft = BookingSettingsValues;

/** Whether the form holds anything not yet saved — what shows the save bar. */
export function isSettingsChanged(draft: SettingsDraft, stored: SettingsDraft): boolean {
  return (Object.keys(stored) as (keyof SettingsDraft)[]).some((key) => {
    const [a, b] = [draft[key], stored[key]];
    // Text is compared as it would be STORED: trailing spaces are not a change.
    return typeof a === 'string' && typeof b === 'string' ? a.trim() !== b.trim() : a !== b;
  });
}

/**
 * The customer's rules as one sentence, so somebody can read what they have
 * set without decoding four controls.
 */
export function customerRulesSummary(
  rules: Pick<BookingSettingsValues, 'leadMinutes' | 'horizonDays' | 'cutoffMinutes' | 'lapseHours'>,
): string {
  const from = rules.leadMinutes === 0 ? 'any time still ahead' : `from ${spanText(rules.leadMinutes)} ahead`;
  const change = rules.cutoffMinutes === 0 ? 'right up to the start' : `until ${spanText(rules.cutoffMinutes)} before`;
  return (
    `Customers can ask for ${from}, up to ${daysText(rules.horizonDays)} ahead, ` +
    `and cancel or change it themselves ${change}. ` +
    `A request you do not answer lapses after ${hoursText(rules.lapseHours)}.`
  );
}
