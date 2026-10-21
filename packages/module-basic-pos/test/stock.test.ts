import { POS_FEATURE } from '../src/feature-keys.js';
import type { PosStockEvents, PosStockLevels } from '../src/server/ports.js';
import type { PosOrderRow } from '../src/server/pos.repository.js';
import { ANA, BEN, harness, recordingStock, SCOPE } from './harness.js';

/*
 * The point of sale's side of stock (INVENTORY-PLAN §5, §6): what it tells the
 * stock app after a commit, the feed the catch-up reads, and that stock never
 * stops a sale.
 */

const ref = (order: Pick<PosOrderRow, 'id' | 'version'>) => ({ orderId: order.id, version: order.version });
const cash = (received: number, clientId: string) => ({ method: 'cash', received, clientId });

async function shop(stock: { events?: PosStockEvents; levels?: PosStockLevels } = {}) {
  const h = harness({ holders: { [POS_FEATURE.refund]: [ANA] }, stock });
  const mug = await h.catalogue.saveItem(SCOPE, ANA, { kind: 'product', name: 'Mug', price: 25_000 });
  const sintra = await h.catalogue.saveItem(SCOPE, ANA, {
    kind: 'service',
    name: 'Sintraboard Photo Print',
    price: 0,
    variants: [{ name: 'A3', price: 35_000 }],
  });
  const a3 = sintra.variants[0];
  if (!a3) throw new Error('fixture');
  return { ...h, mug: mug.item, sintra: sintra.item, a3 };
}

/** An open order with two mugs and one A3 print, ready to pay. */
async function cart(s: Awaited<ReturnType<typeof shop>>) {
  let order = await s.writes.create(SCOPE, BEN, null);
  order = await s.writes.addLine(SCOPE, BEN, ref(order), { itemId: s.mug.id, quantity: 2 });
  order = await s.writes.addLine(SCOPE, BEN, ref(order), { itemId: s.sintra.id, variantId: s.a3.id, quantity: 1 });
  return order;
}

describe('telling the stock app', () => {
  it('⚠ reports each line once when an order is paid — a retried payment reports nothing more', async () => {
    const stock = recordingStock();
    const s = await shop({ events: stock });
    const order = await cart(s);
    await s.writes.pay(SCOPE, BEN, ref(order), cash(85_000, 'pay-1'));
    await s.writes.pay(SCOPE, BEN, ref(order), cash(85_000, 'pay-1'));
    expect(stock.told.map((event) => [event.kind, 'itemId' in event ? event.itemId : null])).toEqual([
      ['finalised', s.mug.id],
      ['finalised', s.sintra.id],
    ]);
    expect(stock.told[1]).toMatchObject({ variantId: s.a3.id, quantity: 1 });
  });

  it('⚠ reports at pay later (I4), and not again when the unpaid order is paid', async () => {
    const stock = recordingStock();
    const s = await shop({ events: stock });
    let order = await cart(s);
    order = await s.writes.setCustomer(SCOPE, BEN, ref(order), { name: 'Juan', contact: '0917' });
    order = await s.writes.payLater(SCOPE, BEN, ref(order));
    expect(stock.told).toHaveLength(2);
    await s.writes.pay(SCOPE, BEN, ref(order), cash(85_000, 'pay-2'));
    expect(stock.told).toHaveLength(2);
  });

  it('reports a void of an unpaid order as its lines coming back', async () => {
    const stock = recordingStock();
    const s = await shop({ events: stock });
    let order = await cart(s);
    order = await s.writes.setCustomer(SCOPE, BEN, ref(order), { name: 'Juan', contact: '0917' });
    order = await s.writes.payLater(SCOPE, BEN, ref(order));
    await s.writes.void(SCOPE, ANA, ref(order), 'came back');
    expect(stock.told.filter((event) => event.kind === 'voided')).toHaveLength(2);
  });

  it('reports only refund lines put back on the shelf, with the line’s quantity', async () => {
    const stock = recordingStock();
    const s = await shop({ events: stock });
    let order = await cart(s);
    order = await s.writes.pay(SCOPE, BEN, ref(order), cash(85_000, 'pay-3'));
    const lines = (await s.orders.get(SCOPE, order.id))?.lines ?? [];
    const [mugLine, printLine] = lines;
    if (!mugLine || !printLine) throw new Error('fixture');
    await s.refunds.refund(SCOPE, ANA, order.id, {
      lines: [
        { lineId: mugLine.id, quantity: 1, restock: true },
        { lineId: printLine.id, quantity: 1 },
      ],
      method: 'cash',
      reason: 'changed mind',
      clientId: 'refund-1',
    });
    const returned = stock.told.filter((event) => event.kind === 'returned');
    expect(returned).toEqual([expect.objectContaining({ lineId: mugLine.id, lineQuantity: 2, quantity: 1 })]);
  });

  it('⚠ never fails a sale when the stock app is down', async () => {
    const s = await shop({ events: recordingStock({ fail: true }) });
    const order = await cart(s);
    const paid = await s.writes.pay(SCOPE, BEN, ref(order), cash(85_000, 'pay-4'));
    expect(paid.status).toBe('paid');
  });

  it('changes nothing when no stock app is bound', async () => {
    const s = await shop();
    const order = await cart(s);
    expect((await s.writes.pay(SCOPE, BEN, ref(order), cash(85_000, 'pay-5'))).status).toBe('paid');
    expect(await s.stock.tillLevels(SCOPE)).toEqual([]);
    expect(s.stock.counts).toBe(false);
  });
});

describe('the feed the catch-up reads', () => {
  it('⚠ gives back the same events as the push, a sale before its void', async () => {
    const pushed = recordingStock();
    const s = await shop({ events: pushed });
    let order = await cart(s);
    order = await s.writes.setCustomer(SCOPE, BEN, ref(order), { name: 'Juan', contact: '0917' });
    order = await s.writes.payLater(SCOPE, BEN, ref(order));
    await s.writes.void(SCOPE, ANA, ref(order), 'came back');
    const feed = await s.stock.eventsSince(SCOPE, new Date(0), 100);
    expect(feed.map((event) => event.kind)).toEqual(['finalised', 'finalised', 'voided', 'voided']);
    expect(feed).toEqual(expect.arrayContaining(pushed.told));
  });

  it('reads nothing before its cursor, and no open order', async () => {
    const s = await shop();
    await cart(s);
    expect(await s.stock.eventsSince(SCOPE, new Date(0), 100)).toEqual([]);
  });
});

describe('the till’s counts', () => {
  it('asks the stock app for every live item and variant', async () => {
    const asked: string[] = [];
    const levels: PosStockLevels = {
      async levelsFor(_org, _ws, refs) {
        asked.push(...refs.map((one) => one.variantId ?? one.itemId));
        return refs.map((one) => ({ ...one, left: one.variantId ? 3 : null }));
      },
    };
    const s = await shop({ levels });
    const answer = await s.resolver.posStockLevels(SCOPE.organizationId, SCOPE.workspaceId);
    expect(answer.counts).toBe(true);
    expect(answer.levels.find((level) => level.variantId === s.a3.id)?.left).toBe(3);
    expect(asked).toContain(s.mug.id);
  });
});
