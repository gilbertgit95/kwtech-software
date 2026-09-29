'use client';

import { POS_OPERATIONS } from '../operations.js';

/**
 * How the POS reaches the API — through the app's same-origin route handler,
 * which attaches the session. The path is a parameter because that handler
 * belongs to `module-auth`, and this module may not name its URL (PLAN §9).
 */
export const DEFAULT_GRAPHQL_PATH = '/api/auth/graphql';

type PosOperationName = keyof typeof POS_OPERATIONS;

/*
 * The shapes the API answers with, hand-written (no codegen, frontend rules).
 * ⚠ Every amount is WHOLE CENTAVOS, as the server keeps it: ₱12.50 is 1250.
 */

export interface PosScopeView {
  organizationId: string;
  workspaceId: string;
}

export interface PosCategoryView {
  id: string;
  name: string;
  sortOrder: number;
  archivedAt: string | null;
}

export interface PosVariantView {
  id: string;
  itemId: string;
  name: string;
  code: string | null;
  price: number;
  /** Null when not entered, and when the viewer may not see costs. */
  cost: number | null;
  sortOrder: number;
  archivedAt: string | null;
}

export interface PosItemView {
  id: string;
  /** `product` or `service`. */
  kind: string;
  name: string;
  code: string | null;
  price: number;
  cost: number | null;
  categoryId: string | null;
  archivedAt: string | null;
  variants: PosVariantView[];
}

export interface PosCatalogueView {
  categories: PosCategoryView[];
  items: PosItemView[];
  costsVisible: boolean;
}

export interface PosCustomerView {
  id: string;
  name: string;
  contact: string | null;
  note: string | null;
  archivedAt: string | null;
}

export interface PosSettingsView {
  timeZone: string;
  /** `PosKeymap` as JSON text. */
  keymap: string;
  version: number;
}

export interface PosDiscountView {
  /** `amount` (centavos) or `percent` (basis points). */
  kind: string;
  value: number;
  reason: string;
  givenById: string | null;
  givenAt: string | null;
}

export interface PosOrderLineView {
  id: string;
  itemId: string;
  variantId: string | null;
  name: string;
  kind: string;
  variantName: string | null;
  code: string | null;
  categoryName: string | null;
  unitPrice: number;
  unitCost: number | null;
  quantity: number;
  note: string | null;
  discount: PosDiscountView | null;
  discountAmount: number;
  gross: number;
  total: number;
  net: number;
  refundedQuantity: number;
}

export interface PosRefundView {
  id: string;
  amount: number;
  method: string;
  reason: string;
  refundedById: string;
  refundedAt: string;
}

