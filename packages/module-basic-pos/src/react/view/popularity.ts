import type { PosRanksView } from '../pos-client.js';

/**
 * "Most ordered first" on the sell views (issue #47), as the browser holds it:
 * the store's daily ranking, by id. The rule itself — available first, then by
 * rank, ties and the unranked in the order they came — is `byPopularity` in
 * the domain; this only turns the answer into something to look up.
 */

/** Ranks by id: 1 is the most ordered. An id that is absent has no rank. */
export interface PosRankMap {
  items: ReadonlyMap<string, number>;
  variants: ReadonlyMap<string, number>;
}

/** The answer as a map. Null (not read yet, or could not be) ranks nothing, so the old order holds. */
export function rankMap(view: PosRanksView | null): PosRankMap | null {
  if (!view) return null;
  return {
    items: new Map(view.items.map((entry) => [entry.id, entry.rank])),
    variants: new Map(view.variants.map((entry) => [entry.id, entry.rank])),
  };
}

/** An item's rank, or null when it has none. */
export function itemRank(ranks: PosRankMap | null, itemId: string): number | null {
  return ranks?.items.get(itemId) ?? null;
}

/** A variant's rank, or null when it has none. */
export function variantRank(ranks: PosRankMap | null, variantId: string): number | null {
  return ranks?.variants.get(variantId) ?? null;
}
