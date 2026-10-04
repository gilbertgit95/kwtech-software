import { nextDayKey, zonedStartOfDay } from '@kwtech/module-kit';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  outstanding,
  POS_REPORT_DAYS_MAX,
  type PosBreakdownRow,
  type PosOutstanding,
  type PosPeriod,
  type PosReportOrder,
  type PosReportRefund,
  type PosSeriesPoint,
  type PosSummary,
  periodDayCount,
  salesByCategory,
  salesByHour,
  salesByItem,
  salesByStaff,
  salesSeries,
  shiftDayKey,
  summarize,
} from '../domain/reports.js';
import type { PosMemberDirectory } from './ports.js';
import { type PosWriteError, refusalError } from './pos.errors.js';
import type { InScope, PosOrderLineRow, PosOrderRow, PosRefundRow, PosWriteClient } from './pos.repository.js';
import { POS_MEMBER_DIRECTORY, POS_PRISMA_WRITE } from './pos.tokens.js';
import { PosTimeZoneService } from './pos-time-zone.service.js';

/** How many orders one report reads. Past it the report says it is TRUNCATED rather than quietly wrong. */
export const POS_REPORT_ORDERS_MAX = 20_000;

export interface PosReport {
  /** The store days asked for, inclusive, as `YYYY-MM-DD`. */
  fromDay: string;
  toDay: string;
  timeZone: string;
  summary: PosSummary;
  /**
   * The period to compare with (D22): for one day, the SAME WEEKDAY LAST WEEK —
   * Tuesday against last Tuesday, because weekdays differ; for longer, the
   * same number of days just before.
   */
  previous: PosSummary;
  previousFromDay: string;
  previousToDay: string;
  series: readonly PosSeriesPoint[];
  /**
   * The comparison period's series, bucketed the same way, so the dashboard
   * draws it as the faint line under this period's columns (D22). Its keys
   * are ITS days; the page lines them up by position, not by date.
   */
  previousSeries: readonly PosSeriesPoint[];
  granularity: 'day' | 'month';
  byItem: readonly PosBreakdownRow[];
  byCategory: readonly PosBreakdownRow[];
  byStaff: readonly (PosBreakdownRow & { name: string | null })[];
  byHour: readonly { hour: number; orders: number; sales: number }[];
  outstanding: PosOutstanding;
  /** True when a period held more than `POS_REPORT_ORDERS_MAX` orders: the figures are a lower bound. */
  truncated: boolean;
}

/**
 * The dashboard and the report tables (D22), bound to `pos:reports`. The
 * service turns the store's days into instants and reads the rows; every sum
 * is `src/domain/reports.ts`'s.
 */
@Injectable()
export class PosReportService {
  constructor(
    @Inject(POS_PRISMA_WRITE) private readonly prisma: PosWriteClient,
    private readonly zones: PosTimeZoneService,
    /** Unbound: nobody has a name. */
    @Optional() @Inject(POS_MEMBER_DIRECTORY) private readonly directory?: PosMemberDirectory,
  ) {}

  async report(scope: InScope, fromDay: string, toDay: string): Promise<PosReport> {
    const timeZone = await this.zones.of(scope);
    const days = daysBetween(fromDay, toDay);
    const period = this.period(fromDay, toDay, timeZone);
    const previousFromDay = days === 1 ? shiftDayKey(fromDay, -7) : shiftDayKey(fromDay, -days);
    const previousToDay = days === 1 ? shiftDayKey(toDay, -7) : shiftDayKey(fromDay, -1);
    const previousPeriod = this.period(previousFromDay, previousToDay, timeZone);

    const [current, previous] = await Promise.all([this.read(scope, period), this.read(scope, previousPeriod)]);
    const granularity = days > 62 ? 'month' : 'day';
    const staff = salesByStaff(current.orders, period);
    const names = await this.names(staff.map((row) => row.key));
    return {
      fromDay,
      toDay,
      timeZone,
      summary: summarize(current.orders, current.refunds, period),
      previous: summarize(previous.orders, previous.refunds, previousPeriod),
      previousFromDay,
      previousToDay,
      series: salesSeries(current.orders, current.refunds, period, timeZone, granularity),
      previousSeries: salesSeries(previous.orders, previous.refunds, previousPeriod, timeZone, granularity),
      granularity,
      byItem: salesByItem(current.orders, period),
      byCategory: salesByCategory(current.orders, period),
      byStaff: staff.map((row) => ({ ...row, name: names.get(row.key) ?? null })),
      byHour: salesByHour(current.orders, period, timeZone),
      outstanding: outstanding(current.orders),
      truncated: current.truncated || previous.truncated,
    };
  }

  /**
   * The takings alone for the store days `fromDay`…`toDay` — the summary the
   * dashboard's first row shows, without the comparison, series and tables.
   * What the app hands the bookkeeping app's `BooksSalesSource`
   * (`apps/web-server/src/books/sales-source.ts`).
   */
  async takings(scope: InScope, fromDay: string, toDay: string): Promise<{ summary: PosSummary; truncated: boolean }> {
    const timeZone = await this.zones.of(scope);
    daysBetween(fromDay, toDay);
    const period = this.period(fromDay, toDay, timeZone);
    const current = await this.read(scope, period);
    return { summary: summarize(current.orders, current.refunds, period), truncated: current.truncated };
  }

