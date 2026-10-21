import { proposeWaste } from '../../domain/moves.js';
import { formatStockQuantity } from '../../domain/quantities.js';
import { canStillMake, overlappingUses } from '../../domain/uses.js';
import type { StockLevel } from '../../types.js';
import type { StockItemView, StockOverviewView, StockSourceItemView, StockUseView } from '../../views.js';

/**
 * What the stock app's lists show, worked out once and tested: which items a
 * filter keeps, the products a list hangs on, and a product's lists as the
 * editor and the waste form need them.
 */

export type StockFilter = 'all' | 'low' | 'out' | 'materials' | 'for_sale';

const LOW_OR_WORSE: ReadonlySet<StockLevel> = new Set<StockLevel>(['low', 'out', 'negative']);
const OUT_OR_WORSE: ReadonlySet<StockLevel> = new Set<StockLevel>(['out', 'negative']);

/** Live items a filter, a category and the search box keep, by name. Words match in any order. */
export function filterItems(
  items: readonly StockItemView[],
  filter: StockFilter,
  categoryId: string | null,
  search: string,
): StockItemView[] {
  const words = search.toLocaleLowerCase('en').split(/\s+/u).filter(Boolean);
  return items.filter((item) => {
    if (item.archivedAt) return false;
    if (categoryId && item.categoryId !== categoryId) return false;
    if (filter === 'low' && !LOW_OR_WORSE.has(item.level)) return false;
    if (filter === 'out' && !OUT_OR_WORSE.has(item.level)) return false;
    if (filter === 'materials' && item.kind !== 'material') return false;
    if (filter === 'for_sale' && item.kind !== 'for_sale') return false;
    const haystack = `${item.name} ${item.code ?? ''}`.toLocaleLowerCase('en');
    return words.every((word) => haystack.includes(word));
  });
}

/** How many live items need somebody: low, out, or counted wrong. The badge on the Stock section. */
export function needsAttention(items: readonly StockItemView[]): number {
  return items.filter((item) => !item.archivedAt && LOW_OR_WORSE.has(item.level)).length;
}

/** One POS product as the Products section lists it: the item, its variants, and how many list lines it has. */
export interface ProductRow {
  itemId: string;
  name: string;
  kind: 'product' | 'service';
  archived: boolean;
  variants: StockSourceItemView[];
  /** Lines over the item's list and every variant's. Zero: selling it takes nothing. */
  lines: number;
}

/** The POS's catalogue grouped by item, archived ones last, each with how many list lines it carries. */
export function productRows(source: readonly StockSourceItemView[], uses: readonly StockUseView[]): ProductRow[] {
  const rows = new Map<string, ProductRow>();
  for (const entry of source) {
    if (entry.variantId === null) {
      rows.set(entry.itemId, {
        itemId: entry.itemId,
        name: entry.itemName,
        kind: entry.kind,
        archived: entry.archived,
        variants: rows.get(entry.itemId)?.variants ?? [],
        lines: 0,
      });
      continue;
    }
    const row = rows.get(entry.itemId);
    if (row) row.variants.push(entry);
  }
  for (const use of uses) {
    const row = rows.get(use.refItemId);
    if (row) row.lines += 1;
  }
  return [...rows.values()].sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));
}

/** The lines of one list: the item's own (`variantId` null) or one variant's. */
export function listOf(uses: readonly StockUseView[], refId: string): StockUseView[] {
  return uses.filter((use) => use.refId === refId);
}

/**
 * Stock items on the item's list AND a variant's: allowed (they add up), but
 * named, because it is more often a slip than a variant that really uses a
 * second hook.
 */
export function overlapNames(
  uses: readonly StockUseView[],
  itemId: string,
  items: readonly Pick<StockItemView, 'id' | 'name'>[],
): string[] {
  const product = uses.filter((use) => use.refItemId === itemId);
  const names = new Map(items.map((item) => [item.id, item.name]));
  return overlappingUses(product).map((id) => names.get(id) ?? 'An archived item');
}

