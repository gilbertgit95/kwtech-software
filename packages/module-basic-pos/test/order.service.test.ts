import { zonedDayKey } from '@kwtech/module-kit';
import { POS_FEATURE } from '../src/feature-keys.js';
import { PosWriteError } from '../src/server/pos.errors.js';
import type { PosOrderRow } from '../src/server/pos.repository.js';
import { ANA, as, BEN, harness, OTHER_STORE, SCOPE } from './harness.js';

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PosWriteError) return error.reason;
    throw error;
  }
  return 'no refusal';
}

const ref = (order: Pick<PosOrderRow, 'id' | 'version'>) => ({ orderId: order.id, version: order.version });

/** A print shop: magnets at ₱15 (cost ₱6), laminations in two sizes. Ana may discount and refund; Ben sells. */
async function shop() {
  const h = harness({
    holders: {
      [POS_FEATURE.discount]: [ANA],
      [POS_FEATURE.refund]: [ANA],
      [POS_FEATURE.manageItems]: [ANA],
    },
  });
  const magnet = await h.catalogue.saveItem(SCOPE, ANA, {
    kind: 'product',
    name: 'Ref magnet',
    code: 'MAG',
    price: 1500,
    cost: 600,
  });
  const lamination = await h.catalogue.saveItem(SCOPE, ANA, {
    kind: 'service',
    name: 'Lamination',
    price: 0,
    variants: [
      { name: '125 mic · A4', price: 3500 },
      { name: '250 mic · A4', price: 4500, cost: 1200 },
    ],
  });
  const a4 = lamination.variants[1];
  if (!a4) throw new Error('fixture');
  return { ...h, magnet: magnet.item, lamination: lamination.item, a4 };
}

const cash = (received: number, extra: { tip?: number; changeOwed?: number; clientId?: string } = {}) => ({
  method: 'cash',
  received,
  tip: extra.tip ?? 0,
  changeOwed: extra.changeOwed ?? 0,
  clientId: extra.clientId ?? `pay-${received}-${extra.tip ?? 0}`,
});

describe('a sale, from the first item to paid', () => {
  it('rings up, adds up, takes cash, numbers the order and gives change', async () => {
    const { writes, magnet, lamination, a4 } = await shop();
    let order = await writes.create(SCOPE, BEN, null);
    order = await writes.addLine(SCOPE, BEN, ref(order), { itemId: magnet.id, quantity: 1 });
    order = await writes.addLine(SCOPE, BEN, ref(order), { itemId: magnet.id, quantity: 1 });
    order = await writes.addLine(SCOPE, BEN, ref(order), { itemId: lamination.id, variantId: a4.id, quantity: 2 });
    expect(order).toMatchObject({ status: 'open', total: 3000 + 9000, number: null });

    order = await writes.pay(SCOPE, BEN, ref(order), cash(15_000));
    expect(order).toMatchObject({ status: 'paid', number: 1, change: 3000, paidById: BEN, finalisedById: BEN });
  });

  it('adds to the same plain line when an item is tapped again — two taps, one line of 2', async () => {
    const { writes, orders, magnet } = await shop();
    let order = await writes.create(SCOPE, BEN, null);
    order = await writes.addLine(SCOPE, BEN, ref(order), { itemId: magnet.id, quantity: 1 });
    order = await writes.addLine(SCOPE, BEN, ref(order), { itemId: magnet.id, quantity: 1 });
    const detail = await orders.get(SCOPE, order.id);
    expect(detail?.lines.map((line) => line.quantity)).toEqual([2]);
  });

  it('asks which variant for an item that has them, and refuses an archived item', async () => {
    const { writes, catalogue, lamination, magnet } = await shop();
    const order = await writes.create(SCOPE, BEN, null);
    expect(await refusal(writes.addLine(SCOPE, BEN, ref(order), { itemId: lamination.id, quantity: 1 }))).toBe(
      'variant_required',
    );
    await catalogue.setItemArchived(SCOPE, ANA, magnet.id, true);
    expect(await refusal(writes.addLine(SCOPE, BEN, ref(order), { itemId: magnet.id, quantity: 1 }))).toBe(
      'item_archived',
    );
  });

  it('⚠ numbers orders 1, 2, 3 per store, and never numbers a cancelled one', async () => {
    const { writes, magnet } = await shop();
    const numbers: (number | null)[] = [];
    for (const [i, end] of ['pay', 'cancel', 'pay'].entries()) {
      let order = await writes.create(SCOPE, BEN, null);
      order = await writes.addLine(SCOPE, BEN, ref(order), { itemId: magnet.id, quantity: 1 });
      order =
        end === 'pay'
          ? await writes.pay(SCOPE, BEN, ref(order), cash(1500, { clientId: `c${i}` }))
          : await writes.cancel(SCOPE, BEN, ref(order), 'changed their mind');
      numbers.push(order.number);
    }
    expect(numbers).toEqual([1, null, 2]);
  });
});

