/**
 * A process's history: its runs and its control actions as ONE list, newest
 * first, so "why did reminders stop on Tuesday" reads off one screen
 * (JOBS-PLAN §7).
 *
 * They are two tables, so the merge is here, pure, and paged by a keyset
 * cursor (the chat shape): no offset to drift while runs keep arriving.
 */

/** Entries a page of history holds when the caller does not say. */
export const JOB_HISTORY_PAGE = 30;

/** The most a caller may ask for at once. */
export const JOB_HISTORY_PAGE_MAX = 100;

/**
 * How many more rows than the page each table is asked for.
 *
 * The cursor names an instant AND an id, and the tables are read from that
 * instant inclusive, so rows sharing the cursor's instant come back and are
 * dropped here. One process has at most a run and a control action or two at
 * one instant ("Run now" writes both with one clock); this is that, with room.
 */
export const JOB_HISTORY_TIE_ALLOWANCE = 4;

/** Where a page ended: the last entry shown. */
export interface JobHistoryCursor {
  at: Date;
  id: string;
}

/** One line of history, before it is rendered: when, and which row. */
export interface JobHistoryItem<Run, Control> {
  id: string;
  at: Date;
  entry: { kind: 'run'; run: Run } | { kind: 'control'; control: Control };
}

const CURSOR_SEPARATOR = '~';

/** A cursor as the opaque string the client hands back. */
export function encodeHistoryCursor(cursor: JobHistoryCursor): string {
  return `${cursor.at.toISOString()}${CURSOR_SEPARATOR}${cursor.id}`;
}

/** A cursor read back — or null for one this code did not write. */
export function parseHistoryCursor(raw: string): JobHistoryCursor | null {
  const split = raw.indexOf(CURSOR_SEPARATOR);
  if (split <= 0) return null;
  const at = new Date(raw.slice(0, split));
  const id = raw.slice(split + 1);
  if (Number.isNaN(at.getTime()) || id === '') return null;
  return { at, id };
}

/** The page size a caller gets: theirs, inside 1 and the maximum, or the default. */
export function historyPageSize(limit: number | null | undefined): number {
  if (limit == null || !Number.isInteger(limit) || limit < 1) return JOB_HISTORY_PAGE;
  return Math.min(limit, JOB_HISTORY_PAGE_MAX);
}

/** Newest first; at one instant, by id, so the order is the same on every read. */
function newestFirst(a: { at: Date; id: string }, b: { at: Date; id: string }): number {
  const byTime = b.at.getTime() - a.at.getTime();
  if (byTime !== 0) return byTime;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

/**
 * One page of the merged history.
 *
 * `runs` and `controls` are each table's newest rows from the cursor's instant
 * back, at least `limit + 1 + JOB_HISTORY_TIE_ALLOWANCE` of them or all there
 * are. ⚠ Rows the previous page already showed (the cursor's own, and those
 * sorted before it at the same instant) are dropped here, not by the query.
 */
export function mergeHistory<
  Run extends { id: string; queuedAt: Date },
  Control extends { id: string; createdAt: Date },
>(
  runs: readonly Run[],
  controls: readonly Control[],
  cursor: JobHistoryCursor | null,
  limit: number,
): { items: JobHistoryItem<Run, Control>[]; nextCursor: JobHistoryCursor | null } {
  const merged: JobHistoryItem<Run, Control>[] = [
    ...runs.map((run) => ({ id: run.id, at: run.queuedAt, entry: { kind: 'run' as const, run } })),
    ...controls.map((control) => ({
      id: control.id,
      at: control.createdAt,
      entry: { kind: 'control' as const, control },
    })),
  ]
    .filter((item) => cursor === null || newestFirst(cursor, item) < 0)
    .sort(newestFirst);

  const items = merged.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: merged.length > limit && last ? { at: last.at, id: last.id } : null };
}