  /** Store days → instants, refusing a malformed or oversized range. */
  private period(fromDay: string, toDay: string, timeZone: string): PosPeriod {
    const from = zonedStartOfDay(fromDay, timeZone);
    const to = zonedStartOfDay(nextDayKey(toDay), timeZone);
    if (!from || !to || to <= from) throw invalidPeriod();
    return { from, to };
  }

  /**
   * Every order a period's figures touch: paid, released unpaid, cancelled or
   * with owed change settled in it — plus everything still OWED at its end,
   * whenever it began (the outstanding lists and "change owed outstanding").
   */
  private async read(
    scope: InScope,
    period: PosPeriod,
  ): Promise<{ orders: PosReportOrder[]; refunds: PosReportRefund[]; truncated: boolean }> {
    const range = { gte: period.from, lt: period.to };
    const orderBy = [{ createdAt: 'asc' as const }, { id: 'asc' as const }];
    const [inPeriod, unpaid, owed, refunds] = await Promise.all([
      this.prisma.posOrder.findMany({
        where: {
          ...scope,
          OR: [{ paidAt: range }, { finalisedAt: range }, { cancelledAt: range }, { changeSettledAt: range }],
        },
        orderBy,
        take: POS_REPORT_ORDERS_MAX,
      }),
      this.prisma.posOrder.findMany({ where: { ...scope, status: 'unpaid' }, orderBy, take: POS_REPORT_ORDERS_MAX }),
      this.prisma.posOrder.findMany({
        where: { ...scope, status: 'paid', changeOwed: { gt: 0 }, paidAt: { lt: period.to } },
        orderBy,
        take: POS_REPORT_ORDERS_MAX,
      }),
      this.prisma.posRefund.findMany({
        where: { ...scope, refundedAt: range },
        orderBy: [{ refundedAt: 'asc' }, { id: 'asc' }],
        take: POS_REPORT_ORDERS_MAX,
      }),
    ]);
    const truncated = [inPeriod, unpaid, owed, refunds].some((rows) => rows.length >= POS_REPORT_ORDERS_MAX);
    const byId = new Map<string, PosOrderRow>();
    for (const order of [...inPeriod, ...unpaid, ...owed]) byId.set(order.id, order);
    const orders = [...byId.values()];
    const lines = await this.linesOf(orders.map((order) => order.id));
    return {
      orders: orders.map((order) => toReportOrder(order, lines.get(order.id) ?? [])),
      refunds: refunds.map(toReportRefund),
      truncated,
    };
  }

  /** Lines of many orders, in chunks: an `IN` list of 20,000 ids is one statement too many. */
  private async linesOf(orderIds: readonly string[]): Promise<Map<string, PosOrderLineRow[]>> {
    const byOrder = new Map<string, PosOrderLineRow[]>();
    const CHUNK = 1000;
    for (let i = 0; i < orderIds.length; i += CHUNK) {
      // One chunk at a time: each is a large read, and they need not hold connections together.
      const rows = await this.prisma.posOrderLine.findMany({
        where: { orderId: { in: orderIds.slice(i, i + CHUNK) } },
        orderBy: [{ orderId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
      });
      for (const row of rows) byOrder.set(row.orderId, [...(byOrder.get(row.orderId) ?? []), row]);
    }
    return byOrder;
  }

  private async names(userIds: readonly string[]): Promise<Map<string, string>> {
    const ids = userIds.filter((id) => id.length > 0);
    if (!this.directory || ids.length === 0) return new Map();
    const members = await this.directory.describe(ids);
    return new Map(members.map((member) => [member.userId, member.displayName]));
  }
}

function toReportOrder(order: PosOrderRow, lines: readonly PosOrderLineRow[]): PosReportOrder {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    customerName: order.customerName,
    gross: order.gross,
    lineDiscounts: order.lineDiscounts,
    orderDiscount: order.orderDiscount,
    total: order.total,
    method: order.paymentMethod,
    received: order.received ?? 0,
    change: order.change ?? 0,
    tip: order.tip,
    changeOwed: order.changeOwed,
    changeSettlement: order.changeSettlement,
    changeSettledAt: order.changeSettledAt,
    finalisedAt: order.finalisedAt,
    releasedUnpaid: order.releasedUnpaid,
    paidAt: order.paidAt,
    paidBy: order.paidById,
    cancelledAt: order.cancelledAt,
    lines: lines.map((line) => ({
      itemId: line.itemId,
      variantId: line.variantId,
      name: line.name,
      variantName: line.variantName,
      categoryName: line.categoryName,
      quantity: line.quantity,
      net: line.net,
      unitCost: line.unitCost,
    })),
  };
}

function toReportRefund(refund: PosRefundRow): PosReportRefund {
  return { orderId: refund.orderId, amount: refund.amount, method: refund.method, refundedAt: refund.refundedAt };
}

function invalidPeriod(): PosWriteError {
  return refusalError('invalid_period', { maxDays: POS_REPORT_DAYS_MAX });
}

/** How many store days `fromDay`..`toDay` covers, inclusive; refused past the cap or backwards (`periodDayCount`). */
function daysBetween(fromDay: string, toDay: string): number {
  const days = periodDayCount(fromDay, toDay);
  if (days === null) throw invalidPeriod();
  return days;
}
