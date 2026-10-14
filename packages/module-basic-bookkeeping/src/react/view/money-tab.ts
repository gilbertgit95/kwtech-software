import { monthBounds, monthOfDay, shiftBooksDay } from '../../domain/days.js';
import type { BooksDay, BooksEntryKind, BooksPlace } from '../../types.js';
import type { BooksEntryView } from '../books-client.js';
import { directionOf, entryMoneyChange, entryTitle, isKnownKind, KIND_LABEL, kindLabel, whoName } from './labels.js';
import type { BooksLedgerLine } from './ledger.js';

/**
 * The Money tab's two questions, pure and tested (`test/money-tab.test.ts`) so
 * the component only draws: WHICH DAYS are read (a range the server answers,
 * with the cash on hand brought forward into it), and WHICH OF THEIR LINES are
 * shown (filters run here, on the page already read).
 *
 * ⚠ Filters hide lines, they never re-add the book. Cash on hand after each
 * line is worked out over EVERY line of the range first, so a line shown alone
 * still says what was in hand after it — the same figure the unfiltered book
 * prints there. Every day here is the WORKSPACE's (`overview.today`).
 */

/** A run of days, both ends included. */
export interface MoneyRange {
  fromDay: BooksDay;
  toDay: BooksDay;
}

export type MoneyPreset = 'this_month' | 'last_month' | 'last_7_days' | 'last_30_days' | 'this_year';

/** The quick choices, in the order the chips are drawn. */
export const MONEY_PRESETS: readonly { key: MoneyPreset; label: string }[] = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'last_7_days', label: 'Last 7 days' },
  { key: 'last_30_days', label: 'Last 30 days' },
  { key: 'this_year', label: 'This year' },
];

/**
 * A preset's days. Every range ends by today at the latest: nothing is in the
 * books after it, and a range that stops at today reads "up to now".
 */
export function presetRange(preset: MoneyPreset, today: BooksDay): MoneyRange {
  switch (preset) {
    case 'this_month':
      return { fromDay: `${monthOfDay(today)}-01`, toDay: today };
    case 'last_month':
      return monthBounds(monthOfDay(shiftBooksDay(`${monthOfDay(today)}-01`, -1)));
    case 'last_7_days':
      return { fromDay: shiftBooksDay(today, -6), toDay: today };
    case 'last_30_days':
      return { fromDay: shiftBooksDay(today, -29), toDay: today };
    case 'this_year':
      return { fromDay: `${today.slice(0, 4)}-01-01`, toDay: today };
  }
}

/** The preset a range is, so its chip lights up — or null for days picked by hand. */
export function matchPreset(range: MoneyRange, today: BooksDay): MoneyPreset | null {
  const found = MONEY_PRESETS.find(({ key }) => {
    const preset = presetRange(key, today);
    return preset.fromDay === range.fromDay && preset.toDay === range.toDay;
  });
  return found?.key ?? null;
}

function lastDayOfMonth(day: BooksDay): BooksDay {
  return monthBounds(monthOfDay(day)).toDay;
}

/**
 * The range before (`-1`) or after (`1`) this one, as ← and → step it.
 *
 * - A MONTH (from its 1st to its last day, or to today in this month) steps a
 *   whole month: "This month" ← is all of last month, as the tab always did.
 * - A YEAR (1 Jan to 31 Dec, or to today) steps a whole year.
 * - Anything else steps by its own length: a week ← is the week before.
 *
 * ⚠ Never past today: the step after one ending today is null, and a step
 * that would run past today stops at today.
 */
export function stepRange(range: MoneyRange, by: -1 | 1, today: BooksDay): MoneyRange | null {
  if (by === 1 && range.toDay >= today) return null;
  const clamp = (next: MoneyRange): MoneyRange => (next.toDay > today ? { ...next, toDay: today } : next);
  const { fromDay, toDay } = range;
  const endsMonth = toDay === lastDayOfMonth(toDay) || toDay === today;
  if (fromDay.endsWith('-01') && monthOfDay(fromDay) === monthOfDay(toDay) && endsMonth) {
    const month = monthOfDay(shiftBooksDay(by === -1 ? fromDay : lastDayOfMonth(fromDay), by));
    return clamp(monthBounds(month));
  }
  const endsYear = toDay.endsWith('-12-31') || toDay === today;
  if (fromDay.endsWith('-01-01') && fromDay.slice(0, 4) === toDay.slice(0, 4) && endsYear) {
    const year = Number(fromDay.slice(0, 4)) + by;
    return clamp({ fromDay: `${year}-01-01`, toDay: `${year}-12-31` });
  }
  const length = rangeLength(range);
  return clamp({ fromDay: shiftBooksDay(fromDay, by * length), toDay: shiftBooksDay(toDay, by * length) });
}