/** How many of a product or variant the shelf can still make, from the overview; null when it uses nothing. */
export function canMake(
  overview: Pick<StockOverviewView, 'items' | 'uses'>,
  itemId: string,
  variantId: string | null,
): number | null {
  const onHand = new Map(overview.items.map((item) => [item.id, item.onHand]));
  return canStillMake(overview.uses, { itemId, variantId }, onHand);
}

/**
 * The waste form's lines for a spoiled product (I15): its materials from both
 * lists, as typed text to change before confirming.
 */
export function wasteLinesFor(
  uses: readonly StockUseView[],
  itemId: string,
  variantId: string | null,
  units: number,
): { key: string; stockItemId: string; quantity: string }[] {
  return proposeWaste(uses, { itemId, variantId }, units).map((line) => ({
    key: line.stockItemId,
    stockItemId: line.stockItemId,
    quantity: formatStockQuantity(line.quantity),
  }));
}

/** What the materials of one unit sold cost, in centavos, over the lines whose item has a cost; null when none has one. */
export function materialsCost(
  overview: Pick<StockOverviewView, 'items' | 'uses'>,
  itemId: string,
  variantId: string | null,
): number | null {
  const cost = new Map(overview.items.map((item) => [item.id, item.unitCost]));
  let total = 0;
  let any = false;
  for (const line of proposeWaste(overview.uses, { itemId, variantId }, 1)) {
    const unitCost = cost.get(line.stockItemId);
    if (unitCost === null || unitCost === undefined) continue;
    any = true;
    total += Math.round((line.quantity * unitCost) / 1000);
  }
  return any ? total : null;
}

/** "1 product", "3 products": the noun follows the count. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The figures across the top of the Stock section, over live items. */
export interface StockSummary {
  items: number;
  /** At or under their low level, with some left. */
  low: number;
  /** Nothing left, or counted wrong (below zero). */
  out: number;
  value: number;
  unvalued: number;
}

export function stockSummary(overview: Pick<StockOverviewView, 'items' | 'totalValue' | 'unvalued'>): StockSummary {
  const live = overview.items.filter((item) => !item.archivedAt);
  return {
    items: live.length,
    low: live.filter((item) => item.level === 'low').length,
    out: live.filter((item) => OUT_OR_WORSE.has(item.level)).length,
    value: overview.totalValue,
    unvalued: overview.unvalued,
  };
}

/**
 * How full an item's bar is, 0–1, measured against twice its low level — so
 * the low level sits at the bar's middle, where the eye reads "half way to
 * empty". Null when no level is set: a bar against nothing would mean nothing.
 */
export function levelFill(item: Pick<StockItemView, 'onHand' | 'lowStockAt'>): number | null {
  if (item.lowStockAt === null || item.lowStockAt <= 0) return null;
  if (item.onHand <= 0) return 0;
  return Math.min(1, item.onHand / (item.lowStockAt * 2));
}

/**
 * The material that runs out first for a product or variant — what "3 left"
 * is waiting on — or null when it uses nothing counted. Ties go to the first
 * by name, so the answer does not flicker between reloads.
 */
export function limitedBy(
  overview: Pick<StockOverviewView, 'items' | 'uses'>,
  itemId: string,
  variantId: string | null,
): string | null {
  const items = new Map(overview.items.map((item) => [item.id, item]));
  let best: { name: string; makes: number } | null = null;
  for (const line of proposeWaste(overview.uses, { itemId, variantId }, 1)) {
    const item = items.get(line.stockItemId);
    if (!item) continue;
    const makes = item.onHand <= 0 ? 0 : Math.floor(item.onHand / line.quantity);
    if (best === null || makes < best.makes || (makes === best.makes && item.name < best.name)) {
      best = { name: item.name, makes };
    }
  }
  return best?.name ?? null;
}
