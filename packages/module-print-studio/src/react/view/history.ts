import { zonedDayKey } from '@kwtech/module-kit';
import type { StudioLogEntryView } from '../studio-client.js';
import { plural } from './summary.js';

/**
 * The print history, as people read it.
 *
 * ⚠ EVERY DAY AND TIME IS THE WORKSPACE'S (`timeZone`), not the browser's and
 * not the server's: a print made at 11 pm in the shop belongs to that day
 * wherever the person reading the history is.
 */

export interface StudioHistoryDay {
  /** `YYYY-MM-DD` in the workspace's zone. */
  day: string;
  /** "Monday, 5 October 2026". */
  label: string;
  entries: StudioLogEntryView[];
  /** Sheets across the day's entries, copies counted. */
  sheets: number;
}

/** The entries grouped by the workspace's day, keeping the order they came in (newest first). */
export function groupByDay(entries: readonly StudioLogEntryView[], timeZone: string): StudioHistoryDay[] {
  const days: StudioHistoryDay[] = [];
  for (const entry of entries) {
    const at = new Date(entry.createdAt);
    const day = zonedDayKey(at, timeZone);
    let group = days[days.length - 1];
    if (!group || group.day !== day) {
      group = { day, label: dayLabel(at, timeZone), entries: [], sheets: 0 };
      days.push(group);
    }
    group.entries.push(entry);
    group.sheets += entry.pages * entry.copies;
  }
  return days;
}

export function dayLabel(at: Date, timeZone: string): string {
  return at.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  });
}

export function clockTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone });
}

/**
 * What happened, in the history's own careful words.
 *
 * ⚠ "Sent to print", never "Printed": a browser does not tell a page whether
 * paper came out (PRINT-STUDIO-PLAN §5).
 */
export function actionLabel(action: string): string {
  return action === 'downloaded' ? 'Downloaded' : 'Sent to print';
}

/** "2 sheets × 3 copies on 4R". */
export function entrySummary(entry: Pick<StudioLogEntryView, 'pages' | 'copies' | 'paperLabel'>): string {
  const copies = entry.copies > 1 ? ` × ${plural(entry.copies, 'copy', 'copies')}` : '';
  return `${plural(entry.pages, 'sheet')}${copies} on ${entry.paperLabel}`;
}
