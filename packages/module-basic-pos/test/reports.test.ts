import {
  outstanding,
  POS_UNCATEGORISED,
  type PosReportOrder,
  salesByCategory,
  salesByHour,
  salesByItem,
  salesByStaff,
  salesSeries,
  summarize,
} from '../src/domain/reports.js';

const TZ = 'Asia/Manila';
// Oct 1 in Manila: 2026-09-30T16:00Z to 2026-10-01T16:00Z.
const OCT_1 = { from: new Date('2026-09-30T16:00:00Z'), to: new Date('2026-10-01T16:00:00Z') };
const at = (manilaTime: string) => new Date(`2026-10-01T${manilaTime}:00+08:00`);

function order(overrides: Partial<PosReportOrder> & Pick<PosReportOrder, 'id'>): PosReportOrder {
  return {
    number: 1,
    status: 'paid',
    customerName: null,
    gross: 0,
    lineDiscounts: 0,
    orderDiscount: 0,
    total: 0,
    method: 'cash',
    received: 0,
    change: 0,
    tip: 0,
    changeOwed: 0,
    changeSettlement: null,
    changeSettledAt: null,
    finalisedAt: overrides.paidAt ?? null,
    releasedUnpaid: false,
    paidAt: null,
    paidBy: 'ana',
    cancelledAt: null,
    lines: [],
    ...overrides,
  };
}

const lamination = { itemId: 'lam', variantId: 'l2-a4', name: 'Lamination', variantName: '250 mic · A4' };
const magnet = { itemId: 'mag', variantId: null, name: 'Ref magnet', variantName: null };

// #1 — 100 magnets, ₱100 off: ₱1,400, paid ₱1,500 cash, ₱100 change. Cost ₱6 each.
const MAGNETS = order({
  id: 'o1',
  gross: 150_000,
  lineDiscounts: 10_000,
  total: 140_000,
  received: 150_000,
  change: 10_000,
  paidAt: at('10:15'),
  lines: [{ ...magnet, categoryName: 'Souvenirs', quantity: 100, net: 140_000, unitCost: 600 }],
});
// #2 — 2 laminations by GCash, ₱90 + ₱10 tip. No cost entered.
const LAMINATIONS = order({
  id: 'o2',
  number: 2,
  gross: 9000,
  total: 9000,
  method: 'ewallet',
  received: 10_000,
  tip: 1000,
  paidAt: at('23:30'),
  paidBy: 'ben',
  lines: [{ ...lamination, categoryName: null, quantity: 2, net: 9000, unitCost: null }],
});
// #3 — released unpaid on Oct 1, not paid yet.
const UNPAID = order({
  id: 'o3',
  number: 3,
  status: 'unpaid',
  customerName: 'Juan',
  total: 5000,
  method: null,
  finalisedAt: at('11:00'),
  releasedUnpaid: true,
  lines: [{ ...magnet, categoryName: 'Souvenirs', quantity: 5, net: 5000, unitCost: 600 }],
});
// #4 — cancelled with ₱500 in it.
const CANCELLED = order({ id: 'o4', number: null, status: 'cancelled', total: 50_000, cancelledAt: at('12:00') });
// #5 — ₱900 paid with ₱1,000, ₱100 change owed, still owed.
const OWED = order({
  id: 'o5',
  number: 5,
  customerName: 'Maria',
  gross: 90_000,
  total: 90_000,
  received: 100_000,
  changeOwed: 10_000,
  paidAt: at('15:00'),
});
// Paid on Sep 30 — another day.
const YESTERDAY = order({ id: 'o0', total: 70_000, received: 70_000, paidAt: new Date('2026-09-30T10:00:00+08:00') });

const ORDERS = [MAGNETS, LAMINATIONS, UNPAID, CANCELLED, OWED, YESTERDAY];
const REFUND = { orderId: 'o1', amount: 1500, method: 'cash' as const, refundedAt: at('16:00') };

