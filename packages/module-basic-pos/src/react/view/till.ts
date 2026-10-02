import { checkPosQuantity, POS_QUANTITY_MAX } from '../../domain/money.js';
import type { PosSearchItem } from '../../domain/search.js';
import type { PosCatalogueView, PosItemView, PosOrderLineView } from '../pos-client.js';

/**
 * The till's view rules: what the search and the grid show, and what a held
 * order's lines should say about prices that moved. Pure, and tested.
 */

/** The catalogue as `searchItems` reads it (D19). */
export function searchCatalogue(catalogue: PosCatalogueView): PosSearchItem[] {
  const categories = new Map(catalogue.categories.map((category) => [category.id, category.name]));
  return catalogue.items.map((item) => ({
    id: item.id,
    name: item.name,
    code: item.code,
    categoryName: item.categoryId ? (categories.get(item.categoryId) ?? null) : null,
    price: item.price,
    archived: item.archivedAt !== null,
    variants: item.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      code: variant.code,
      price: variant.price,
      archived: variant.archivedAt !== null,
    })),
  }));
}

/** The live variants of an item, in the picker's order. None means it is sold as it is. */
export function liveVariants(item: PosItemView): PosItemView['variants'] {
  return item.variants.filter((variant) => variant.archivedAt === null);
}

/** The price range a tile shows: one price, or "₱20–₱60" across its variants. */
export function priceRange(item: PosItemView): { min: number; max: number } {
  const variants = liveVariants(item);
  if (variants.length === 0) return { min: item.price, max: item.price };
  const prices = variants.map((variant) => variant.price);
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

/** The grid's items: live, in one category or all, by name. */
export function gridItems(catalogue: PosCatalogueView, categoryId: string | null): PosItemView[] {
  return catalogue.items
    .filter((item) => item.archivedAt === null)
    .filter((item) => item.variants.length === 0 || liveVariants(item).length > 0)
    .filter((item) => categoryId === null || item.categoryId === categoryId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The categories that have something to sell, for the grid's tabs. */
export function gridCategories(catalogue: PosCatalogueView): PosCatalogueView['categories'] {
  const used = new Set(gridItems(catalogue, null).map((item) => item.categoryId));
  return catalogue.categories.filter((category) => category.archivedAt === null && used.has(category.id));
}

/**
 * What a held line's item costs NOW, when that differs from the price it was
 * added at — the "Price is now ₱50 · Update" of POS-PLAN §3. Null when the
 * price has not moved, or the item or variant is gone.
 */
export function priceNow(line: PosOrderLineView, catalogue: PosCatalogueView | null): number | null {
  if (!catalogue) return null;
  const item = catalogue.items.find((candidate) => candidate.id === line.itemId);
  if (!item || item.archivedAt) return null;
  const variant = line.variantId ? item.variants.find((candidate) => candidate.id === line.variantId) : null;
  if (line.variantId && (!variant || variant.archivedAt)) return null;
  const now = variant ? variant.price : item.price;
  return now === line.unitPrice ? null : now;
}

/** How many things are on an order: 100 magnets and 2 laminations is 102. */
export function itemCount(lines: readonly Pick<PosOrderLineView, 'quantity'>[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

/** A line's name as the cart and the receipt print it: "Lamination — 250 mic · A4". */
export function lineLabel(line: Pick<PosOrderLineView, 'name' | 'variantName'>): string {
  return line.variantName ? `${line.name} — ${line.variantName}` : line.name;
}

/** What the till says to a quantity it refuses, typed before the item ("0*") or on a line. */
export const QUANTITY_PROBLEM = `A quantity is a whole number from 1 to ${POS_QUANTITY_MAX}.`;

/**
 * A quantity typed on a cart line → the number, or null when it is not one
 * (empty, "2.5", "0", past `POS_QUANTITY_MAX`). Read from the TEXT: `Number('')`
 * is 0 and `Number('1e3')` is 1000, and neither is what the cashier typed.
 * The server checks again with the same `checkPosQuantity`.
 */
export function parseQuantity(text: string): number | null {
  const cleaned = text.replace(/[,\s]/gu, '');
  if (!/^\d{1,6}$/u.test(cleaned)) return null;
  const quantity = Number(cleaned);
  return checkPosQuantity(quantity) ? null : quantity;
}

/**
 * The option ↑ / ↓ lands on in a dropdown of `count` options (the customer
 * picker). Null is "none yet": the first ↓ takes the first, the first ↑ the
 * last, and both wrap, so a short list is never a dead end.
 */
export function nextOption(count: number, current: number | null, direction: 'up' | 'down'): number | null {
  if (count <= 0) return null;
  if (current === null || current < 0 || current >= count) return direction === 'down' ? 0 : count - 1;
  return direction === 'down' ? (current + 1) % count : (current - 1 + count) % count;
}