export interface PosOrderView {
  id: string;
  /** `open`, `unpaid`, `paid`, `cancelled` or `voided`. */
  status: string;
  version: number;
  number: number | null;
  label: string | null;
  customerId: string | null;
  customerName: string | null;
  customerContact: string | null;
  lines: PosOrderLineView[];
  gross: number;
  lineDiscounts: number;
  subtotal: number;
  discount: PosDiscountView | null;
  orderDiscount: number;
  total: number;
  paymentMethod: string | null;
  received: number | null;
  change: number | null;
  tip: number;
  paymentReference: string | null;
  changeOwed: number;
  changeSettlement: string | null;
  changeSettledAt: string | null;
  refunds: PosRefundView[];
  refunded: number;
  /** `none`, `partly` or `full`. */
  refundState: string;
  createdById: string;
  createdAt: string;
  finalisedAt: string | null;
  finalisedById: string | null;
  releasedUnpaid: boolean;
  paidAt: string | null;
  paidById: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface PosOrderSummaryView {
  id: string;
  status: string;
  version: number;
  number: number | null;
  label: string | null;
  customerName: string | null;
  itemCount: number;
  total: number;
  changeOwed: number;
  refunded: number;
  createdAt: string;
  finalisedAt: string | null;
  finalisedById: string | null;
  paidAt: string | null;
  cancelReason: string | null;
}

export interface PosCountAmountView {
  count: number;
  amount: number;
}

export interface PosSummaryView {
  orders: number;
  gross: number;
  discounts: number;
  refunds: number;
  netSales: number;
  averageOrder: number;
  tips: number;
  cash: number;
  ewallet: number;
  card: number;
  cashExpected: number;
  profit: number | null;
  costCoverage: number;
  unpaidReleased: PosCountAmountView;
  unpaidCollected: PosCountAmountView;
  changeOwedOutstanding: PosCountAmountView;
  cancelled: PosCountAmountView;
}

export interface PosBreakdownRowView {
  key: string;
  label: string;
  quantity: number;
  net: number;
  cost: number | null;
  profit: number | null;
}

export interface PosOwedView {
  orderId: string;
  number: number | null;
  customerName: string | null;
  amount: number;
  since: string;
}

export interface PosReportView {
  fromDay: string;
  toDay: string;
  timeZone: string;
  summary: PosSummaryView;
  previous: PosSummaryView;
  previousFromDay: string;
  previousToDay: string;
  granularity: string;
  series: { key: string; orders: number; sales: number; refunds: number }[];
  byItem: PosBreakdownRowView[];
  byCategory: PosBreakdownRowView[];
  byStaff: PosBreakdownRowView[];
  byHour: { hour: number; orders: number; sales: number }[];
  unpaid: PosOwedView[];
  changeOwed: PosOwedView[];
  truncated: boolean;
}

export interface PosEventView {
  /** `sync`, `catalogue`, `customers`, `settings` or `order`. */
  kind: string;
  orderId: string | null;
  actorId: string | null;
}

/** Which order, at which version: every change names both, and an older version is refused. */
export interface PosOrderRefView {
  id: string;
  version: number;
}

export interface PosItemInput {
  id?: string | null;
  kind: string;
  name: string;
  code?: string | null;
  price: number;
  cost?: number | null;
  categoryId?: string | null;
  variants?: { id?: string | null; name: string; code?: string | null; price: number; cost?: number | null }[] | null;
}

export interface PosPaymentInput {
  method: string;
  received: number;
  tip?: number | null;
  changeOwed?: number | null;
  reference?: string | null;
  clientId: string;
}

export interface PosDiscountInput {
  kind: string;
  value: number;
  reason: string;
}

export interface PosRefundInput {
  lines?: { lineId: string; quantity: number }[] | null;
  amount?: number | null;
  method: string;
  reason: string;
  clientId: string;
}

/** One method per operation. Every error is a sentence for a person. */
export interface PosClient {
  catalogue(scope: PosScopeView, includeArchived?: boolean): Promise<PosCatalogueView>;
  saveItem(scope: PosScopeView, input: PosItemInput): Promise<PosItemView>;
  setItemArchived(scope: PosScopeView, itemId: string, archived: boolean): Promise<PosItemView>;
  saveCategory(
    scope: PosScopeView,
    name: string,
    categoryId?: string | null,
    sortOrder?: number | null,
  ): Promise<PosCategoryView>;
  setCategoryArchived(scope: PosScopeView, categoryId: string, archived: boolean): Promise<PosCategoryView>;
  customers(scope: PosScopeView, search: string, includeArchived?: boolean): Promise<PosCustomerView[]>;
  customer(scope: PosScopeView, customerId: string): Promise<PosCustomerView | null>;
  saveCustomer(
    scope: PosScopeView,
    input: { id?: string | null; name: string; contact?: string | null; note?: string | null },
  ): Promise<PosCustomerView>;
  setCustomerArchived(scope: PosScopeView, customerId: string, archived: boolean): Promise<PosCustomerView>;
  settings(scope: PosScopeView): Promise<PosSettingsView>;
  saveSettings(scope: PosScopeView, timeZone: string, keymap: string | null): Promise<PosSettingsView>;

