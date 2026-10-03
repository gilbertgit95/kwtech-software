import { BOOKS_FEATURE } from '../src/feature-keys.js';
import { ANA, addInvestor, cid, fixedSales, harness, invest, NOW, record, refusedWith, SCOPE } from './harness.js';

/**
 * Bringing the point of sale's takings in: once per day, in order, whole days,
 * and never past what the POS could count.
 */

const TAKINGS = { cash: 400_000, ewallet: 150_000, bank: 50_000, costOfGoods: 200_000, orders: 42 };

async function connected(figures: Parameters<typeof fixedSales>[0] = TAKINGS) {
  const sales = fixedSales(figures);
  const h = harness({ sales, holders: { [BOOKS_FEATURE.manageInvestors]: [ANA] } });
  await h.investors.saveSettings(SCOPE, ANA, { shareMode: 'capital', posImportFrom: '2026-09-01' });
  return { h, sales };
}

describe('bringing in point-of-sale sales', () => {
  it('⚠ refuses when there is no point of sale, or none was connected — never an empty import', async () => {
    const none = harness();
    await refusedWith(none.pos.record(SCOPE, ANA, { toDay: '2026-09-30', clientId: cid() }, NOW), 'pos_not_connected');
    const off = harness({ sales: fixedSales() });
    await refusedWith(off.pos.preview(SCOPE, '2026-09-30', NOW), 'pos_not_connected');
  });

  it('records one sales entry per place money came in, with the cost of goods kept for profit', async () => {
    const { h, sales } = await connected();
    const batch = await h.pos.record(SCOPE, ANA, { toDay: '2026-09-30', clientId: cid() }, NOW);
    expect([batch.fromDay, batch.toDay, batch.costOfGoods, batch.orders]).toEqual([
      '2026-09-01',
      '2026-09-30',
      200_000,
      42,
    ]);
    expect(sales.asked).toEqual([['2026-09-01', '2026-09-30']]);

    const overview = await h.ledger.overview(SCOPE, NOW);
    expect(overview.money).toEqual({ cash: 400_000, ewallet: 150_000, bank: 50_000, total: 600_000 });
    expect(overview.months.find((month) => month.month === '2026-09')).toMatchObject({
      sales: 600_000,
      costOfGoods: 200_000,
      profit: 400_000,
    });
    expect(overview.pos).toMatchObject({ connected: true, recordedThrough: '2026-09-30', nextFromDay: '2026-10-01' });
  });

  it('⚠ brings each day in once: the next import starts the day after the last', async () => {
    const { h, sales } = await connected();
    await h.pos.record(SCOPE, ANA, { toDay: '2026-09-30', clientId: cid() }, NOW);
    await refusedWith(h.pos.record(SCOPE, ANA, { toDay: '2026-09-30', clientId: cid() }, NOW), 'pos_nothing_new');
    await h.pos.record(SCOPE, ANA, { toDay: '2026-10-02', clientId: cid() }, NOW);
    expect(sales.asked).toEqual([
      ['2026-09-01', '2026-09-30'],
      ['2026-10-01', '2026-10-02'],
    ]);
  });

  it('records a place whose refunds outran its sales as a refund, never a negative sale', async () => {
    const { h } = await connected({ cash: -5_000, ewallet: 0, bank: 0 });
    await h.pos.record(SCOPE, ANA, { toDay: '2026-09-30', clientId: cid() }, NOW);
    expect(h.prisma.state.booksEntry.map((row) => [row.kind, row.amount])).toEqual([['refund', 5000n]]);
  });

  it('⚠ refuses figures the POS could not count whole', async () => {
    const { h } = await connected({ ...TAKINGS, truncated: true });
    await refusedWith(h.pos.record(SCOPE, ANA, { toDay: '2026-09-30', clientId: cid() }, NOW), 'pos_truncated');
    expect(h.prisma.state.booksSalesImport).toHaveLength(0);
  });

  it('refuses days that have not come yet', async () => {
    const { h } = await connected();
    await refusedWith(h.pos.record(SCOPE, ANA, { toDay: '2026-10-04', clientId: cid() }, NOW), 'future_day');
  });

  it('⚠ holds profit sharing until the sales are in through the last day', async () => {
    const { h } = await connected();
    const gil = await addInvestor(h, 'Gilbert');
    await invest(h, { kind: 'capital', investorId: gil.id, amount: 100_000 });
    const before = await h.investors.preview(SCOPE, '2026-09-30', 0, NOW);
    expect(before).toMatchObject({ ok: false });
    expect(before.refusal).toMatch(/Bring in the point of sale/);

    await h.pos.record(SCOPE, ANA, { toDay: '2026-09-30', clientId: cid() }, NOW);
    expect(await h.investors.preview(SCOPE, '2026-09-30', 0, NOW)).toMatchObject({ ok: true, shared: 400_000 });
  });

  it('voids the whole latest import from any of its entries, and the days can come in again', async () => {
    const { h, sales } = await connected();
    await h.pos.record(SCOPE, ANA, { toDay: '2026-09-15', clientId: cid() }, NOW);
    const latest = await h.pos.record(SCOPE, ANA, { toDay: '2026-09-30', clientId: cid() }, NOW);
    const firstEntry = h.prisma.state.booksEntry.find((row) => row.importId !== latest.id);
    await refusedWith(h.entries.void(SCOPE, ANA, String(firstEntry?.id), 'x'), 'not_latest');

    const entry = h.prisma.state.booksEntry.find((row) => row.importId === latest.id);
    await h.entries.void(SCOPE, ANA, String(entry?.id), 'Counted before the refunds');
    expect(h.prisma.state.booksEntry.filter((row) => row.importId === latest.id).every((row) => row.voidedAt)).toBe(
      true,
    );
    const overview = await h.ledger.overview(SCOPE, NOW);
    expect(overview.pos.nextFromDay).toBe('2026-09-16');

    await h.pos.record(SCOPE, ANA, { toDay: '2026-09-30', clientId: cid() }, NOW);
    expect(sales.asked.at(-1)).toEqual(['2026-09-16', '2026-09-30']);
  });

  it('does not mix hand-recorded sales with imported ones', async () => {
    const { h } = await connected();
    await record(h, { kind: 'sales', amount: 1000, day: '2026-08-31' });
    await h.pos.record(SCOPE, ANA, { toDay: '2026-09-30', clientId: cid() }, NOW);
    expect((await h.ledger.overview(SCOPE, NOW)).money.total).toBe(601_000);
  });
});
