/**
 * Bounded reads, for every list this module exposes.
 *
 * ## Why a cap and not just a default
 *
 * A default protects the caller who does not ask; a CAP protects the server
 * from the one who asks for everything. `?limit=100000` on an endpoint with
 * only a default is the same unbounded query with extra steps — and the request
 * that finally hurts is never the one anybody tested.
 *
 * So `MAX_PAGE_SIZE` equals the largest page the UI offers: the API never
 * returns more than a person could have asked for through the interface, and a
 * script wanting the whole registry pages through it like everyone else.
 *
 * ## Clamped, not refused
 *
 * An out-of-range `limit` is brought into range rather than rejected. A caller
 * asking for 5000 wants "as many as I can have", and answering with a 400 turns
 * a reasonable request into an error somebody has to handle. The response says
 * which limit was actually applied, so nothing has to guess.
 */

/** The page sizes the UI offers, and the only ones worth documenting. */
export const PAGE_SIZES = [10, 50, 100] as const;

/**
 * What you get without asking. Deliberately the LARGEST option rather than the
 * smallest: a caller who does not paginate almost always wants the whole small
 * list, and making them page through tens is friction for no protection.
 */
export const DEFAULT_PAGE_SIZE = 100;

/**
 * The hard ceiling, equal to the default — so `limit` can only ever narrow.
 * Raising it is one constant, and should come with a reason.
 */
export const MAX_PAGE_SIZE = 100;

export interface PageArgs {
  limit?: number | null | undefined;
  offset?: number | null | undefined;
}

export interface Page<T> {
  items: T[];
  /** Rows BEFORE paging — what the caller needs to render "6 of 17". */
  total: number;
  /** The limit actually applied, which may not be the one requested. */
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * A whole number in range, or the fallback.
 *
 * Fractions and NaN fall back rather than truncating: `limit=1.5` is a caller
 * mistake, and silently answering 1 would make a broken client look like a
 * working one returning odd results.
 */
function bounded(value: number | null | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

export function resolvePageArgs(args: PageArgs = {}): { limit: number; offset: number } {
  return {
    limit: bounded(args.limit, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE),
    // No upper bound on offset: paging past the end is an empty page, not an
    // error, and a client walking to the end should not have to know where it is.
    offset: bounded(args.offset, 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

/**
 * One page of an in-memory list.
 *
 * In memory because the registry IS in memory — a compiled constant. The shape
 * is what matters: a database-backed list returns the same `Page<T>`, so a
 * caller does not learn where the rows came from and the switch costs nothing
 * on the client.
 */
export function paginate<T>(all: readonly T[], args: PageArgs = {}): Page<T> {
  const { limit, offset } = resolvePageArgs(args);
  const items = all.slice(offset, offset + limit);

  return {
    items,
    total: all.length,
    limit,
    offset,
    // Computed from the TOTAL, not from a full page: a final page that happens
    // to be exactly `limit` long would otherwise claim there is more.
    hasMore: offset + items.length < all.length,
  };
}
