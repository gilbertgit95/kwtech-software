import type { StockItemKind, StockLevel, StockMoveKind, StockQuantity, StockUnit, StockUseRefKind } from './types.js';

/**
 * What the server sends and the screens read — one set of shapes, in the pure
 * root, so the GraphQL types, the client and the views cannot drift. Moments
 * are ISO strings; quantities thousandths; money centavos.
 */

export interface StockCategoryView {
  id: string;
  name: string;
  sortOrder: number;
  archivedAt: string | null;
}

export interface StockItemView {
  id: string;
  kind: StockItemKind;
  name: string;
  code: string | null;
  unit: StockUnit;
  /** Centavos per whole unit, or null when never entered. */
  unitCost: number | null;
  lowStockAt: StockQuantity | null;
  categoryId: string | null;
  archivedAt: string | null;
  onHand: StockQuantity;
  level: StockLevel;
  /** On hand at cost, centavos; null without a cost. */
  value: number | null;
  /** How many list lines use it: an item nothing uses is only ever moved by hand. */
  usedBy: number;
}

export interface StockUseView {
  id: string;
  refKind: StockUseRefKind;
  refId: string;
  refItemId: string;
  refLabel: string;
  stockItemId: string;
  quantityPerUnit: StockQuantity;
}

/** The whole store's stock, as the app opens on it. */
export interface StockOverviewView {
  items: StockItemView[];
  categories: StockCategoryView[];
  uses: StockUseView[];
  /** Σ value over items with a cost. */
  totalValue: number;
  /** Items left out of `totalValue` because no cost was entered. */
  unvalued: number;
  /** Whether a point of sale is connected: without one, no list can be hung on a product. */
  hasSource: boolean;
}

export interface StockMoveView {
  id: string;
  stockItemId: string;
  kind: StockMoveKind;
  quantity: StockQuantity;
  unitCost: number | null;
  reason: string | null;
  note: string | null;
  supplier: string | null;
  reference: string | null;
  /** What another module's event this was (`pos:line:…`), or null for one made here. */
  sourceKey: string | null;
  wasteRefLabel: string | null;
  takeId: string | null;
  createdById: string | null;
  /** Null when the directory does not know them, or when a sale made it. */
  createdByName: string | null;
  createdAt: string;
}

export interface StockMovesView {
  moves: StockMoveView[];
  /** Pass back for older moves; null when there are none. */
  nextCursor: string | null;
}

export interface StockTakeLineView {
  stockItemId: string;
  counted: StockQuantity | null;
  /** On hand now while open; on hand at confirmation once confirmed. */
  onHand: StockQuantity;
  /** counted − on hand, or null while not counted. */
  difference: StockQuantity | null;
}

export interface StockTakeView {
  id: string;
  status: 'open' | 'confirmed' | 'abandoned';
  categoryIds: string[];
  note: string | null;
  createdById: string;
  createdByName: string | null;
  createdAt: string;
  closedAt: string | null;
  lines: StockTakeLineView[];
}

/** One thing the point of sale sells, for the list picker. */
export interface StockSourceItemView {
  itemId: string;
  variantId: string | null;
  itemName: string;
  variantName: string | null;
  kind: 'product' | 'service';
  code: string | null;
  archived: boolean;
  /** "Sintraboard Photo Print — A3": what a list shows it as. */
  label: string;
}