describe('a paid order is final', () => {
  it('⚠ refuses any change once paid — corrections are refunds', async () => {
    const { writes, magnet } = await shop();
    let order = await writes.create(SCOPE, BEN, null);
    order = await writes.addLine(SCOPE, BEN, ref(order), { itemId: magnet.id, quantity: 1 });
    order = await writes.pay(SCOPE, BEN, ref(order), cash(1500));
    expect(await refusal(writes.addLine(SCOPE, BEN, ref(order), { itemId: magnet.id, quantity: 1 }))).toBe('not_open');
    expect(await refusal(writes.cancel(SCOPE, BEN, ref(order), 'x'))).toBe('not_open');
  });

  it('⚠ keeps the price it was sold at when the item’s price changes, until the cashier updates a held line', async () => {
    const { writes, catalogue, orders, magnet } = await shop();
    let order = await writes.create(SCOPE, BEN, null);
    order = await writes.addLine(SCOPE, BEN, ref(order), { itemId: magnet.id, quantity: 1 });
    await catalogue.saveItem(SCOPE, ANA, { id: magnet.id, kind: 'product', name: 'Magnet', code: 'MAG', price: 2000 });
    expect(order.total).toBe(1500);
    const line = (await orders.get(SCOPE, order.id))?.lines[0];
    order = await writes.refreshLine(SCOPE, BEN, ref(order), line?.id ?? '');
    const refreshed = (await orders.get(SCOPE, order.id))?.lines[0];
    expect([order.total, refreshed?.name]).toEqual([2000, 'Magnet']);
  });
});

describe('two people on one order', () => {
  it('⚠ refuses a change made on an old version', async () => {
    const { writes, magnet } = await shop();
    const stale = await writes.create(SCOPE, BEN, null);
    await writes.addLine(SCOPE, ANA, ref(stale), { itemId: magnet.id, quantity: 1 });
    expect(await refusal(writes.addLine(SCOPE, BEN, ref(stale), { itemId: magnet.id, quantity: 1 }))).toBe('conflict');
  });

  it('⚠ lets only one of two tills take payment — the second is told the order is no longer open', async () => {
    const { writes, magnet } = await shop();
    let order = await writes.create(SCOPE, BEN, null);
    order = await writes.addLine(SCOPE, BEN, ref(order), { itemId: magnet.id, quantity: 1 });
    await writes.pay(SCOPE, BEN, ref(order), cash(1500, { clientId: 'till-1' }));
    expect(await refusal(writes.pay(SCOPE, ANA, ref(order), cash(1500, { clientId: 'till-2' })))).toBe('not_open');
  });

  it('⚠ answers a retried payment with the same order, never paying twice', async () => {
    const { writes, magnet, prisma } = await shop();
    let order = await writes.create(SCOPE, BEN, null);
    order = await writes.addLine(SCOPE, BEN, ref(order), { itemId: magnet.id, quantity: 1 });
    const first = await writes.pay(SCOPE, BEN, ref(order), cash(1500, { clientId: 'same' }));
    const retry = await writes.pay(SCOPE, BEN, ref(order), cash(1500, { clientId: 'same' }));
    expect(retry).toEqual(first);
    expect(prisma.state.posCounter[0]?.nextNumber).toBe(2);
  });
});

