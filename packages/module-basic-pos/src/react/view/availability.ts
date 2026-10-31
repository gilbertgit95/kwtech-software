import { isPosItemAvailable } from '../../domain/availability.js';
import { foldSearchText } from '../../domain/search.js';
import type { PosCatalogueView, PosItemView, PosVariantView } from '../pos-client.js';
import { liveVariants } from './till.js';

/**
 * The availability panel's rules (issue #37): what it lists, how it filters,
 * and what a selection switches. One panel serves the Items tab and the
 * "Availability" sheet on the sell views. Pure, and tested.
 */

/** Which rows the panel shows. */
export type PosAvailabilityStatus = 'all' | 'available' | 'unavailable';

/** The category filter's value for the items with no category (or an archived one). Not a cuid. */
export const POS_AVAILABILITY_OTHER = 'other';

export interface PosAvailabilityFilter {
  search: string;
  /** A category's id, `POS_AVAILABILITY_OTHER`, or null for every category. */
  categoryId: string | null;
  status: PosAvailabilityStatus;
}

export const POS_AVAILABILITY_NO_FILTER: PosAvailabilityFilter = { search: '', categoryId: null, status: 'all' };

/** One item in the panel, with the sizes it can be switched by. */
export interface PosAvailabilityRow {
  item: PosItemView;
  /** The live variants, in the store's order. */
  variants: PosVariantView[];
  /** Whether it has anything to sell (`isPosItemAvailable`). */
  available: boolean;
  /** How many of its sizes are switched off on their own. */
  variantsOff: number;
}

export interface PosAvailabilityGroup {
  /** The category's id, or `POS_AVAILABILITY_OTHER`. */
  id: string;
  name: string;
  rows: PosAvailabilityRow[];
}

/**
 * A selection: ITEM AND VARIANT KEYS IN ONE SET, `item:<id>` and
 * `variant:<id>`, so "select all" of a category is one set of strings and an
 * id that is both an item's and a variant's could never be confused.
 */
export type PosAvailabilitySelection = ReadonlySet<string>;

export function itemKey(id: string): string {
  return `item:${id}`;
}

export function variantKey(id: string): string {
  return `variant:${id}`;
}

/**
 * The panel's groups: the store's categories in its order, then "Other",
 * each item by name — the same grouping the sell views use, but with
 * EVERYTHING still on the till (available or not), and nothing archived.
 *
 * - Search matches the item's name, code, category and its sizes' names and
 *   codes, case- and accent-blind, every word somewhere.
 * - "Not available" shows an item that is off OR has any size off: that is
 *   where a manager looks for what to switch back on.
 */
export function availabilityGroups(
  catalogue: PosCatalogueView,
  filter: PosAvailabilityFilter = POS_AVAILABILITY_NO_FILTER,
): PosAvailabilityGroup[] {
  const live = catalogue.categories
    .filter((category) => category.archivedAt === null)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const liveIds = new Set(live.map((category) => category.id));
  const groupOf = (item: PosItemView) =>
    item.categoryId && liveIds.has(item.categoryId) ? item.categoryId : POS_AVAILABILITY_OTHER;
  const categoryName = new Map(live.map((category) => [category.id, category.name]));
  const tokens = foldSearchText(filter.search)
    .split(/\s+/u)
    .filter((token) => token.length > 0);

  const rows = catalogue.items
    .filter((item) => item.archivedAt === null)
    // An item whose every size is archived is not on the till at all: nothing to switch.
    .filter((item) => item.variants.length === 0 || liveVariants(item).length > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => toRow(item))
    .filter((row) => filter.categoryId === null || groupOf(row.item) === filter.categoryId)
    .filter((row) => matchesStatus(row, filter.status))
    .filter((row) => matchesSearch(row, tokens, categoryName.get(groupOf(row.item)) ?? null));

  const groups: PosAvailabilityGroup[] = live.map((category) => ({
    id: category.id,
    name: category.name,
    rows: rows.filter((row) => groupOf(row.item) === category.id),
  }));
  groups.push({
    id: POS_AVAILABILITY_OTHER,
    name: groups.length === 0 ? 'Items' : 'Other',
    rows: rows.filter((row) => groupOf(row.item) === POS_AVAILABILITY_OTHER),
  });
  return groups.filter((group) => group.rows.length > 0);
}