/** How many days a range covers, both ends counted: "31 days". */
export function rangeLength(range: MoneyRange): number {
  return Math.round((Date.parse(range.toDay) - Date.parse(range.fromDay)) / 86_400_000) + 1;
}

// ── filters ──────────────────────────────────────────────────────────────────

/** Which way a line moved cash on hand: anything, money in only, money out only. */
export type MoneyDirectionFilter = 'all' | 'in' | 'out';

export interface MoneyFilter {
  /** Words to find in the line's title, note, reference or who recorded it. */
  search: string;
  /** Empty: every kind. */
  kinds: readonly BooksEntryKind[];
  /** Empty: every place. A transfer matches either end. */
  places: readonly BooksPlace[];
  direction: MoneyDirectionFilter;
  /** Voided lines are kept in the book; this only hides them. */
  showVoided: boolean;
}

export const NO_MONEY_FILTER: MoneyFilter = { search: '', kinds: [], places: [], direction: 'all', showVoided: true };

/** How many filters narrow the list — the count on *Clear filters*. */
export function activeFilterCount(filter: MoneyFilter): number {
  return [
    filter.search.trim() !== '',
    filter.kinds.length > 0,
    filter.places.length > 0,
    filter.direction !== 'all',
    !filter.showVoided,
  ].filter(Boolean).length;
}

/**
 * Whether a line passes the filter. Direction is the KIND's (`directionOf`),
 * not the line's change, so a voided sale is still "money in" — it shows
 * under the direction it would have moved, struck through. A transfer moves
 * no cash on hand and is neither in nor out.
 */
export function matchesMoneyFilter(
  view: BooksEntryView,
  filter: MoneyFilter,
  names: { investor: string | null; borrower: string | null },
): boolean {
  if (!filter.showVoided && view.voidedAt !== null) return false;
  if (filter.kinds.length > 0 && !(isKnownKind(view.kind) && filter.kinds.includes(view.kind))) return false;
  if (filter.places.length > 0) {
    const at = [view.place, view.toPlace];
    if (!filter.places.some((place) => at.includes(place))) return false;
  }
  if (filter.direction !== 'all' && directionOf(view.kind) !== filter.direction) return false;
  const words = filter.search.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if (words.length > 0) {
    const text = [
      entryTitle(view, names),
      view.description,
      view.reference,
      whoName(view.recordedByName),
      view.voidReason,
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase();
    // Every word, anywhere: "rent june" finds "Expense · Rent" noted "June".
    if (!words.every((word) => text.includes(word))) return false;
  }
  return true;
}

/** The kinds the Kind filter offers: those in the range, plus any already chosen, in the labels' order. */
export function kindOptions(entries: readonly BooksEntryView[], chosen: readonly BooksEntryKind[]): BooksEntryKind[] {
  const present = new Set<string>([...entries.map((entry) => entry.kind), ...chosen]);
  return (Object.keys(KIND_LABEL) as BooksEntryKind[]).filter((kind) => present.has(kind));
}

/** A kind's label back to the kind, for `MultiSelect`, which speaks in labels. */
export function kindOfLabel(label: string): BooksEntryKind | null {
  const found = (Object.keys(KIND_LABEL) as BooksEntryKind[]).find((kind) => kindLabel(kind) === label);
  return found ?? null;
}

/** What the lines shown moved: money in, money out (negative), and the two together. Voided lines count nothing. */
export function moneyTotals(lines: readonly Pick<BooksLedgerLine, 'view'>[]): {
  moneyIn: number;
  moneyOut: number;
  net: number;
} {
  let moneyIn = 0;
  let moneyOut = 0;
  for (const { view } of lines) {
    const change = entryMoneyChange(view);
    if (change > 0) moneyIn += change;
    else moneyOut += change;
  }
  return { moneyIn, moneyOut, net: moneyIn + moneyOut };
}

/** A toggle in a list: on if it was off, off if it was on. */
export function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}
