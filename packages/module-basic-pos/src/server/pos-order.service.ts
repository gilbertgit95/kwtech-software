import { escapeLikePattern, nextDayKey, zonedStartOfDay } from '@kwtech/module-kit';
import { Inject, Injectable } from '@nestjs/common';
import { POS_ORDERS_READ_MAX } from '../domain/orders.js';
import { POS_REPORT_DAYS_MAX, periodDayCount } from '../domain/reports.js';
import type { PosOrderStatus } from '../types.js';
import { type PosWriteError, refusalError } from './pos.errors.js';
import { linesOf } from './pos.lookup.js';
import type {
  InScope,
  PosOrderLineRow,
  PosOrderListWhere,
  PosOrderRow,
  PosRefundLineRow,
  PosRefundRow,
  PosWriteClient,
} from './pos.repository.js';
import { POS_PRISMA_WRITE } from './pos.tokens.js';
import { PosTimeZoneService } from './pos-time-zone.service.js';

/**
 * The Orders section's status filter (D23). Still called `tab` on the wire: it
 * was one tab of six until the days became a filter of their own (`PosOrderDays`).
 */
export type PosOrderTab = 'all' | 'paid' | 'pending' | 'unpaid' | 'change_owed' | 'cancelled';

export const POS_ORDER_TABS = [
  'all',
  'paid',
  'pending',
  'unpaid',
  'change_owed',
  'cancelled',
] as const satisfies readonly PosOrderTab[];

/** The store days a list is narrowed to, inclusive (`YYYY-MM-DD`, the workspace's days). */
export interface PosOrderDays {
  fromDay: string;
  toDay: string;
}

export function isPosOrderTab(value: unknown): value is PosOrderTab {
  return (POS_ORDER_TABS as readonly unknown[]).includes(value);
}

/** One order with everything its receipt and its refunds need. */
export interface PosOrderDetail {
  order: PosOrderRow;
  lines: readonly PosOrderLineRow[];
  refunds: readonly PosRefundRow[];
  refundLines: readonly PosRefundLineRow[];
}

/** A list row: the order and its lines (for the item count), without refunds. */
export interface PosOrderListEntry {
  order: PosOrderRow;
  lines: readonly PosOrderLineRow[];
  refunded: number;
}

/**
 * Reading orders: the Orders section's list, and one order with its lines and
 * refunds. Bound to `pos:read`. Every read names the store; costs are stripped
 * by the resolver, not here.
 */
@Injectable()
export class PosOrderService {
  constructor(
    @Inject(POS_PRISMA_WRITE) private readonly prisma: PosWriteClient,
    private readonly zones: PosTimeZoneService,
  ) {}