describe('discounts', () => {
  it('takes ₱100 off 100 magnets: ₱1,400, and records who gave it', async () => {
    const { writes, orders, magnet } = await shop();
    let order = await writes.create(SCOPE, ANA, null);
    order = await writes.addLine(SCOPE, ANA, ref(order), { itemId: magnet.id, quantity: 100 });
    const lineId = (await orders.get(SCOPE, order.id))?.lines[0]?.id ?? '';
    order = await writes.setLineDiscount(SCOPE, ANA, ref(order), lineId, {
      kind: 'amount',
      value: 10_000,
      reason: 'suki',
    });
    expect(order.total).toBe(140_000);
    expect((await orders.get(SCOPE, order.id))?.lines[0]).toMatchObject({ discountById: ANA, discountReason: 'suki' });
  });

  it('⚠ drops a fixed line discount when somebody who may not discount changes the quantity', async () => {
    const { writes, orders, magnet } = await shop();
    let order = await writes.create(SCOPE, ANA, null);
    order = await writes.addLine(SCOPE, ANA, ref(order), { itemId: magnet.id, quantity: 100 });
    const lineId = (await orders.get(SCOPE, order.id))?.lines[0]?.id ?? '';
    order = await writes.setLineDiscount(SCOPE, ANA, ref(order), lineId, {
      kind: 'amount',
      value: 10_000,
      reason: 'suki',
    });
    order = await writes.updateLine(SCOPE, BEN, ref(order), lineId, { quantity: 7 });
    expect(order.total).toBe(7 * 1500);
    expect((await orders.get(SCOPE, order.id))?.lines[0]?.discountKind).toBeNull();
  });

  it('keeps it when the editor may discount, and keeps a percentage for anybody', async () => {
    const { writes, orders, magnet } = await shop();
    let order = await writes.create(SCOPE, ANA, null);
    order = await writes.addLine(SCOPE, ANA, ref(order), { itemId: magnet.id, quantity: 10 });
    const lineId = (await orders.get(SCOPE, order.id))?.lines[0]?.id ?? '';
    order = await writes.setLineDiscount(SCOPE, ANA, ref(order), lineId, {
      kind: 'percent',
      value: 1000,
      reason: 'promo',
    });
    order = await writes.updateLine(SCOPE, BEN, ref(order), lineId, { quantity: 20 });
    expect(order.total).toBe(20 * 1500 - 3000);
  });

  it('⚠ drops a fixed ORDER discount when somebody who may not discount adds a line', async () => {
    const { writes, magnet } = await shop();
    let order = await writes.create(SCOPE, ANA, null);
    order = await writes.addLine(SCOPE, ANA, ref(order), { itemId: magnet.id, quantity: 10 });
    order = await writes.setOrderDiscount(SCOPE, ANA, ref(order), { kind: 'amount', value: 5000, reason: 'suki' });
    expect(order.total).toBe(10_000);
    order = await writes.addLine(SCOPE, BEN, ref(order), { itemId: magnet.id, quantity: 1 });
    expect([order.total, order.discountKind]).toEqual([16_500, null]);
  });
});

