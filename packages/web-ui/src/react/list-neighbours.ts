/** Where an open row sits in the list on screen, and the rows either side of it. */
export interface ListNeighbours {
  /** The row above; null at the top, and when the open one is not in the list. */
  previous: string | null;
  /** The row below; null at the bottom, and when the open one is not in the list. */
  next: string | null;
  /** "3 of 20"; null when the open one is not in the list. */
  position: string | null;
}

/**
 * The rows before and after the open one, for the drawer's Previous and Next.
 *
 * Of the list AS SHOWN — the tab, the search, the archived filter — so Next is
 * always the row under the one just read. Something open that is not in the
 * list (a new, unsaved one; an order opened from a customer's history that the
 * search has since hidden) has no neighbours: stepping from nowhere would land
 * on an arbitrary row.
 */
export function listNeighbours(ids: readonly string[], current: string | null): ListNeighbours {
  const index = current === null ? -1 : ids.indexOf(current);
  if (index < 0) return { previous: null, next: null, position: null };
  return {
    previous: ids[index - 1] ?? null,
    next: ids[index + 1] ?? null,
    position: `${index + 1} of ${ids.length}`,
  };
}
