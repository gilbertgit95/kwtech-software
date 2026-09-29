import type { PosOrderStatus, PosPaymentMethod } from '../types.js';
import type { PosChangeSettlement } from './orders.js';
import { zonedDayKey, zonedHour, zonedMonthKey } from './time-zone.js';

/**
 * The report sums (D22). The server reads the rows of a period; these add them
 * up. Pure, so every figure on the dashboard is pinned by a test, and the
 * dashboard, the daily summary and the CSV cannot disagree.
 *
 * ⚠ THE COUNTING RULES, in one place:
 * - a sale counts on the day it is PAID (an order paid later counts then, D13);
 * - a refund counts on the day it is MADE, against that day (D17);
 * - discounts and tips are shown apart from sales; a tip is never a sale;
 * - cancelled and voided orders are never sales — they are listed, apart.
 */

/** One sold line, as reports need it. `net` is what the customer actually paid for it (`PosLineTotals.net`). */
export interface PosReportLine {
  itemId: string;
  variantId: string | null;
  /** The copies taken at sale (§3), so moving or renaming an item never rewrites a past report. */
  name: string;
  variantName: string | null;
  categoryName: string | null;
  quantity: number;
  net: number;
  /** Null when no cost was entered: such a line is left out of profit rather than counted as free. */
  unitCost: number | null;
}

/** One order, as reports need it. */
export interface PosReportOrder {
  id: string;
  number: number | null;
  status: PosOrderStatus;
  customerName: string | null;
  /** Σ gross, Σ line discounts, the order discount, and the total, as `computeOrderTotals` stored them. */
  gross: number;
  lineDiscounts: number;
  orderDiscount: number;
  total: number;
  method: PosPaymentMethod | null;
  received: number;
  /** Change handed back at payment. */
  change: number;
  tip: number;
  changeOwed: number;
  changeSettlement: PosChangeSettlement | null;
  changeSettledAt: Date | null;
  /** When it was numbered: paid, or released unpaid. */
  finalisedAt: Date | null;
  /** True when it was released unpaid (D13), whether or not it has been paid since. */
  releasedUnpaid: boolean;
  paidAt: Date | null;
  /** Who took the payment: the person a sale is credited to ("by staff"). */
  paidBy: string | null;
  cancelledAt: Date | null;
  lines: readonly PosReportLine[];
}

export interface PosReportRefund {
  orderId: string;
  amount: number;
  method: PosPaymentMethod;
  refundedAt: Date;
}

/** A period: from (inclusive) to (exclusive), as instants. The service turns store days into these. */
export interface PosPeriod {
  from: Date;
  to: Date;
}

function within(instant: Date | null, period: PosPeriod): instant is Date {
  return instant !== null && instant >= period.from && instant < period.to;
}

/** Orders that are SALES of the period: paid within it. */
export function salesOf(orders: readonly PosReportOrder[], period: PosPeriod): PosReportOrder[] {
  return orders.filter((order) => order.status === 'paid' && within(order.paidAt, period));
}

/** The daily summary's figures (D22, report 1), for any period. */
export interface PosSummary {
  orders: number;
  /** Before any discount. */
  gross: number;
  discounts: number;
  refunds: number;
  /** Gross − discounts − refunds. */
  netSales: number;
  /** Net sales ÷ orders, in whole centavos; 0 with no orders. */
  averageOrder: number;
  /** Tips at payment, plus owed change the customer later said to keep. */
  tips: number;
  /** Money kept per method: received − change handed back − refunds by that method. */
  byMethod: Readonly<Record<PosPaymentMethod, number>>;
  /** Cash in − cash change handed back (at payment and owed change given later) − cash refunds. */
  cashExpected: number;
  /**
   * Σ (net − cost × quantity) over lines with a cost, − refunds. Null when no
   * sold line has a cost: "no profit figure" is not "₱0 profit".
   *
   * ⚠ Refunds are all taken off it, costed lines or not — a refund is money
   * gone either way, and a profit that ignores it would flatter the day.
   */
  profit: number | null;
  /** How much of the sales had a cost entered, in basis points: "profit covers 80% of sales". */
  costCoverage: number;
  unpaidReleased: { count: number; amount: number };
  unpaidCollected: { count: number; amount: number };
  /** Owed change still not settled at the END of the period. */
  changeOwedOutstanding: { count: number; amount: number };
  cancelled: { count: number; amount: number };
}

const NO_METHODS = (): Record<PosPaymentMethod, number> => ({ cash: 0, ewallet: 0, card: 0 });