describe('pay later, change owed, cancel and void', () => {
  it('releases an order unpaid only with a name and contact, and takes its payment later', async () => {
    const { writes, magnet } = await shop();
    let order = await writes.create(SCOPE, BEN, null);
    order = await writes.addLine(SCOPE, BEN, ref(order), { itemId: magnet.id, quantity: 100 });
    expect(await refusal(writes.payLater(SCOPE, BEN, ref(order)))).toBe('customer_required');
    order = await writes.setCustomer(SCOPE, BEN, ref(order), { name: 'Juan', contact: '0917' });
    order = await writes.payLater(SCOPE, BEN, ref(order));
    expect(order).toMatchObject({ status: 'unpaid', number: 1, releasedUnpaid: true, finalisedById: BEN });
    // Locked: no new lines while it waits.
    expect(await refusal(writes.addLine(SCOPE, BEN, ref(order), { itemId: magnet.id, quantity: 1 }))).toBe('not_open');
    order = await writes.pay(SCOPE, ANA, ref(order), cash(150_000));
    expect(order).toMatchObject({ status: 'paid', number: 1, paidById: ANA, finalisedById: BEN });
  });

  it('records change owed on cash only, with the customer, and settles it later', async () => {
    const { writes, magnet } = await shop();
    let order = await writes.create(SCOPE, BEN, null);
    order = await writes.addLine(SCOPE, BEN, ref(order), { itemId: magnet.id, quantity: 60 });
    expect(await refusal(writes.pay(SCOPE, BEN, ref(order), cash(100_000, { changeOwed: 10_000 })))).toBe(
      'customer_required',
    );
    order = await writes.setCustomer(SCOPE, BEN, ref(order), { name: 'Maria', contact: '0918' });
    order = await writes.pay(SCOPE, BEN, ref(order), cash(100_000, { changeOwed: 10_000 }));
    expect([order.change, order.changeOwed]).toEqual([0, 10_000]);
    order = await writes.settleChangeOwed(SCOPE, BEN, ref(order), 'given');
    expect(order).toMatchObject({ changeSettlement: 'given', changeSettledById: BEN });
    expect(await refusal(writes.settleChangeOwed(SCOPE, BEN, ref(order), 'tip'))).toBe('invalid_transition');
  });

  it('⚠ asks a reason to cancel an order with lines, and keeps it on the record', async () => {
    const { writes, magnet, prisma } = await shop();
    let order = await writes.create(SCOPE, BEN, null);
    order = await writes.addLine(SCOPE, BEN, ref(order), { itemId: magnet.id, quantity: 1 });
    expect(await refusal(writes.cancel(SCOPE, BEN, ref(order), ''))).toBe('reason_required');
    order = await writes.cancel(SCOPE, BEN, ref(order), 'changed their mind');
    expect(order).toMatchObject({ status: 'cancelled', cancelledById: BEN, cancelReason: 'changed their mind' });
    expect(prisma.state.posOrderLine).toHaveLength(1);
  });

  it('voids an unpaid order whose items came back, keeping its number', async () => {
    const { writes, magnet } = await shop();
    let order = await writes.create(SCOPE, BEN, null);
    order = await writes.addLine(SCOPE, BEN, ref(order), { itemId: magnet.id, quantity: 1 });
    order = await writes.setCustomer(SCOPE, BEN, ref(order), { name: 'Juan', contact: '0917' });
    order = await writes.payLater(SCOPE, BEN, ref(order));
    order = await writes.void(SCOPE, ANA, ref(order), 'returned the magnets');
    expect(order).toMatchObject({ status: 'voided', number: 1, voidReason: 'returned the magnets' });
  });

  it('⚠ never touches another store’s order', async () => {
    const { writes } = await shop();
    const theirs = await writes.create(OTHER_STORE, BEN, null);
    expect(await refusal(writes.setLabel(SCOPE, BEN, ref(theirs), 'mine'))).toBe('not_found');
  });
});

describe('refunds', () => {
  async function paidOrder() {
    const s = await shop();
    let order = await s.writes.create(SCOPE, BEN, null);
    order = await s.writes.addLine(SCOPE, BEN, ref(order), {
      itemId: s.lamination.id,
      variantId: s.a4.id,
      quantity: 2,
    });
    order = await s.writes.pay(SCOPE, BEN, ref(order), cash(10_000));
    const lineId = (await s.orders.get(SCOPE, order.id))?.lines[0]?.id ?? '';
    return { ...s, order, lineId };
  }

  it('refunds 1 of 2 laminations as its own record; the order never changes', async () => {
    const { refunds, orders, order, lineId } = await paidOrder();
    const refund = await refunds.refund(SCOPE, ANA, order.id, {
      lines: [{ lineId, quantity: 1 }],
      method: 'cash',
      reason: 'bubbled',
      clientId: 'r1',
    });
    expect(refund.amount).toBe(4500);
    const detail = await orders.get(SCOPE, order.id);
    expect(detail?.order).toMatchObject({ status: 'paid', total: 9000, version: order.version });
  });

  it('⚠ never gives back more than was sold or paid, and a retry is not a second refund', async () => {
    const { refunds, order, lineId, prisma } = await paidOrder();
    const input = { lines: [{ lineId, quantity: 2 }], method: 'cash', reason: 'both bad', clientId: 'r1' };
    await refunds.refund(SCOPE, ANA, order.id, input);
    await refunds.refund(SCOPE, ANA, order.id, input);
    expect(prisma.state.posRefund).toHaveLength(1);
    expect(
      await refusal(
        refunds.refund(SCOPE, ANA, order.id, { ...input, clientId: 'r2', lines: [{ lineId, quantity: 1 }] }),
      ),
    ).toBe('exceeds_sold');
    expect(
      await refusal(refunds.refund(SCOPE, ANA, order.id, { amount: 1, method: 'cash', reason: 'x', clientId: 'r3' })),
    ).toBe('exceeds_paid');
  });
});