function toRow(item: PosItemView): PosAvailabilityRow {
  const variants = liveVariants(item);
  return {
    item,
    variants,
    available: isPosItemAvailable(item),
    variantsOff: variants.filter((variant) => variant.unavailableAt !== null).length,
  };
}

function matchesStatus(row: PosAvailabilityRow, status: PosAvailabilityStatus): boolean {
  switch (status) {
    case 'all':
      return true;
    case 'available':
      return row.item.unavailableAt === null && row.variantsOff === 0;
    case 'unavailable':
      return row.item.unavailableAt !== null || row.variantsOff > 0;
  }
}

function matchesSearch(row: PosAvailabilityRow, tokens: readonly string[], category: string | null): boolean {
  if (tokens.length === 0) return true;
  const text = foldSearchText(
    [row.item.name, row.item.code, category, ...row.variants.flatMap((variant) => [variant.name, variant.code])]
      .filter((part): part is string => part !== null)
      .join(' '),
  );
  return tokens.every((token) => text.includes(token));
}

/** Every key a set of rows can be selected by: each item, and each of its live sizes. */
export function selectionKeys(rows: readonly PosAvailabilityRow[]): string[] {
  return rows.flatMap((row) => [itemKey(row.item.id), ...row.variants.map((variant) => variantKey(variant.id))]);
}

/**
 * "Select all" over `keys` (a category, or everything shown): selects them
 * all, or — when they are all selected already — lets them all go. Keys
 * outside `keys` are left as they were.
 */
export function toggleAll(selection: PosAvailabilitySelection, keys: readonly string[]): Set<string> {
  const next = new Set(selection);
  const all = keys.length > 0 && keys.every((key) => selection.has(key));
  for (const key of keys) {
    if (all) next.delete(key);
    else next.add(key);
  }
  return next;
}

/** One checkbox. */
export function toggleOne(selection: PosAvailabilitySelection, key: string): Set<string> {
  const next = new Set(selection);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** Whether a "select all" box is ticked, unticked, or part way (`mixed`). */
export function selectAllState(selection: PosAvailabilitySelection, keys: readonly string[]): boolean | 'mixed' {
  const picked = keys.filter((key) => selection.has(key)).length;
  if (picked === 0) return false;
  return picked === keys.length ? true : 'mixed';
}

/**
 * What a selection sends: the item and variant ids it names. ⚠ ONLY KEYS
 * STILL ON SCREEN: a row filtered away after it was ticked is not switched by
 * a button the person pressed while looking at something else.
 */
export function selectionTarget(
  selection: PosAvailabilitySelection,
  shown: readonly string[],
): { itemIds: string[]; variantIds: string[] } {
  const visible = shown.filter((key) => selection.has(key));
  return {
    itemIds: visible.filter((key) => key.startsWith('item:')).map((key) => key.slice('item:'.length)),
    variantIds: visible.filter((key) => key.startsWith('variant:')).map((key) => key.slice('variant:'.length)),
  };
}

/** What the panel says after a switch: "3 items and 2 sizes marked not available." */
export function availabilityDone(change: { items: number; variants: number }, available: boolean): string {
  const parts = [
    change.items > 0 ? `${change.items} ${change.items === 1 ? 'item' : 'items'}` : null,
    change.variants > 0 ? `${change.variants} ${change.variants === 1 ? 'size' : 'sizes'}` : null,
  ].filter((part): part is string => part !== null);
  return `${parts.join(' and ')} marked ${available ? 'available' : 'not available'}.`;
}