export function summarize(
  orders: readonly PosReportOrder[],
  refunds: readonly PosReportRefund[],
  period: PosPeriod,
): PosSummary {
  const sales = salesOf(orders, period);
  const periodRefunds = refunds.filter((refund) => within(refund.refundedAt, period));
  const byMethod = NO_METHODS();
  let gross = 0;
  let discounts = 0;
  let total = 0;
  let tips = 0;
  let costed = 0;
  let costedNet = 0;
  let allNet = 0;
  let hasCost = false;
  let cashChange = 0;

  for (const order of sales) {
    gross += order.gross;
    discounts += order.lineDiscounts + order.orderDiscount;
    total += order.total;
    tips += order.tip;
    if (order.method) byMethod[order.method] += order.received - order.change;
    if (order.method === 'cash') cashChange += order.change;
    for (const line of order.lines) {
      allNet += line.net;
      if (line.unitCost === null) continue;
      hasCost = true;
      costedNet += line.net;
      costed += line.net - line.unitCost * line.quantity;
    }
  }

  // Owed change settled within the period: handed over (cash leaves the drawer) or kept as a tip.
  for (const order of orders) {
    if (order.changeOwed <= 0 || !within(order.changeSettledAt, period)) continue;
    if (order.changeSettlement === 'tip') tips += order.changeOwed;
    if (order.changeSettlement === 'given') {
      byMethod.cash -= order.changeOwed;
      cashChange += order.changeOwed;
    }
  }

  let refunded = 0;
  for (const refund of periodRefunds) {
    refunded += refund.amount;
    byMethod[refund.method] -= refund.amount;
  }

  const cashIn = sales.filter((order) => order.method === 'cash').reduce((sum, order) => sum + order.received, 0);
  const refundedCash = periodRefunds.filter((r) => r.method === 'cash').reduce((sum, r) => sum + r.amount, 0);

  const released = orders.filter((order) => order.releasedUnpaid && within(order.finalisedAt, period));
  const collected = sales.filter((order) => order.releasedUnpaid);
  const owed = orders.filter(
    (order) =>
      order.changeOwed > 0 &&
      order.paidAt !== null &&
      order.paidAt < period.to &&
      (order.changeSettledAt === null || order.changeSettledAt >= period.to),
  );
  const cancelled = orders.filter((order) => order.status === 'cancelled' && within(order.cancelledAt, period));

  return {
    orders: sales.length,
    gross,
    discounts,
    refunds: refunded,
    netSales: total - refunded,
    averageOrder: sales.length === 0 ? 0 : Math.floor(total / sales.length),
    tips,
    byMethod,
    cashExpected: cashIn - cashChange - refundedCash,
    profit: hasCost ? costed - refunded : null,
    costCoverage: allNet === 0 ? 0 : Math.floor((costedNet * 10_000) / allNet),
    unpaidReleased: countAndSum(released, (order) => order.total),
    unpaidCollected: countAndSum(collected, (order) => order.total),
    changeOwedOutstanding: countAndSum(owed, (order) => order.changeOwed),
    cancelled: countAndSum(cancelled, (order) => order.total),
  };
}

function countAndSum(orders: readonly PosReportOrder[], amount: (order: PosReportOrder) => number) {
  return { count: orders.length, amount: orders.reduce((sum, order) => sum + amount(order), 0) };
}

/** One row of a "sales by …" table (reports 2–5). */
export interface PosBreakdownRow {
  key: string;
  label: string;
  quantity: number;
  net: number;
  /** Null when any line in the row has no cost: a partial cost would understate it. */
  cost: number | null;
  profit: number | null;
}

type LineKey = (line: PosReportLine, order: PosReportOrder) => { key: string; label: string };

