'use client';

import { STOCK_OPERATIONS } from '../operations.js';
import type {
  StockCategoryView,
  StockItemView,
  StockMovesView,
  StockMoveView,
  StockOverviewView,
  StockSourceItemView,
  StockTakeView,
  StockUseView,
} from '../views.js';

/**
 * How the stock app reaches the API — through the app's same-origin route
 * handler, which attaches the session. The path is a parameter because that
 * handler belongs to `module-auth`, and this module may not name its URL (PLAN §9).
 */
export const DEFAULT_GRAPHQL_PATH = '/api/auth/graphql';

type StockCall = Exclude<keyof typeof STOCK_OPERATIONS, 'stockEvents'>;

/*
 * The shapes the API answers with are the root's `*View`s (src/views.ts), so
 * the server and this client hold one definition. ⚠ Quantities are THOUSANDTHS
 * of the item's unit, money WHOLE CENTAVOS.
 */

export interface StockScopeView {
  organizationId: string;
  workspaceId: string;
}

export interface StockEventView {
  /** `sync`, `stock`, `setup` or `take`. */
  kind: string;
  actorId: string | null;
}

export interface StockItemInput {
  id?: string | null;
  kind: string;
  name: string;
  code?: string | null;
  unit: string;
  unitCost?: number | null;
  lowStockAt?: number | null;
  categoryId?: string | null;
}

export interface StockReceiveInput {
  stockItemId: string;
  quantity: number;
  unitCost?: number | null;
  supplier?: string | null;
  reference?: string | null;
  opening?: boolean | null;
  clientId: string;
}

export interface StockAdjustInput {
  stockItemId: string;
  quantity: number;
  reason: string;
  note?: string | null;
  clientId: string;
}

export interface StockWasteInput {
  lines: { stockItemId: string; quantity: number }[];
  reason: string;
  note?: string | null;
  ofRefId?: string | null;
  ofRefLabel?: string | null;
  clientId: string;
}

/** One method per operation. Every error is a sentence for a person. */
export interface StockClient {
  overview(scope: StockScopeView, includeArchived?: boolean): Promise<StockOverviewView>;
  moves(scope: StockScopeView, stockItemId: string, cursor: string | null): Promise<StockMovesView>;
  sourceItems(scope: StockScopeView): Promise<StockSourceItemView[]>;
  takes(scope: StockScopeView): Promise<StockTakeView[]>;
  take(scope: StockScopeView, takeId: string): Promise<StockTakeView>;
  receive(scope: StockScopeView, input: StockReceiveInput): Promise<StockMoveView>;
  adjust(scope: StockScopeView, input: StockAdjustInput): Promise<StockMoveView>;
  waste(scope: StockScopeView, input: StockWasteInput): Promise<StockMoveView[]>;
  saveItem(scope: StockScopeView, input: StockItemInput): Promise<StockItemView>;
  setItemArchived(scope: StockScopeView, stockItemId: string, archived: boolean): Promise<StockItemView>;
  saveCategory(
    scope: StockScopeView,
    input: { categoryId?: string | null; name: string; sortOrder?: number | null },
  ): Promise<StockCategoryView>;
  setCategoryArchived(scope: StockScopeView, categoryId: string, archived: boolean): Promise<StockCategoryView>;
  setUses(
    scope: StockScopeView,
    target: { refKind: 'item' | 'variant'; refId: string; refItemId: string },
    lines: { stockItemId: string; quantityPerUnit: number }[],
  ): Promise<StockUseView[]>;
  createFromSource(
    scope: StockScopeView,
    picks: { itemId: string; variantId: string | null }[],
  ): Promise<StockOverviewView>;
  startTake(scope: StockScopeView, categoryIds: string[], note?: string | null): Promise<StockTakeView>;
  saveTakeCounts(
    scope: StockScopeView,
    takeId: string,
    counts: { stockItemId: string; counted: number | null }[],
  ): Promise<StockTakeView>;
  confirmTake(scope: StockScopeView, takeId: string): Promise<StockTakeView>;
  abandonTake(scope: StockScopeView, takeId: string): Promise<StockTakeView>;
}

export function createStockClient(options: { graphqlPath?: string } = {}): StockClient {
  const path = options.graphqlPath ?? DEFAULT_GRAPHQL_PATH;

  /**
   * One request shape for every call, answering the operation's own field.
   * Throws the API's FIRST error message: the refusals are written for a
   * reader ("Pieces, sheets and packs are counted whole").
   */
  async function call<T>(operation: StockCall, scope: StockScopeView, variables: Record<string, unknown> = {}) {
    let response: Response;
    try {
      response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          query: STOCK_OPERATIONS[operation],
          variables: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, ...variables },
        }),
        cache: 'no-store',
      });
    } catch {
      // ⚠ Say so, never pretend it saved: a delivery that "went through" offline is entered twice.
      throw new Error('Cannot reach the server — nothing was saved. Check the connection and try again.');
    }
    if (!response.ok) {
      throw new Error(response.status === 401 ? 'Your session has ended. Sign in again.' : 'Cannot reach the server.');
    }
    const body = (await response.json()) as { data?: Record<string, unknown>; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'The request was refused.');
    if (!body.data || !(operation in body.data)) throw new Error('The server returned no data.');
    return body.data[operation] as T;
  }

  return {
    overview: (scope, includeArchived = false) => call('stockItems', scope, { includeArchived }),
    moves: (scope, stockItemId, cursor) => call('stockMoves', scope, { stockItemId, cursor }),
    sourceItems: (scope) => call('stockSourceItems', scope),
    takes: (scope) => call('stockTakes', scope),
    take: (scope, takeId) => call('stockTake', scope, { takeId }),
    receive: (scope, input) => call('receiveStock', scope, { input }),
    adjust: (scope, input) => call('adjustStock', scope, { input }),
    waste: (scope, input) => call('recordStockWaste', scope, { input }),
    saveItem: (scope, input) => call('saveStockItem', scope, { input }),
    setItemArchived: (scope, stockItemId, archived) => call('setStockItemArchived', scope, { stockItemId, archived }),
    saveCategory: (scope, input) => call('saveStockCategory', scope, input),
    setCategoryArchived: (scope, categoryId, archived) =>
      call('setStockCategoryArchived', scope, { categoryId, archived }),
    setUses: (scope, target, lines) => call('setStockUses', scope, { ...target, lines }),
    createFromSource: (scope, picks) => call('createStockFromSource', scope, { picks }),
    startTake: (scope, categoryIds, note = null) => call('startStockTake', scope, { categoryIds, note }),
    saveTakeCounts: (scope, takeId, counts) => call('saveStockTakeCounts', scope, { takeId, counts }),
    confirmTake: (scope, takeId) => call('confirmStockTake', scope, { takeId }),
    abandonTake: (scope, takeId) => call('abandonStockTake', scope, { takeId }),
  };
}