describe('summarize', () => {
  const day = summarize(ORDERS, [REFUND], OCT_1);

  it('⚠ counts a sale on the day it is paid — the 11:30 PM one is Oct 1’s — and never an unpaid one', () => {
    expect(day.orders).toBe(3);
    expect(day.gross).toBe(150_000 + 9000 + 90_000);
    expect(day.discounts).toBe(10_000);
  });

  it('takes refunds off on the day they are made, and keeps tips apart from sales', () => {
    expect(day.refunds).toBe(1500);
    expect(day.netSales).toBe(140_000 + 9000 + 90_000 - 1500);
    expect(day.tips).toBe(1000);
  });

  it('⚠ says what cash should be in the drawer: in − change handed back − cash refunds', () => {
    // Cash in: 1,500 + 1,000 = ₱2,500. Change handed back: ₱100 (the ₱100 owed is still in the drawer). Refund ₱15.
    expect(day.cashExpected).toBe(250_000 - 10_000 - 1500);
    expect(day.byMethod.ewallet).toBe(10_000);
  });

  it('counts profit on costed lines only, and says how much of the sales that covers', () => {
    // Magnets: 140,000 − 600 × 100 = 80,000, less the ₱15 refund.
    expect(day.profit).toBe(80_000 - 1500);
    expect(day.costCoverage).toBe(Math.floor((140_000 * 10_000) / (140_000 + 9000)));
  });

  it('⚠ reports no profit, not ₱0, when nothing sold has a cost', () => {
    expect(summarize([LAMINATIONS], [], OCT_1).profit).toBeNull();
  });

  it('lists unpaid released, change owed outstanding and cancelled orders apart', () => {
    expect(day.unpaidReleased).toEqual({ count: 1, amount: 5000 });
    expect(day.changeOwedOutstanding).toEqual({ count: 1, amount: 10_000 });
    expect(day.cancelled).toEqual({ count: 1, amount: 50_000 });
  });

  it('counts an unpaid order as collected, and as a sale, on the day it is paid', () => {
    const paidLater = { ...UNPAID, status: 'paid' as const, paidAt: new Date('2026-10-03T09:00:00+08:00') };
    const oct3 = { from: new Date('2026-10-02T16:00:00Z'), to: new Date('2026-10-03T16:00:00Z') };
    expect(summarize([paidLater], [], oct3)).toMatchObject({ orders: 1, unpaidCollected: { count: 1, amount: 5000 } });
  });

  it('takes owed change out of the drawer when handed over, and counts it as a tip when kept', () => {
    const next = { from: OCT_1.to, to: new Date('2026-10-02T16:00:00Z') };
    const given = {
      ...OWED,
      changeSettlement: 'given' as const,
      changeSettledAt: new Date('2026-10-02T09:00:00+08:00'),
    };
    expect(summarize([given], [], next)).toMatchObject({ cashExpected: -10_000, tips: 0 });
    const kept = { ...given, changeSettlement: 'tip' as const };
    expect(summarize([kept], [], next)).toMatchObject({ cashExpected: 0, tips: 10_000 });
  });
});

describe('breakdowns', () => {
  it('groups by item and variant, with profit only where every line has a cost', () => {
    expect(salesByItem(ORDERS, OCT_1)).toEqual([
      { key: 'mag:', label: 'Ref magnet', quantity: 100, net: 140_000, cost: 60_000, profit: 80_000 },
      { key: 'lam:l2-a4', label: 'Lamination — 250 mic · A4', quantity: 2, net: 9000, cost: null, profit: null },
    ]);
  });

  it('groups by the category AT SALE, with none as Uncategorised', () => {
    expect(salesByCategory(ORDERS, OCT_1).map((row) => row.label)).toEqual(['Souvenirs', POS_UNCATEGORISED]);
  });

  it('credits a sale to who took payment', () => {
    expect(salesByStaff(ORDERS, OCT_1).map((row) => [row.key, row.net])).toEqual([
      ['ana', 140_000],
      ['ben', 9000],
    ]);
  });

  it('buckets by the store’s hour and day', () => {
    const hours = salesByHour(ORDERS, OCT_1, TZ);
    expect(hours[23]).toEqual({ hour: 23, orders: 1, sales: 9000 });
    expect(hours[10]).toEqual({ hour: 10, orders: 1, sales: 140_000 });
    const week = { from: new Date('2026-09-29T16:00:00Z'), to: OCT_1.to };
    expect(salesSeries(ORDERS, [REFUND], week, TZ, 'day')).toEqual([
      { key: '2026-09-30', orders: 1, sales: 70_000, refunds: 0 },
      { key: '2026-10-01', orders: 3, sales: 239_000, refunds: 1500 },
    ]);
  });
});

describe('outstanding', () => {
  it('lists who owes the store and whom the store owes, oldest first', () => {
    const owed = outstanding(ORDERS);
    expect(owed.unpaid.map((row) => [row.number, row.customerName, row.amount])).toEqual([[3, 'Juan', 5000]]);
    expect(owed.changeOwed.map((row) => [row.number, row.customerName, row.amount])).toEqual([[5, 'Maria', 10_000]]);
  });
});
