/**
 * Where a card sits in its column, a checklist item in its list, and a column
 * on its board: a NUMBER between its neighbours (TASK-PLAN §4).
 *
 * A move writes ONE row — the moved one — with a rank between the two it lands
 * between, and the database sorts by it. That is what the notes list's id array
 * could not do (PLAN §12.81): no in-memory ordering, no cap on the board.
 *
 * ⚠ A NUMBER, NOT A STRING (the plan said string; changed while building,
 * 2026-09-28). Postgres sorts text by the database's COLLATION, and under a
 * locale collation `'B' < 'a'` can flip or case be ignored — the order the
 * server wrote is then not the order it reads. A double sorts the same in
 * JavaScript and in Postgres, always.
 *
 * The cost: halving a gap runs out after about fifty moves into the same spot.
 * `rankBetween` says so (null), and the service then REBALANCES that one list
 * (`rebalancedRanks`) — a rare write of one column's rows, not a correctness
 * problem.
 */

/** The gap between neighbours after a rebalance, and after the last item. */
export const TASK_RANK_STEP = 1024;

/**
 * Smaller than this, and two ranks are too close to fit another between them
 * reliably: rebalance first. Far above double precision's limit at these
 * magnitudes, so the midpoint is always strictly between.
 */
const MIN_GAP = 1e-6;

/**
 * A rank strictly between `before` and `after`, or NULL when there is no room
 * and the list must be rebalanced first.
 *
 *   rankBetween(null, null) — the first item of an empty list
 *   rankBetween(null, x)    — before the first
 *   rankBetween(x, null)    — after the last
 */
export function rankBetween(before: number | null, after: number | null): number | null {
  if (before === null && after === null) return TASK_RANK_STEP;
  if (before === null && after !== null) return after - TASK_RANK_STEP;
  if (after === null && before !== null) return before + TASK_RANK_STEP;
  if (before === null || after === null) return null;
  if (!(before < after) || after - before < MIN_GAP) return null;
  return before + (after - before) / 2;
}

/**
 * Evenly spaced ranks for a list IN ITS CURRENT ORDER — what a rebalance
 * writes. The order never changes; only the numbers do.
 */
export function rebalancedRanks<T extends { id: string }>(ordered: readonly T[]): { id: string; rank: number }[] {
  return ordered.map((item, index) => ({ id: item.id, rank: (index + 1) * TASK_RANK_STEP }));
}

/**
 * Where to put `movingId` so it lands just AFTER `afterId` (null: the top) in
 * a list already sorted by rank. The neighbours are read from the list WITHOUT
 * the moving item, so moving an item next to itself is not a special case.
 *
 * Null when there is no room — rebalance and ask again. `undefined` when
 * `afterId` is not in the list: the caller refuses, never guesses a place.
 */
export function rankAfter(
  ordered: readonly { id: string; rank: number }[],
  movingId: string,
  afterId: string | null,
): number | null | undefined {
  const others = ordered.filter((item) => item.id !== movingId);
  if (afterId === null) return rankBetween(null, others[0]?.rank ?? null);
  const at = others.findIndex((item) => item.id === afterId);
  if (at < 0) return undefined;
  return rankBetween(others[at]?.rank ?? null, others[at + 1]?.rank ?? null);
}
