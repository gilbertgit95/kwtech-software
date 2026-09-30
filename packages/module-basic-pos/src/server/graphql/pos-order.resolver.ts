import { declareScope, REQUIRED_SCOPE_METADATA } from '@kwtech/module-kit';
import { Inject, SetMetadata } from '@nestjs/common';
import { Args, Context, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { refundState } from '../../domain/refunds.js';
import type { PosSummary } from '../../domain/reports.js';
import { PosWriteError, refusalError } from '../pos.errors.js';
import { storedDiscount } from '../pos.lookup.js';
import type { PosModuleOptions } from '../pos.options.js';
import type { InScope, PosOrderLineRow, PosOrderRow } from '../pos.repository.js';
import { POS_OPTIONS } from '../pos.tokens.js';
import { PosAccessService } from '../pos-access.service.js';
import { isPosOrderTab, type PosOrderDetail, type PosOrderListEntry, PosOrderService } from '../pos-order.service.js';
import { type PosOrderRef, PosOrderWriteService } from '../pos-order-write.service.js';
import { PosRefundService } from '../pos-refund.service.js';
import { type PosReport, PosReportService } from '../pos-report.service.js';
import {
  PayPosOrderInputType,
  PosDiscountInputType,
  type PosDiscountType,
  PosOrderSummaryType,
  PosOrderType,
  PosReportType,
  type PosSummaryType,
  RefundPosOrderInputType,
} from './pos.types.js';

/**
 * Orders — selling, paying, ending, refunding — and the reports.
 *
 * ## ⚠ THE SCOPE IS DECLARED ON THE CLASS (see `PosCatalogueResolver`)
 *
 * ## Where the guard is
 *
 * Every operation is guarded by its BINDING in `POS_FEATURE_REGISTRY`: selling
 * by `pos:sell`, discounts by `pos:discount`, refunds and voids by
 * `pos:refund`, the report by `pos:reports`. The services find every order BY
 * ID AND SCOPE, and every change names the VERSION the till saw.
 */
@SetMetadata(REQUIRED_SCOPE_METADATA, declareScope('workspace'))
@Resolver()
export class PosOrderResolver {
  constructor(
    private readonly orders: PosOrderService,
    private readonly writes: PosOrderWriteService,
    private readonly refunds: PosRefundService,
    private readonly reports: PosReportService,
    private readonly access: PosAccessService,
    @Inject(POS_OPTIONS) private readonly options: PosModuleOptions,
  ) {}

  // ── reading ───────────────────────────────────────────────────────────────

  /** One tab of the Orders section: `today`, `pending`, `unpaid`, `change_owed`, `cancelled` or `all`. */
  @Query(() => [PosOrderSummaryType], { name: 'posOrders' })
  async posOrders(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('tab') tab: string,
    @Args('search', { type: () => String, nullable: true }) search?: string | null,
    @Args('customerId', { type: () => String, nullable: true }) customerId?: string | null,
  ): Promise<PosOrderSummaryType[]> {
    if (!isPosOrderTab(tab)) throw refusalError('not_found');
    const scope = { organizationId, workspaceId };
    const rows = await this.orders.list(scope, tab, search ?? '', new Date(), customerId ?? null);
    return rows.map(renderSummary);
  }

  /** Null for an order that is not in this store. */
  @Query(() => PosOrderType, { name: 'posOrder', nullable: true })
  async posOrder(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('orderId') orderId: string,
  ): Promise<PosOrderType | null> {
    const scope = { organizationId, workspaceId };
    const detail = await this.orders.get(scope, orderId);
    if (!detail) return null;
    return renderOrder(detail, await this.access.seesCosts(scope, this.actor(gql.req)));
  }

  // ── selling (pos:sell) ────────────────────────────────────────────────────

  @Mutation(() => PosOrderType, { name: 'createPosOrder' })
  async createPosOrder(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('label', { type: () => String, nullable: true }) label?: string | null,
  ): Promise<PosOrderType> {
    const scope = { organizationId, workspaceId };
    const actorId = this.actor(gql.req);
    const order = await this.writes.create(scope, actorId, label ?? null);
    return this.render(scope, actorId, order.id);
  }

  /** Omit `variantId` for an item without variants. The same plain line again adds to its quantity. */
  @Mutation(() => PosOrderType, { name: 'addPosOrderLine' })
  async addPosOrderLine(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('orderId') orderId: string,
    @Args('version', { type: () => Int }) version: number,
    @Args('itemId') itemId: string,
    @Args('quantity', { type: () => Int }) quantity: number,
    @Args('variantId', { type: () => String, nullable: true }) variantId?: string | null,
  ): Promise<PosOrderType> {
    return this.write(gql, organizationId, workspaceId, { orderId, version }, (scope, actorId, ref) =>
      this.writes.addLine(scope, actorId, ref, { itemId, variantId, quantity }),
    );
  }

  /** A new quantity drops fixed discounts when you may not give discounts yourself. */
  @Mutation(() => PosOrderType, { name: 'updatePosOrderLine' })
  async updatePosOrderLine(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('orderId') orderId: string,
    @Args('version', { type: () => Int }) version: number,
    @Args('lineId') lineId: string,
    @Args('quantity', { type: () => Int, nullable: true }) quantity?: number | null,
    @Args('note', { type: () => String, nullable: true }) note?: string | null,
  ): Promise<PosOrderType> {
    return this.write(gql, organizationId, workspaceId, { orderId, version }, (scope, actorId, ref) =>
      this.writes.updateLine(scope, actorId, ref, lineId, { quantity, note }),
    );
  }

  @Mutation(() => PosOrderType, { name: 'removePosOrderLine' })
  async removePosOrderLine(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('orderId') orderId: string,
    @Args('version', { type: () => Int }) version: number,
    @Args('lineId') lineId: string,
  ): Promise<PosOrderType> {
    return this.write(gql, organizationId, workspaceId, { orderId, version }, (scope, actorId, ref) =>
      this.writes.removeLine(scope, actorId, ref, lineId),
    );
  }

  /** Re-copies the line from the item as it is now: "Price is now ₱50 · Update". */
  @Mutation(() => PosOrderType, { name: 'refreshPosOrderLine' })
  async refreshPosOrderLine(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('orderId') orderId: string,
    @Args('version', { type: () => Int }) version: number,
    @Args('lineId') lineId: string,
  ): Promise<PosOrderType> {
    return this.write(gql, organizationId, workspaceId, { orderId, version }, (scope, actorId, ref) =>
      this.writes.refreshLine(scope, actorId, ref, lineId),
    );
  }

  /** A recorded customer (`customerId`), or free text, or neither for a walk-in. */
  @Mutation(() => PosOrderType, { name: 'setPosOrderCustomer' })
  async setPosOrderCustomer(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('orderId') orderId: string,
    @Args('version', { type: () => Int }) version: number,
    @Args('customerId', { type: () => String, nullable: true }) customerId?: string | null,
    @Args('name', { type: () => String, nullable: true }) name?: string | null,
    @Args('contact', { type: () => String, nullable: true }) contact?: string | null,
  ): Promise<PosOrderType> {
    return this.write(gql, organizationId, workspaceId, { orderId, version }, (scope, actorId, ref) =>
      this.writes.setCustomer(scope, actorId, ref, { customerId, name, contact }),
    );
  }

  @Mutation(() => PosOrderType, { name: 'setPosOrderLabel' })
  async setPosOrderLabel(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('orderId') orderId: string,
    @Args('version', { type: () => Int }) version: number,
    @Args('label', { type: () => String, nullable: true }) label?: string | null,
  ): Promise<PosOrderType> {
    return this.write(gql, organizationId, workspaceId, { orderId, version }, (scope, actorId, ref) =>
      this.writes.setLabel(scope, actorId, ref, label ?? null),
    );
  }

  /** Idempotent on `input.clientId`: a retry answers with the order it already paid. */
  @Mutation(() => PosOrderType, { name: 'payPosOrder' })
  async payPosOrder(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('orderId') orderId: string,
    @Args('version', { type: () => Int }) version: number,
    @Args('input', { type: () => PayPosOrderInputType }) input: PayPosOrderInputType,
  ): Promise<PosOrderType> {
    return this.write(gql, organizationId, workspaceId, { orderId, version }, (scope, actorId, ref) =>
      this.writes.pay(scope, actorId, ref, { ...input }),
    );
  }

  /** Needs the customer's name and contact on the order. */
  @Mutation(() => PosOrderType, { name: 'payLaterPosOrder' })
  async payLaterPosOrder(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('orderId') orderId: string,
    @Args('version', { type: () => Int }) version: number,
  ): Promise<PosOrderType> {
    return this.write(gql, organizationId, workspaceId, { orderId, version }, (scope, actorId, ref) =>
      this.writes.payLater(scope, actorId, ref),
    );
  }

  /** A reason is required once the order has lines. */
  @Mutation(() => PosOrderType, { name: 'cancelPosOrder' })
  async cancelPosOrder(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('orderId') orderId: string,
    @Args('version', { type: () => Int }) version: number,
    @Args('reason', { type: () => String, nullable: true }) reason?: string | null,
  ): Promise<PosOrderType> {
    return this.write(gql, organizationId, workspaceId, { orderId, version }, (scope, actorId, ref) =>
      this.writes.cancel(scope, actorId, ref, reason ?? null),
    );
  }

  /** `given` (handed over) or `tip` (the customer said keep it). */
  @Mutation(() => PosOrderType, { name: 'settlePosChangeOwed' })
  async settlePosChangeOwed(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('orderId') orderId: string,
    @Args('version', { type: () => Int }) version: number,
    @Args('settlement') settlement: string,
  ): Promise<PosOrderType> {
    return this.write(gql, organizationId, workspaceId, { orderId, version }, (scope, actorId, ref) =>
      this.writes.settleChangeOwed(scope, actorId, ref, settlement),
    );
  }

  // ── discounts (pos:discount) ──────────────────────────────────────────────

  /** Omit `discount` to remove the line's discount. */
  @Mutation(() => PosOrderType, { name: 'setPosLineDiscount' })
  async setPosLineDiscount(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('orderId') orderId: string,
    @Args('version', { type: () => Int }) version: number,
    @Args('lineId') lineId: string,
    @Args('discount', { type: () => PosDiscountInputType, nullable: true }) discount?: PosDiscountInputType | null,
  ): Promise<PosOrderType> {
    return this.write(gql, organizationId, workspaceId, { orderId, version }, (scope, actorId, ref) =>
      this.writes.setLineDiscount(scope, actorId, ref, lineId, discount ? { ...discount } : null),
    );
  }

  /** Omit `discount` to remove the order's discount. */
  @Mutation(() => PosOrderType, { name: 'setPosOrderDiscount' })
  async setPosOrderDiscount(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('orderId') orderId: string,
    @Args('version', { type: () => Int }) version: number,
    @Args('discount', { type: () => PosDiscountInputType, nullable: true }) discount?: PosDiscountInputType | null,
  ): Promise<PosOrderType> {
    return this.write(gql, organizationId, workspaceId, { orderId, version }, (scope, actorId, ref) =>
      this.writes.setOrderDiscount(scope, actorId, ref, discount ? { ...discount } : null),
    );
  }

  // ── refunds and voids (pos:refund) ────────────────────────────────────────

  /** Idempotent on `input.clientId`. The order never changes: the refund is its own record. */
  @Mutation(() => PosOrderType, { name: 'refundPosOrder' })
  async refundPosOrder(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('orderId') orderId: string,
    @Args('input', { type: () => RefundPosOrderInputType }) input: RefundPosOrderInputType,
  ): Promise<PosOrderType> {
    const scope = { organizationId, workspaceId };
    const actorId = this.actor(gql.req);
    await this.refunds.refund(scope, actorId, orderId, { ...input });
    return this.render(scope, actorId, orderId);
  }

  @Mutation(() => PosOrderType, { name: 'voidPosOrder' })
  async voidPosOrder(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('orderId') orderId: string,
    @Args('version', { type: () => Int }) version: number,
    @Args('reason') reason: string,
  ): Promise<PosOrderType> {
    return this.write(gql, organizationId, workspaceId, { orderId, version }, (scope, actorId, ref) =>
      this.writes.void(scope, actorId, ref, reason),
    );
  }

  // ── reports (pos:reports) ─────────────────────────────────────────────────

  /** Store days, inclusive, `YYYY-MM-DD`: the dashboard and every report table. */
  @Query(() => PosReportType, { name: 'posReport' })
  async posReport(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('fromDay') fromDay: string,
    @Args('toDay') toDay: string,
  ): Promise<PosReportType> {
    return renderReport(await this.reports.report({ organizationId, workspaceId }, fromDay, toDay));
  }

  // ── plumbing ──────────────────────────────────────────────────────────────

  private async write(
    gql: { req?: unknown },
    organizationId: string,
    workspaceId: string,
    ref: PosOrderRef,
    act: (scope: InScope, actorId: string, ref: PosOrderRef) => Promise<PosOrderRow>,
  ): Promise<PosOrderType> {
    const scope = { organizationId, workspaceId };
    const actorId = this.actor(gql.req);
    const order = await act(scope, actorId, ref);
    return this.render(scope, actorId, order.id);
  }

  private async render(scope: InScope, viewerId: string, orderId: string): Promise<PosOrderType> {
    const [detail, costsVisible] = await Promise.all([
      this.orders.get(scope, orderId),
      this.access.seesCosts(scope, viewerId),
    ]);
    if (!detail) throw refusalError('not_found');
    return renderOrder(detail, costsVisible);
  }

  private actor(request: unknown): string {
    const actorId = this.options.resolveActorId?.(request);
    if (!actorId) throw new PosWriteError('not_permitted', 'Not signed in');
    return actorId;
  }
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);

function renderDiscount(row: {
  discountKind: 'amount' | 'percent' | null;
  discountValue: number | null;
  discountReason: string | null;
  discountById: string | null;
  discountAt: Date | null;
}): PosDiscountType | null {
  const discount = storedDiscount(row);
  if (!discount) return null;
  return {
    kind: discount.kind,
    value: discount.value,
    reason: row.discountReason ?? '',
    givenById: row.discountById,
    givenAt: iso(row.discountAt),
  };
}

/** ⚠ `costsVisible` false strips every line's unit cost (guard rules). */
export function renderOrder(detail: PosOrderDetail, costsVisible: boolean): PosOrderType {
  const { order } = detail;
  const refunded = detail.refunds.reduce((sum, refund) => sum + refund.amount, 0);
  const refundedUnits = new Map<string, number>();
  for (const line of detail.refundLines) {
    refundedUnits.set(line.orderLineId, (refundedUnits.get(line.orderLineId) ?? 0) + line.quantity);
  }
  return {
    id: order.id,
    status: order.status,
    version: order.version,
    number: order.number,
    label: order.label,
    customerId: order.customerId,
    customerName: order.customerName,
    customerContact: order.customerContact,
    lines: detail.lines.map((line) => renderLine(line, costsVisible, refundedUnits.get(line.id) ?? 0)),
    gross: order.gross,
    lineDiscounts: order.lineDiscounts,
    subtotal: order.subtotal,
    discount: renderDiscount(order),
    orderDiscount: order.orderDiscount,
    total: order.total,
    paymentMethod: order.paymentMethod,
    received: order.received,
    change: order.change,
    tip: order.tip,
    paymentReference: order.paymentReference,
    changeOwed: order.changeOwed,
    changeSettlement: order.changeSettlement,
    changeSettledAt: iso(order.changeSettledAt),
    refunds: detail.refunds.map((refund) => ({
      id: refund.id,
      amount: refund.amount,
      method: refund.method,
      reason: refund.reason,
      refundedById: refund.refundedById,
      refundedAt: refund.refundedAt.toISOString(),
    })),
    refunded,
    refundState: refundState(order.total, refunded),
    createdById: order.createdById,
    createdAt: order.createdAt.toISOString(),
    finalisedAt: iso(order.finalisedAt),
    finalisedById: order.finalisedById,
    releasedUnpaid: order.releasedUnpaid,
    paidAt: iso(order.paidAt),
    paidById: order.paidById,
    cancelledAt: iso(order.cancelledAt),
    cancelReason: order.cancelReason,
    voidedAt: iso(order.voidedAt),
    voidReason: order.voidReason,
  };
}

function renderLine(line: PosOrderLineRow, costsVisible: boolean, refundedQuantity: number) {
  return {
    id: line.id,
    itemId: line.itemId,
    variantId: line.variantId,
    name: line.name,
    kind: line.kind,
    variantName: line.variantName,
    code: line.code,
    categoryName: line.categoryName,
    unitPrice: line.unitPrice,
    unitCost: costsVisible ? line.unitCost : null,
    quantity: line.quantity,
    note: line.note,
    discount: renderDiscount(line),
    discountAmount: line.discountAmount,
    gross: line.gross,
    total: line.total,
    net: line.net,
    refundedQuantity,
  };
}

function renderSummary(entry: PosOrderListEntry): PosOrderSummaryType {
  const { order } = entry;
  return {
    id: order.id,
    status: order.status,
    version: order.version,
    number: order.number,
    label: order.label,
    customerName: order.customerName,
    itemCount: entry.lines.reduce((sum, line) => sum + line.quantity, 0),
    total: order.total,
    changeOwed: order.changeSettledAt ? 0 : order.changeOwed,
    refunded: entry.refunded,
    createdAt: order.createdAt.toISOString(),
    finalisedAt: iso(order.finalisedAt),
    finalisedById: order.finalisedById,
    paidAt: iso(order.paidAt),
    cancelReason: order.cancelReason,
  };
}

function renderSummaryFigures(summary: PosSummary): PosSummaryType {
  return {
    orders: summary.orders,
    gross: summary.gross,
    discounts: summary.discounts,
    refunds: summary.refunds,
    netSales: summary.netSales,
    averageOrder: summary.averageOrder,
    tips: summary.tips,
    cash: summary.byMethod.cash,
    ewallet: summary.byMethod.ewallet,
    card: summary.byMethod.card,
    cashExpected: summary.cashExpected,
    profit: summary.profit,
    costCoverage: summary.costCoverage,
    unpaidReleased: summary.unpaidReleased,
    unpaidCollected: summary.unpaidCollected,
    changeOwedOutstanding: summary.changeOwedOutstanding,
    cancelled: summary.cancelled,
  };
}

function renderReport(report: PosReport): PosReportType {
  const owed = (rows: PosReport['outstanding']['unpaid']) =>
    rows.map((row) => ({ ...row, since: row.since.toISOString() }));
  return {
    fromDay: report.fromDay,
    toDay: report.toDay,
    timeZone: report.timeZone,
    summary: renderSummaryFigures(report.summary),
    previous: renderSummaryFigures(report.previous),
    previousFromDay: report.previousFromDay,
    previousToDay: report.previousToDay,
    granularity: report.granularity,
    series: [...report.series],
    byItem: [...report.byItem],
    byCategory: [...report.byCategory],
    byStaff: report.byStaff.map((row) => ({ ...row, label: row.name ?? '' })),
    byHour: [...report.byHour],
    unpaid: owed(report.outstanding.unpaid),
    changeOwed: owed(report.outstanding.changeOwed),
    truncated: report.truncated,
  };
}
