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