  /**
   * The Orders section's list: a status, and optionally the store's days.
   *
   *   all         — the most recent orders
   *   paid        — paid, whatever became of them since (refunded, change owed)
   *   pending     — open AND held (Hold was pressed), oldest first
   *   unpaid      — the customer owes the store, oldest first
   *   change_owed — the store owes the customer, oldest first
   *   cancelled   — the most recent cancellations, with their reasons
   *
   * `days` narrows it to what HAPPENED on those store days, each status by its
   * own moment: paid on them, released unpaid on them, held on them, cancelled
   * on them — and `all` by any of the four, so a day lists what the day did.
   * Without `days` nothing is narrowed by date: that is how the till's pending
   * list and the Orders badge ask what is still outstanding, however old.
   *
   * ⚠ A CART STILL BEING BUILT IS IN NONE OF THEM. An order is saved from its
   * first line (§3), but until Hold sets it aside (`heldAt`) it is one till's
   * cart, not an order the store is waiting on. Listing it made every item
   * tried at the till a "pending order" (the operator, 2026-10-03).
   *
   * `search` narrows by order number, customer name or label; `customerId` to
   * one recorded customer's orders (their history, D5). Only a LINKED order
   * is theirs: a walk-in who typed the same name is somebody else.
   */
  async list(
    scope: InScope,
    tab: PosOrderTab,
    search: string,
    days: PosOrderDays | null = null,
    customerId: string | null = null,
  ): Promise<PosOrderListEntry[]> {
    const where = this.whereFor(scope, tab, days ? await this.rangeOf(scope, days) : null);
    // A list that already spends its OR (`all`: the day's four moments, or "not an unheld cart") is searched in memory below.
    const ownOr = where.OR !== undefined;
    if (customerId) where.customerId = customerId;
    const term = search.trim();
    if (term) {
      const match = { contains: escapeLikePattern(term), mode: 'insensitive' as const };
      const number = /^#?\d{1,9}$/u.test(term) ? Number(term.replace('#', '')) : null;
      const searchOr: NonNullable<PosOrderListWhere['OR']> = [{ customerName: match }, { label: match }];
      if (number !== null) searchOr.push({ number });
      // ⚠ Search narrows such a tab afterwards rather than mixing two ORs into one.
      if (!ownOr) where.OR = searchOr;
    }
    const oldestFirst = tab === 'pending' || tab === 'unpaid' || tab === 'change_owed';
    const orders = await this.prisma.posOrder.findMany({
      where,
      orderBy: oldestFirst ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }],
      take: POS_ORDERS_READ_MAX,
    });
    const narrowed = term && ownOr ? orders.filter((order) => matchesSearch(order, term)) : orders;
    if (narrowed.length === 0) return [];
    const ids = narrowed.map((order) => order.id);
    const [lines, refunds] = await Promise.all([
      this.prisma.posOrderLine.findMany({
        where: { orderId: { in: ids } },
        orderBy: [{ orderId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.posRefund.findMany({
        where: { ...scope, orderId: { in: ids } },
        orderBy: [{ refundedAt: 'asc' }, { id: 'asc' }],
        take: POS_ORDERS_READ_MAX * 10,
      }),
    ]);
    return narrowed.map((order) => ({
      order,
      lines: lines.filter((line) => line.orderId === order.id),
      refunded: refunds.filter((refund) => refund.orderId === order.id).reduce((sum, refund) => sum + refund.amount, 0),
    }));
  }

  /** One order in this store, with its lines and refunds, or null. */
  async get(scope: InScope, orderId: string): Promise<PosOrderDetail | null> {
    const order = await this.prisma.posOrder.findFirst({ where: { ...scope, id: orderId } });
    if (!order) return null;
    const [lines, refunds] = await Promise.all([
      linesOf(this.prisma, order.id),
      this.prisma.posRefund.findMany({
        where: { ...scope, orderId: order.id },
        orderBy: [{ refundedAt: 'asc' }, { id: 'asc' }],
        take: 1000,
      }),
    ]);
    const refundLines = refunds.length
      ? await this.prisma.posRefundLine.findMany({ where: { refundId: { in: refunds.map((refund) => refund.id) } } })
      : [];
    return { order, lines, refunds, refundLines };
  }

  /**
   * Store days as instants: `[start of fromDay, start of the day after toDay)`
   * in the WORKSPACE's zone, so "today" is the store's today wherever the
   * server runs. Refused (`invalid_period`) for days that are not a period.
   */
  private async rangeOf(scope: InScope, days: PosOrderDays): Promise<DayRange> {
    if (periodDayCount(days.fromDay, days.toDay) === null) throw invalidPeriod();
    const timeZone = await this.zones.of(scope);
    const gte = zonedStartOfDay(days.fromDay, timeZone);
    const lt = zonedStartOfDay(nextDayKey(days.toDay), timeZone);
    if (!gte || !lt) throw invalidPeriod();
    return { gte, lt };
  }

  private whereFor(scope: InScope, tab: PosOrderTab, range: DayRange | null): PosOrderListWhere {
    switch (tab) {
      case 'paid':
        return { ...scope, status: 'paid', ...(range ? { paidAt: range } : {}) };
      case 'pending':
        return { ...scope, status: 'open', heldAt: range ?? { not: null } };
      case 'unpaid':
        return { ...scope, status: 'unpaid', ...(range ? { finalisedAt: range } : {}) };
      case 'change_owed':
        return {
          ...scope,
          status: 'paid',
          changeOwed: { gt: 0 },
          changeSettledAt: null,
          ...(range ? { paidAt: range } : {}),
        };
      case 'cancelled':
        return { ...scope, status: 'cancelled', ...(range ? { cancelledAt: range } : {}) };
      case 'all':
        // Everything but a cart nobody has held: finished orders, and open ones that were set aside.
        if (!range) return { ...scope, OR: [{ status: { in: [...FINISHED_STATUSES] } }, { heldAt: { not: null } }] };
        // ⚠ `status: 'open'` beside `heldAt`: an order held on Monday and paid on Tuesday is Tuesday's, not both days'.
        return {
          ...scope,
          OR: [{ paidAt: range }, { finalisedAt: range }, { cancelledAt: range }, { status: 'open', heldAt: range }],
        };
    }
  }
}

/** From (inclusive) to (exclusive), as instants. */
interface DayRange {
  gte: Date;
  lt: Date;
}

function invalidPeriod(): PosWriteError {
  return refusalError('invalid_period', { maxDays: POS_REPORT_DAYS_MAX });
}

/** Every status but `open`: an order that was numbered or cancelled, whatever became of it. */
const FINISHED_STATUSES = ['unpaid', 'paid', 'cancelled', 'voided'] as const satisfies readonly PosOrderStatus[];

function matchesSearch(order: PosOrderRow, term: string): boolean {
  const needle = term.toLowerCase().replace(/^#/u, '');
  if (order.number !== null && String(order.number) === needle) return true;
  return [order.customerName, order.label].some((text) => text?.toLowerCase().includes(needle));
}