describe('what the API answers', () => {
  it('⚠ strips unit costs from an order for somebody who may not see them', async () => {
    const { writes, orderResolver, magnet } = await shop();
    let order = await writes.create(SCOPE, BEN, null);
    order = await writes.addLine(SCOPE, BEN, ref(order), { itemId: magnet.id, quantity: 1 });
    const forBen = await orderResolver.posOrder(as(BEN), SCOPE.organizationId, SCOPE.workspaceId, order.id);
    const forAna = await orderResolver.posOrder(as(ANA), SCOPE.organizationId, SCOPE.workspaceId, order.id);
    expect([forBen?.lines[0]?.unitCost, forAna?.lines[0]?.unitCost]).toEqual([null, 600]);
  });

  it('lists pending orders oldest first, and the orders paid on a store day on that day', async () => {
    const { writes, orders, magnet } = await shop();
    let held = await writes.create(SCOPE, BEN, null);
    held = await writes.hold(SCOPE, BEN, ref(held), 'red cap', new Date());
    let sold = await writes.create(SCOPE, BEN, null);
    sold = await writes.addLine(SCOPE, BEN, ref(sold), { itemId: magnet.id, quantity: 1 });
    sold = await writes.pay(SCOPE, BEN, ref(sold), cash(1500));
    expect((await orders.list(SCOPE, 'pending', '')).map((row) => row.order.id)).toEqual([held.id]);
    const day = zonedDayKey(sold.paidAt ?? new Date(), 'Asia/Manila');
    const paidThatDay = await orders.list(SCOPE, 'paid', '', { fromDay: day, toDay: day });
    expect(paidThatDay.map((row) => row.order.id)).toEqual([sold.id]);
    expect((await orders.list(SCOPE, 'all', 'red')).map((row) => row.order.label)).toEqual(['red cap']);
  });

  it('⚠ narrows the list to the STORE’s days, each status by its own moment', async () => {
    const { writes, orders, prisma, magnet } = await shop();
    const sell = async () => {
      const order = await writes.create(SCOPE, BEN, null);
      return writes.addLine(SCOPE, BEN, ref(order), { itemId: magnet.id, quantity: 1 });
    };
    const late = await writes.pay(SCOPE, BEN, ref(await sell()), cash(1500));
    const early = await writes.pay(SCOPE, BEN, ref(await sell()), { ...cash(1500), clientId: 'pay-early' });
    // Held on the 1st and still open; and one held on the 1st but paid on the 2nd, which is the 2nd's.
    const held = await writes.hold(SCOPE, BEN, ref(await sell()), 'table 3', new Date('2026-10-01T02:00:00Z'));
    const stamp = (id: string, data: Record<string, unknown>) => {
      const row = prisma.state.posOrder.find((order) => order.id === id);
      if (row) Object.assign(row, data);
    };
    // 15:00Z is 11 PM on the 1st in Manila; 16:30Z the same UTC day is already the 2nd there.
    stamp(late.id, { paidAt: new Date('2026-10-01T15:00:00Z'), finalisedAt: new Date('2026-10-01T15:00:00Z') });
    stamp(early.id, {
      paidAt: new Date('2026-10-01T16:30:00Z'),
      finalisedAt: new Date('2026-10-01T16:30:00Z'),
      heldAt: new Date('2026-10-01T02:00:00Z'),
    });
    const first = { fromDay: '2026-10-01', toDay: '2026-10-01' };
    const second = { fromDay: '2026-10-02', toDay: '2026-10-02' };
    const ids = async (tab: 'all' | 'paid' | 'pending', days: typeof first | null) =>
      (await orders.list(SCOPE, tab, '', days)).map((row) => row.order.id).sort();

    expect(await ids('paid', first)).toEqual([late.id]);
    expect(await ids('paid', second)).toEqual([early.id]);
    expect(await ids('all', first)).toEqual([late.id, held.id].sort());
    expect(await ids('all', second)).toEqual([early.id]);
    expect(await ids('pending', first)).toEqual([held.id]);
    expect(await ids('pending', second)).toEqual([]);
    expect(await ids('all', { fromDay: '2026-10-01', toDay: '2026-10-02' })).toEqual(
      [late.id, early.id, held.id].sort(),
    );
    // No days: nothing is narrowed by date, so what is outstanding is listed however old.
    expect(await ids('pending', null)).toEqual([held.id]);
  });

  it('⚠ refuses days that are not a period, rather than listing every date', async () => {
    const { orders } = await shop();
    expect(await refusal(orders.list(SCOPE, 'all', '', { fromDay: '2026-10-02', toDay: '2026-10-01' }))).toBe(
      'invalid_period',
    );
    expect(await refusal(orders.list(SCOPE, 'all', '', { fromDay: 'today', toDay: '2026-10-01' }))).toBe(
      'invalid_period',
    );
  });

  it('⚠ lists a cart nobody held nowhere: only Hold makes a pending order', async () => {
    const { writes, orders, magnet } = await shop();
    let cart = await writes.create(SCOPE, BEN, null);
    cart = await writes.addLine(SCOPE, BEN, ref(cart), { itemId: magnet.id, quantity: 1 });
    const listed = async (tab: 'pending' | 'all') => (await orders.list(SCOPE, tab, '')).map((row) => row.order.id);
    expect([await listed('pending'), await listed('all')]).toEqual([[], []]);

    cart = await writes.hold(SCOPE, BEN, ref(cart), 'table 3', new Date('2026-10-03T01:00:00Z'));
    expect([await listed('pending'), await listed('all')]).toEqual([[cart.id], [cart.id]]);

    // Resumed and changed, it is still the SAME pending order, and holding it again keeps its first time.
    cart = await writes.addLine(SCOPE, BEN, ref(cart), { itemId: magnet.id, quantity: 1 });
    cart = await writes.hold(SCOPE, BEN, ref(cart), 'table 3', new Date('2026-10-03T02:00:00Z'));
    expect(await listed('pending')).toEqual([cart.id]);
    expect(cart.heldAt).toEqual(new Date('2026-10-03T01:00:00Z'));
  });

  it('copies ONE contact line onto a linked order: the phone, else the e-mail, else the Facebook link', async () => {
    const { writes, customers } = await shop();
    const facebookOnly = await customers.save(SCOPE, BEN, { name: 'Ana', facebookUrl: 'm.me/ana.cruz' });
    const both = await customers.save(SCOPE, BEN, { name: 'Juan', phone: '0917', email: 'juan@example.com' });
    let order = await writes.create(SCOPE, BEN, null);
    order = await writes.setCustomer(SCOPE, BEN, ref(order), { customerId: facebookOnly.id });
    expect(order.customerContact).toBe('https://m.me/ana.cruz');
    order = await writes.setCustomer(SCOPE, BEN, ref(order), { customerId: both.id });
    expect(order.customerContact).toBe('0917');
  });

  it('⚠ lists one customer’s orders by the LINK, not by a walk-in who typed the same name', async () => {
    const { writes, orders, customers, magnet } = await shop();
    const juan = await customers.save(SCOPE, BEN, { name: 'Juan', phone: '0917' });
    let linked = await writes.create(SCOPE, BEN, null);
    linked = await writes.addLine(SCOPE, BEN, ref(linked), { itemId: magnet.id, quantity: 1 });
    linked = await writes.setCustomer(SCOPE, BEN, ref(linked), { customerId: juan.id });
    let walkIn = await writes.create(SCOPE, BEN, null);
    walkIn = await writes.setCustomer(SCOPE, BEN, ref(walkIn), { name: 'Juan' });
    // Held, so both are orders the store lists: a cart still on a till is in nobody's history yet.
    linked = await writes.hold(SCOPE, BEN, ref(linked), null, new Date());
    walkIn = await writes.hold(SCOPE, BEN, ref(walkIn), null, new Date());
    const history = await orders.list(SCOPE, 'all', '', null, juan.id);
    expect(history.map((row) => row.order.id)).toEqual([linked.id]);
  });

  it('reports the day: sales on the day they are paid', async () => {
    const { writes, reports, magnet } = await shop();
    let order = await writes.create(SCOPE, BEN, null);
    order = await writes.addLine(SCOPE, BEN, ref(order), { itemId: magnet.id, quantity: 10 });
    order = await writes.pay(SCOPE, BEN, ref(order), cash(20_000));
    const day = (order.paidAt ?? new Date()).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    const report = await reports.report(SCOPE, day, day);
    expect(report.summary).toMatchObject({ orders: 1, netSales: 15_000, cashExpected: 15_000, profit: 9000 });
    expect(report.byStaff).toEqual([expect.objectContaining({ key: BEN, name: 'ben', net: 15_000 })]);
    // One day compares with the same weekday last week, whose series is its own — empty here.
    expect(report.series).toEqual([{ key: day, orders: 1, sales: 15_000, refunds: 0 }]);
    expect(report.previousSeries).toEqual([]);
  });

  it("draws the previous period's series from the previous period's sales", async () => {
    const { writes, reports, magnet } = await shop();
    let order = await writes.create(SCOPE, BEN, null);
    order = await writes.addLine(SCOPE, BEN, ref(order), { itemId: magnet.id, quantity: 10 });
    order = await writes.pay(SCOPE, BEN, ref(order), cash(20_000));
    const day = (order.paidAt ?? new Date()).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    // A week from the sale: its "same weekday last week" is the sale's day.
    const weekLater = new Date(Date.parse(`${day}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
    const report = await reports.report(SCOPE, weekLater, weekLater);
    expect(report.previousFromDay).toBe(day);
    expect(report.series).toEqual([]);
    expect(report.previousSeries).toEqual([{ key: day, orders: 1, sales: 15_000, refunds: 0 }]);
  });

  it('gives the takings alone, with what the goods sold cost — the bookkeeping app’s sales', async () => {
    const { writes, reports, magnet } = await shop();
    let order = await writes.create(SCOPE, BEN, null);
    order = await writes.addLine(SCOPE, BEN, ref(order), { itemId: magnet.id, quantity: 10 });
    order = await writes.pay(SCOPE, BEN, ref(order), cash(20_000));
    const day = (order.paidAt ?? new Date()).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    const { summary, truncated } = await reports.takings(SCOPE, day, day);
    // Ten magnets at ₱15 that cost ₱6 each: ₱150 taken, ₱60 of goods.
    expect(summary).toMatchObject({ orders: 1, netSales: 15_000, costOfGoods: 6000, costCoverage: 10_000 });
    expect(summary.byMethod.cash).toBe(15_000);
    expect(truncated).toBe(false);
    expect(await refusal(reports.takings(SCOPE, '2026-10-02', '2026-10-01'))).toBe('invalid_period');
  });

  it('refuses a report over a backwards or oversized period', async () => {
    const { reports } = await shop();
    expect(await refusal(reports.report(SCOPE, '2026-10-02', '2026-10-01'))).toBe('invalid_period');
    expect(await refusal(reports.report(SCOPE, '2024-01-01', '2026-01-01'))).toBe('invalid_period');
  });
});
