import { stockLevel } from '../domain/levels.js';
import { stockValueAtCost } from '../domain/quantities.js';
import type {
  StockCategoryView,
  StockItemView,
  StockMoveView,
  StockSourceItemView,
  StockTakeLineView,
  StockTakeView,
  StockUseView,
} from '../views.js';
import type { StockSourceItem } from './ports.js';
import type {
  StockCategoryRow,
  StockItemRow,
  StockMoveRow,
  StockTakeLineRow,
  StockTakeRow,
  StockUseRow,
} from './stock.repository.js';

/** Who someone is, by id. Missing means the directory does not know them. */
export type StockNames = ReadonlyMap<string, string>;

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

export function renderCategory(row: StockCategoryRow): StockCategoryView {
  return { id: row.id, name: row.name, sortOrder: row.sortOrder, archivedAt: iso(row.archivedAt) };
}

export function renderItem(row: StockItemRow, onHand: number, usedBy: number): StockItemView {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    code: row.code,
    unit: row.unit,
    unitCost: row.unitCost,
    lowStockAt: row.lowStockAt,
    categoryId: row.categoryId,
    archivedAt: iso(row.archivedAt),
    onHand,
    level: stockLevel(onHand, row.lowStockAt),
    value: stockValueAtCost(onHand, row.unitCost),
    usedBy,
  };
}

export function renderUse(row: StockUseRow): StockUseView {
  return {
    id: row.id,
    refKind: row.refKind,
    refId: row.refId,
    refItemId: row.refItemId,
    refLabel: row.refLabel,
    stockItemId: row.stockItemId,
    quantityPerUnit: row.quantityPerUnit,
  };
}

export function renderMove(row: StockMoveRow, names: StockNames = new Map()): StockMoveView {
  return {
    id: row.id,
    stockItemId: row.stockItemId,
    kind: row.kind,
    quantity: row.quantity,
    unitCost: row.unitCost,
    reason: row.reason,
    note: row.note,
    supplier: row.supplier,
    reference: row.reference,
    sourceKey: row.sourceKey,
    wasteRefLabel: row.wasteRefLabel,
    takeId: row.takeId,
    createdById: row.createdById,
    createdByName: row.createdById ? (names.get(row.createdById) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * A take's lines. While OPEN, on hand is NOW (what confirming would compare
 * against); once confirmed, it is what it was then, so the sheet still shows
 * the differences that were written.
 */
export function renderTake(
  row: StockTakeRow,
  lines: readonly StockTakeLineRow[],
  onHandNow: ReadonlyMap<string, number>,
  names: StockNames = new Map(),
): StockTakeView {
  const rendered: StockTakeLineView[] = lines.map((line) => {
    const onHand = row.status === 'open' ? (onHandNow.get(line.stockItemId) ?? 0) : (line.onHandAtConfirm ?? 0);
    return {
      stockItemId: line.stockItemId,
      counted: line.counted,
      onHand,
      difference: line.counted === null ? null : line.counted - onHand,
    };
  });
  return {
    id: row.id,
    status: row.status,
    categoryIds: [...row.categoryIds],
    note: row.note,
    createdById: row.createdById,
    createdByName: names.get(row.createdById) ?? null,
    createdAt: row.createdAt.toISOString(),
    closedAt: iso(row.closedAt),
    lines: rendered,
  };
}

/** "Sintraboard Photo Print — A3", or the item's name alone. The one place the label is spelled. */
export function sourceLabel(item: Pick<StockSourceItem, 'itemName' | 'variantName'>): string {
  return item.variantName ? `${item.itemName} — ${item.variantName}` : item.itemName;
}

export function renderSourceItem(item: StockSourceItem): StockSourceItemView {
  return { ...item, label: sourceLabel(item) };
}