  orders(scope: PosScopeView, tab: string, search?: string | null): Promise<PosOrderSummaryView[]>;
  order(scope: PosScopeView, orderId: string): Promise<PosOrderView | null>;
  createOrder(scope: PosScopeView, label?: string | null): Promise<PosOrderView>;
  addLine(
    scope: PosScopeView,
    order: PosOrderRefView,
    itemId: string,
    variantId: string | null,
    quantity: number,
  ): Promise<PosOrderView>;
  updateLine(
    scope: PosScopeView,
    order: PosOrderRefView,
    lineId: string,
    input: { quantity?: number | null; note?: string | null },
  ): Promise<PosOrderView>;
  removeLine(scope: PosScopeView, order: PosOrderRefView, lineId: string): Promise<PosOrderView>;
  refreshLine(scope: PosScopeView, order: PosOrderRefView, lineId: string): Promise<PosOrderView>;
  setCustomer(
    scope: PosScopeView,
    order: PosOrderRefView,
    input: { customerId?: string | null; name?: string | null; contact?: string | null },
  ): Promise<PosOrderView>;
  setLabel(scope: PosScopeView, order: PosOrderRefView, label: string | null): Promise<PosOrderView>;
  pay(scope: PosScopeView, order: PosOrderRefView, input: PosPaymentInput): Promise<PosOrderView>;
  payLater(scope: PosScopeView, order: PosOrderRefView): Promise<PosOrderView>;
  cancel(scope: PosScopeView, order: PosOrderRefView, reason: string | null): Promise<PosOrderView>;
  settleChangeOwed(scope: PosScopeView, order: PosOrderRefView, settlement: 'given' | 'tip'): Promise<PosOrderView>;
  setLineDiscount(
    scope: PosScopeView,
    order: PosOrderRefView,
    lineId: string,
    discount: PosDiscountInput | null,
  ): Promise<PosOrderView>;
  setOrderDiscount(
    scope: PosScopeView,
    order: PosOrderRefView,
    discount: PosDiscountInput | null,
  ): Promise<PosOrderView>;
  refund(scope: PosScopeView, orderId: string, input: PosRefundInput): Promise<PosOrderView>;
  void(scope: PosScopeView, order: PosOrderRefView, reason: string): Promise<PosOrderView>;
  report(scope: PosScopeView, fromDay: string, toDay: string): Promise<PosReportView>;
}

export function createPosClient(options: { graphqlPath?: string } = {}): PosClient {
  const path = options.graphqlPath ?? DEFAULT_GRAPHQL_PATH;

  /**
   * One request shape for every call, answering the operation's own field.
   * Throws the API's FIRST error message: the refusals are written for a
   * reader, and one — the conflict — is what the till compares against.
   */
  async function call<T>(
    operation: Exclude<PosOperationName, 'posEvents'>,
    scope: PosScopeView,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          query: POS_OPERATIONS[operation],
          variables: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, ...variables },
        }),
        cache: 'no-store',
      });
    } catch {
      // ⚠ The till is ONLINE ONLY (POS-PLAN §1): say so, never pretend it saved.
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

  const ref = (order: PosOrderRefView) => ({ orderId: order.id, version: order.version });

  return {
    catalogue: (scope, includeArchived = false) => call('posCatalogue', scope, { includeArchived }),
    saveItem: (scope, input) => call('savePosItem', scope, { input }),
    setItemArchived: (scope, itemId, archived) => call('setPosItemArchived', scope, { itemId, archived }),
    saveCategory: (scope, name, categoryId = null, sortOrder = null) =>
      call('savePosCategory', scope, { name, categoryId, sortOrder }),
    setCategoryArchived: (scope, categoryId, archived) =>
      call('setPosCategoryArchived', scope, { categoryId, archived }),
    customers: (scope, search, includeArchived = false) => call('posCustomers', scope, { search, includeArchived }),
    customer: (scope, customerId) => call('posCustomer', scope, { customerId }),
    saveCustomer: (scope, input) => call('savePosCustomer', scope, { input }),
    setCustomerArchived: (scope, customerId, archived) =>
      call('setPosCustomerArchived', scope, { customerId, archived }),
    settings: (scope) => call('posSettings', scope),
    saveSettings: (scope, timeZone, keymap) => call('savePosSettings', scope, { timeZone, keymap }),

    orders: (scope, tab, search = null) => call('posOrders', scope, { tab, search }),
    order: (scope, orderId) => call('posOrder', scope, { orderId }),
    createOrder: (scope, label = null) => call('createPosOrder', scope, { label }),
    addLine: (scope, order, itemId, variantId, quantity) =>
      call('addPosOrderLine', scope, { ...ref(order), itemId, variantId, quantity }),
    updateLine: (scope, order, lineId, input) =>
      call('updatePosOrderLine', scope, {
        ...ref(order),
        lineId,
        quantity: input.quantity ?? null,
        note: input.note ?? null,
      }),
    removeLine: (scope, order, lineId) => call('removePosOrderLine', scope, { ...ref(order), lineId }),
    refreshLine: (scope, order, lineId) => call('refreshPosOrderLine', scope, { ...ref(order), lineId }),
    setCustomer: (scope, order, input) =>
      call('setPosOrderCustomer', scope, {
        ...ref(order),
        customerId: input.customerId ?? null,
        name: input.name ?? null,
        contact: input.contact ?? null,
      }),
    setLabel: (scope, order, label) => call('setPosOrderLabel', scope, { ...ref(order), label }),
    pay: (scope, order, input) => call('payPosOrder', scope, { ...ref(order), input }),
    payLater: (scope, order) => call('payLaterPosOrder', scope, ref(order)),
    cancel: (scope, order, reason) => call('cancelPosOrder', scope, { ...ref(order), reason }),
    settleChangeOwed: (scope, order, settlement) => call('settlePosChangeOwed', scope, { ...ref(order), settlement }),
    setLineDiscount: (scope, order, lineId, discount) =>
      call('setPosLineDiscount', scope, { ...ref(order), lineId, discount }),
    setOrderDiscount: (scope, order, discount) => call('setPosOrderDiscount', scope, { ...ref(order), discount }),
    refund: (scope, orderId, input) => call('refundPosOrder', scope, { orderId, input }),
    void: (scope, order, reason) => call('voidPosOrder', scope, { ...ref(order), reason }),
    report: (scope, fromDay, toDay) => call('posReport', scope, { fromDay, toDay }),
  };
}