function breakdown(sales: readonly PosReportOrder[], keyOf: LineKey): PosBreakdownRow[] {
  const rows = new Map<string, PosBreakdownRow>();
  for (const order of sales) {
    for (const line of order.lines) {
      const { key, label } = keyOf(line, order);
      const row = rows.get(key) ?? { key, label, quantity: 0, net: 0, cost: 0, profit: 0 };
      row.quantity += line.quantity;
      row.net += line.net;
      row.cost = row.cost === null || line.unitCost === null ? null : row.cost + line.unitCost * line.quantity;
      row.profit = row.cost === null ? null : row.net - row.cost;
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.net - a.net || a.label.localeCompare(b.label));
}

/** Report 2: by item and variant — also the dashboard's top items. */
export function salesByItem(orders: readonly PosReportOrder[], period: PosPeriod): PosBreakdownRow[] {
  return breakdown(salesOf(orders, period), (line) => ({
    key: `${line.itemId}:${line.variantId ?? ''}`,
    label: line.variantName ? `${line.name} — ${line.variantName}` : line.name,
  }));
}

/** The label a line with no category is grouped under. */
export const POS_UNCATEGORISED = 'Uncategorised';

/** Report 3: by category, as it was AT SALE (the line's copy). */
export function salesByCategory(orders: readonly PosReportOrder[], period: PosPeriod): PosBreakdownRow[] {
  return breakdown(salesOf(orders, period), (line) => ({
    key: line.categoryName ?? '',
    label: line.categoryName ?? POS_UNCATEGORISED,
  }));
}

/** Report 4: by staff — credited to WHO TOOK PAYMENT (guard rules). Labels are user ids; the page names them. */
export function salesByStaff(orders: readonly PosReportOrder[], period: PosPeriod): PosBreakdownRow[] {
  return breakdown(salesOf(orders, period), (_line, order) => ({
    key: order.paidBy ?? '',
    label: order.paidBy ?? '',
  }));
}

/** One bucket of a time series. */
export interface PosSeriesPoint {
  key: string;
  orders: number;
  /** Order totals paid in the bucket, before refunds. */
  sales: number;
  refunds: number;
}

/**
 * Sales per store day (`YYYY-MM-DD`) or month (`YYYY-MM`) — the dashboard's
 * main chart. Only buckets with something in them; the page fills the gaps,
 * because it knows which days it is drawing.
 */
export function salesSeries(
  orders: readonly PosReportOrder[],
  refunds: readonly PosReportRefund[],
  period: PosPeriod,
  timeZone: string,
  granularity: 'day' | 'month',
): PosSeriesPoint[] {
  const keyOf = (instant: Date) =>
    granularity === 'day' ? zonedDayKey(instant, timeZone) : zonedMonthKey(instant, timeZone);
  const points = new Map<string, PosSeriesPoint>();
  const point = (key: string) => points.get(key) ?? { key, orders: 0, sales: 0, refunds: 0 };
  for (const order of salesOf(orders, period)) {
    if (!order.paidAt) continue;
    const next = point(keyOf(order.paidAt));
    points.set(next.key, { ...next, orders: next.orders + 1, sales: next.sales + order.total });
  }
  for (const refund of refunds) {
    if (!within(refund.refundedAt, period)) continue;
    const next = point(keyOf(refund.refundedAt));
    points.set(next.key, { ...next, refunds: next.refunds + refund.amount });
  }
  return [...points.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Report 5 and the dashboard's busy hours: 24 buckets, 0–23, in the store's time. */
export function salesByHour(
  orders: readonly PosReportOrder[],
  period: PosPeriod,
  timeZone: string,
): { hour: number; orders: number; sales: number }[] {
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, sales: 0 }));
  for (const order of salesOf(orders, period)) {
    if (!order.paidAt) continue;
    const bucket = hours[zonedHour(order.paidAt, timeZone)];
    if (!bucket) continue;
    bucket.orders += 1;
    bucket.sales += order.total;
  }
  return hours;
}

/** Report 6: what is owed, either way, as of `now`, oldest first. */
export interface PosOutstanding {
  /** The customer owes the store. */
  unpaid: readonly {
    orderId: string;
    number: number | null;
    customerName: string | null;
    amount: number;
    since: Date;
  }[];
  /** The store owes the customer. */
  changeOwed: readonly {
    orderId: string;
    number: number | null;
    customerName: string | null;
    amount: number;
    since: Date;
  }[];
}

export function outstanding(orders: readonly PosReportOrder[]): PosOutstanding {
  const unpaid = orders
    .filter((order) => order.status === 'unpaid' && order.finalisedAt !== null)
    .map((order) => ({
      orderId: order.id,
      number: order.number,
      customerName: order.customerName,
      amount: order.total,
      since: order.finalisedAt ?? new Date(0),
    }));
  const changeOwed = orders
    .filter((order) => order.changeOwed > 0 && order.changeSettledAt === null && order.paidAt !== null)
    .map((order) => ({
      orderId: order.id,
      number: order.number,
      customerName: order.customerName,
      amount: order.changeOwed,
      since: order.paidAt ?? new Date(0),
    }));
  const oldestFirst = (a: { since: Date }, b: { since: Date }) => a.since.getTime() - b.since.getTime();
  return { unpaid: unpaid.sort(oldestFirst), changeOwed: changeOwed.sort(oldestFirst) };
}
