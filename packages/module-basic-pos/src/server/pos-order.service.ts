import { escapeLikePattern, nextDayKey, zonedDayKey, zonedStartOfDay } from '@kwtech/module-kit';
import { Inject, Injectable } from '@nestjs/common';
import { POS_ORDERS_READ_MAX } from '../domain/orders.js';
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

/** The tabs of the Orders section (D23). */
export type PosOrderTab = 'today' | 'pending' | 'unpaid' | 'change_owed' | 'cancelled' | 'all';

export const POS_ORDER_TABS = [
  'today',
  'pending',
  'unpaid',
  'change_owed',
  'cancelled',
  'all',
] as const satisfies readonly PosOrderTab[];

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
 * Reading orders: the Orders section's tabs, and one order with its lines and
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
   * One tab of the Orders section.
   *
   *   today       — paid, released unpaid or cancelled on the store's today
   *   pending     — open: held carts, oldest first
   *   unpaid      — the customer owes the store, oldest first
   *   change_owed — the store owes the customer, oldest first
   *   cancelled   — the most recent cancellations, with their reasons
   *   all         — the most recent orders
   *
   * `search` narrows by order number, customer name or label; `customerId` to
   * one recorded customer's orders (their history, D5). Only a LINKED order
   * is theirs: a walk-in who typed the same name is somebody else.
   */
  async list(
    scope: InScope,
    tab: PosOrderTab,
    search: string,
    now: Date,
    customerId: string | null = null,
  ): Promise<PosOrderListEntry[]> {
    const where = await this.whereFor(scope, tab, now);
    if (customerId) where.customerId = customerId;
    const term = search.trim();
    if (term) {
      const match = { contains: escapeLikePattern(term), mode: 'insensitive' as const };
      const number = /^#?\d{1,9}$/u.test(term) ? Number(term.replace('#', '')) : null;
      const searchOr: NonNullable<PosOrderListWhere['OR']> = [{ customerName: match }, { label: match }];
      if (number !== null) searchOr.push({ number });
      // ⚠ `today` already uses OR for its three moments; search narrows it
      // afterwards rather than mixing two ORs into one.
      if (!where.OR) where.OR = searchOr;
    }
    const oldestFirst = tab === 'pending' || tab === 'unpaid' || tab === 'change_owed';
    const orders = await this.prisma.posOrder.findMany({
      where,
      orderBy: oldestFirst ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }],
      take: POS_ORDERS_READ_MAX,
    });
    const narrowed = term && tab === 'today' ? orders.filter((order) => matchesSearch(order, term)) : orders;
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

  private async whereFor(scope: InScope, tab: PosOrderTab, now: Date): Promise<PosOrderListWhere> {
    switch (tab) {
      case 'pending':
        return { ...scope, status: 'open' };
      case 'unpaid':
        return { ...scope, status: 'unpaid' };
      case 'change_owed':
        return { ...scope, status: 'paid', changeOwed: { gt: 0 }, changeSettledAt: null };
      case 'cancelled':
        return { ...scope, status: 'cancelled' };
      case 'all':
        return { ...scope };
      case 'today': {
        const timeZone = await this.zones.of(scope);
        const today = zonedDayKey(now, timeZone);
        const from = zonedStartOfDay(today, timeZone) ?? now;
        const to = zonedStartOfDay(nextDayKey(today), timeZone) ?? now;
        const range = { gte: from, lt: to };
        return { ...scope, OR: [{ paidAt: range }, { finalisedAt: range }, { cancelledAt: range }] };
      }
    }
  }
}

function matchesSearch(order: PosOrderRow, term: string): boolean {
  const needle = term.toLowerCase().replace(/^#/u, '');
  if (order.number !== null && String(order.number) === needle) return true;
  return [order.customerName, order.label].some((text) => text?.toLowerCase().includes(needle));
}
