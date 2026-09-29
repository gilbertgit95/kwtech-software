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

  it('lists the pending tab oldest first, and today’s paid orders on today', async () => {
    const { writes, orders, magnet } = await shop();
    const held = await writes.create(SCOPE, BEN, 'red cap');
    let sold = await writes.create(SCOPE, BEN, null);
    sold = await writes.addLine(SCOPE, BEN, ref(sold), { itemId: magnet.id, quantity: 1 });
    sold = await writes.pay(SCOPE, BEN, ref(sold), cash(1500));
    expect((await orders.list(SCOPE, 'pending', '', new Date())).map((row) => row.order.id)).toEqual([held.id]);
    const paidAt = sold.paidAt ?? new Date();
    expect((await orders.list(SCOPE, 'today', '', paidAt)).map((row) => row.order.id)).toEqual([sold.id]);
    expect((await orders.list(SCOPE, 'all', 'red', new Date())).map((row) => row.order.label)).toEqual(['red cap']);
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
  });

  it('refuses a report over a backwards or oversized period', async () => {
    const { reports } = await shop();
    expect(await refusal(reports.report(SCOPE, '2026-10-02', '2026-10-01'))).toBe('invalid_period');
    expect(await refusal(reports.report(SCOPE, '2024-01-01', '2026-01-01'))).toBe('invalid_period');
  });
});
