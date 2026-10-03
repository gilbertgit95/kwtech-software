import { BOOKS_FEATURE } from '../src/feature-keys.js';
import { ANA, addInvestor, BEN, cid, harness, invest, NOW, OTHER, record, refusedWith, SCOPE } from './harness.js';

/**
 * The books end to end, against the fake database: what the operator asked
 * for — investors, reinvestment, cash on hand from sales, loans, paying
 * investors — each with the refusals that keep the numbers honest.
 */

/** Gilbert ₱15,000 and Maria ₱10,000, put in on 1 Sep. */
async function twoInvestors(h: ReturnType<typeof harness>) {
  const gil = await addInvestor(h, 'Gilbert');
  const maria = await addInvestor(h, 'Maria');
  await invest(h, { kind: 'capital', investorId: gil.id, amount: 1_500_000 });
  await invest(h, { kind: 'capital', investorId: maria.id, amount: 1_000_000, place: 'ewallet' });
  return { gil, maria };
}

describe('cash on hand and the overview', () => {
  it('adds up capital, sales and spending into cash on hand, per place', async () => {
    const h = harness();
    await twoInvestors(h);
    await record(h, { kind: 'purchase', amount: 1_500_000, category: 'Equipment', day: '2026-09-02' });
    await record(h, { kind: 'sales', amount: 300_000 });
    await record(h, { kind: 'expense', amount: 50_000 });
    await record(h, { kind: 'transfer', amount: 100_000, place: 'ewallet', toPlace: 'bank' });

    const overview = await h.ledger.overview(SCOPE, NOW);
    expect(overview.money).toEqual({ cash: 250_000, ewallet: 900_000, bank: 100_000, total: 1_250_000 });
    expect(overview.investors.map((investor) => [investor.name, investor.capital, investor.share])).toEqual([
      ['Gilbert', 1_500_000, 6000],
      ['Maria', 1_000_000, 4000],
    ]);
    expect(overview.unshared?.profit).toBe(250_000);
    expect(overview.today).toBe('2026-10-03');
  });

  it('⚠ records a second press of the same form once', async () => {
    const h = harness();
    const input = { kind: 'sales', amount: 5000, place: 'cash', day: '2026-10-01', clientId: 'same' };
    const first = await h.entries.record(SCOPE, ANA, input, NOW);
    const second = await h.entries.record(SCOPE, ANA, input, NOW);
    expect(second.id).toBe(first.id);
    expect(h.prisma.state.booksEntry).toHaveLength(1);
  });

  it('refuses money dated in the future — the WORKSPACE’s today, not the server’s', async () => {
    const h = harness();
    await refusedWith(record(h, { kind: 'sales', amount: 100, day: '2026-10-04' }), 'future_day');
  });

  it('keeps investors’ money and lending out of the day-to-day form', async () => {
    const h = harness();
    await refusedWith(record(h, { kind: 'capital', amount: 100 }), 'invalid_kind');
    await refusedWith(record(h, { kind: 'loan_out', amount: 100 }), 'invalid_kind');
    await refusedWith(record(h, { kind: 'profit_share', amount: 100 }), 'invalid_kind');
  });

  it('announces a change after it is saved, with no amounts in it', async () => {
    const h = harness();
    await record(h, { kind: 'sales', amount: 100 });
    expect(h.pubsub.sent).toEqual([{ ...SCOPE, change: 'books', actorId: ANA }]);
  });

  it('⚠ keeps each workspace’s books to itself', async () => {
    const h = harness({ holders: { [BOOKS_FEATURE.manageInvestors]: [ANA] } });
    const entry = await record(h, { kind: 'sales', amount: 100 });
    await refusedWith(h.entries.void(OTHER, ANA, entry.id, 'mistake'), 'not_found');
    expect((await h.ledger.overview(OTHER, NOW)).money.total).toBe(0);
  });
});

describe('paying investors', () => {
  it('⚠ pays out at most what they are owed — unless marked an advance', async () => {
    const h = harness();
    const { maria } = await twoInvestors(h);
    await refusedWith(invest(h, { kind: 'payout', investorId: maria.id, amount: 100 }), 'exceeds_owed');
    await invest(h, { kind: 'payout', investorId: maria.id, amount: 100, advance: true });
    const overview = await h.ledger.overview(SCOPE, NOW);
    expect(overview.investors.find((investor) => investor.id === maria.id)?.owed).toBe(-100);
  });

  it('returns capital, and moves the shares with it', async () => {
    const h = harness();
    const { gil } = await twoInvestors(h);
    await invest(h, { kind: 'capital_return', investorId: gil.id, amount: 500_000 });
    await refusedWith(invest(h, { kind: 'capital_return', investorId: gil.id, amount: 1_000_001 }), 'exceeds_capital');
    const overview = await h.ledger.overview(SCOPE, NOW);
    expect(overview.investors.map((investor) => investor.share)).toEqual([5000, 5000]);
  });

  it('marks an investor former only once their capital is back', async () => {
    const h = harness();
    const { maria } = await twoInvestors(h);
    await refusedWith(h.investors.setFormer(SCOPE, ANA, maria.id, true), 'still_invested');
    await invest(h, { kind: 'capital_return', investorId: maria.id, amount: 1_000_000 });
    const former = await h.investors.setFormer(SCOPE, ANA, maria.id, true);
    expect(former.formerAt).not.toBeNull();
    await refusedWith(invest(h, { kind: 'capital', investorId: maria.id, amount: 1 }), 'investor_former');
  });

  it('refuses a second investor of the same name, whatever the case', async () => {
    const h = harness();
    await addInvestor(h, 'Maria');
    await refusedWith(addInvestor(h, 'maria'), 'duplicate_name');
  });
});

describe('sharing profit', () => {
  /** September: capital, a ₱10,000 sale and ₱2,000 of rent — ₱8,000 profit. */
  async function september() {
    const h = harness();
    const people = await twoInvestors(h);
    await record(h, { kind: 'sales', amount: 1_000_000, day: '2026-09-15' });
    await record(h, { kind: 'expense', amount: 200_000, day: '2026-09-20' });
    return { h, ...people };
  }

  it('previews and shares a period 60/40, owing each their part', async () => {
    const { h, gil, maria } = await september();
    const preview = await h.investors.preview(SCOPE, '2026-09-30', 0, NOW);
    expect(preview).toMatchObject({ ok: true, fromDay: '2026-09-01', shared: 800_000 });

    const share = await h.investors.share(SCOPE, ANA, { toDay: '2026-09-30', kept: 0, clientId: cid() }, NOW);
    expect(share.parts.map((part) => [part.investorId, part.amount])).toEqual([
      [gil.id, 480_000],
      [maria.id, 320_000],
    ]);
    const overview = await h.ledger.overview(SCOPE, NOW);
    expect(overview.sharedThrough).toBe('2026-09-30');
    expect(overview.owedToInvestors).toBe(800_000);
    // Shared profit is owed, not paid: cash on hand has not moved.
    expect(overview.money.total).toBe(2_500_000 + 800_000);
  });

  it('pays Maria in parts against a running balance (BOOKKEEPING-PLAN §4)', async () => {
    const { h, maria } = await september();
    await h.investors.share(SCOPE, ANA, { toDay: '2026-09-30', kept: 0, clientId: cid() }, NOW);
    await invest(h, { kind: 'payout', investorId: maria.id, amount: 100_000, day: '2026-10-01' });
    await invest(h, { kind: 'payout', investorId: maria.id, amount: 200_000, day: '2026-10-02', place: 'ewallet' });
    await refusedWith(
      invest(h, { kind: 'payout', investorId: maria.id, amount: 20_001, day: '2026-10-03' }),
      'exceeds_owed',
    );
    const page = await h.ledger.entries(SCOPE, { investorId: maria.id }, NOW);
    expect(page.entries.map((entry) => entry.kind)).toEqual(['capital', 'profit_share', 'payout', 'payout']);
  });

  it('⚠ closes the shared period to what decides a share, but not to a late payout', async () => {
    const { h, maria } = await september();
    await h.investors.share(SCOPE, ANA, { toDay: '2026-09-30', kept: 0, clientId: cid() }, NOW);
    await refusedWith(record(h, { kind: 'expense', amount: 100, day: '2026-09-25' }), 'day_shared');
    await refusedWith(
      invest(h, { kind: 'capital', investorId: maria.id, amount: 100, day: '2026-09-25' }),
      'day_shared',
    );
    await invest(h, { kind: 'payout', investorId: maria.id, amount: 100, day: '2026-09-25' });
  });

  it('reinvests owed profit as capital, moving no money', async () => {
    const { h, maria } = await september();
    await h.investors.share(SCOPE, ANA, { toDay: '2026-09-30', kept: 0, clientId: cid() }, NOW);
    const before = (await h.ledger.overview(SCOPE, NOW)).money.total;
    await invest(h, { kind: 'reinvest', investorId: maria.id, amount: 320_000, place: null, day: '2026-10-01' });
    const overview = await h.ledger.overview(SCOPE, NOW);
    const after = overview.investors.find((investor) => investor.id === maria.id);
    expect([after?.capital, after?.owed, overview.money.total]).toEqual([1_320_000, 0, before]);
  });

  it('keeps part of the profit in the business', async () => {
    const { h } = await september();
    const share = await h.investors.share(SCOPE, ANA, { toDay: '2026-09-30', kept: 300_000, clientId: cid() }, NOW);
    expect([share.kept, share.shared, share.parts.map((part) => part.amount)]).toEqual([
      300_000,
      500_000,
      [300_000, 200_000],
    ]);
  });

  it('voids only the latest share, and reopens its period', async () => {
    const { h } = await september();
    const first = await h.investors.share(SCOPE, ANA, { toDay: '2026-09-30', kept: 0, clientId: cid() }, NOW);
    await record(h, { kind: 'sales', amount: 100_000, day: '2026-10-01' });
    await h.investors.share(SCOPE, ANA, { toDay: '2026-10-02', kept: 0, clientId: cid() }, NOW);
    await refusedWith(h.investors.voidShare(SCOPE, ANA, first.id, 'wrong'), 'not_latest');

    const latest = (await h.ledger.overview(SCOPE, NOW)).shares[0];
    await h.investors.voidShare(SCOPE, ANA, latest?.id ?? '', 'wrong rent');
    const overview = await h.ledger.overview(SCOPE, NOW);
    expect([overview.sharedThrough, overview.unsharedFrom, overview.owedToInvestors]).toEqual([
      '2026-09-30',
      '2026-10-01',
      800_000,
    ]);
  });

  it('refuses a profit share entry voided on its own', async () => {
    const { h } = await september();
    await h.investors.share(SCOPE, ANA, { toDay: '2026-09-30', kept: 0, clientId: cid() }, NOW);
    const part = h.prisma.state.booksEntry.find((row) => row.kind === 'profit_share');
    await refusedWith(h.entries.void(SCOPE, ANA, String(part?.id), 'no'), 'part_of_share');
  });
});

describe('voiding', () => {
  it('keeps a voided entry, with who and why, and counts it for nothing', async () => {
    const h = harness();
    const entry = await record(h, { kind: 'sales', amount: 5000 });
    const voided = await h.entries.void(SCOPE, BEN, entry.id, 'Entered twice');
    expect([voided.voidedById, voided.voidReason]).toEqual([BEN, 'Entered twice']);
    await refusedWith(h.entries.void(SCOPE, BEN, entry.id, 'again'), 'already_voided');
    expect((await h.ledger.overview(SCOPE, NOW)).money.total).toBe(0);
    await refusedWith(h.entries.void(SCOPE, BEN, entry.id, '  '), 'reason_required');
  });

  it('⚠ voids an investor’s money only for someone who manages investors — no port, nobody', async () => {
    const unbound = harness();
    const gil = await addInvestor(unbound, 'Gilbert');
    const capital = await invest(unbound, { kind: 'capital', investorId: gil.id, amount: 100 });
    await refusedWith(unbound.entries.void(SCOPE, ANA, capital.id, 'x'), 'not_permitted');

    const h = harness({ holders: { [BOOKS_FEATURE.manageInvestors]: [ANA] } });
    const maria = await addInvestor(h, 'Maria');
    const put = await invest(h, { kind: 'capital', investorId: maria.id, amount: 100 });
    await refusedWith(h.entries.void(SCOPE, BEN, put.id, 'x'), 'not_permitted');
    await h.entries.void(SCOPE, ANA, put.id, 'x');
  });

  it('refuses a void that would leave capital below zero', async () => {
    const h = harness({ holders: { [BOOKS_FEATURE.manageInvestors]: [ANA] } });
    const gil = await addInvestor(h, 'Gilbert');
    const put = await invest(h, { kind: 'capital', investorId: gil.id, amount: 1000 });
    await invest(h, { kind: 'capital_return', investorId: gil.id, amount: 1000 });
    await refusedWith(h.entries.void(SCOPE, ANA, put.id, 'x'), 'exceeds_capital');
  });
});

describe('loans', () => {
  it('lends, takes repayments up to what is owed, and refuses voiding the loan under them', async () => {
    const h = harness();
    const loan = await h.entries.lend(
      SCOPE,
      ANA,
      { borrowerName: 'Jun', amount: 500_000, place: 'cash', day: '2026-09-10', clientId: cid() },
      NOW,
    );
    expect([loan.lent, loan.outstanding]).toEqual([500_000, 500_000]);
    await record(h, { kind: 'loan_repayment', amount: 200_000, loanId: loan.id, day: '2026-09-20' });
    await refusedWith(record(h, { kind: 'loan_repayment', amount: 300_001, loanId: loan.id }), 'exceeds_loan');

    const more = await h.entries.lend(
      SCOPE,
      ANA,
      { loanId: loan.id, amount: 100_000, place: 'cash', day: '2026-09-25', clientId: cid() },
      NOW,
    );
    expect(more.outstanding).toBe(400_000);

    const lent = h.prisma.state.booksEntry.find((row) => row.kind === 'loan_out');
    await refusedWith(h.entries.void(SCOPE, ANA, String(lent?.id), 'x'), 'exceeds_loan');
    const overview = await h.ledger.overview(SCOPE, NOW);
    expect([overview.lentOutstanding, overview.money.cash]).toEqual([400_000, -400_000]);
  });

  it('needs a borrower for a new loan', async () => {
    const h = harness();
    await refusedWith(
      h.entries.lend(
        SCOPE,
        ANA,
        { borrowerName: ' ', amount: 1, place: 'cash', day: '2026-10-01', clientId: cid() },
        NOW,
      ),
      'invalid_name',
    );
  });
});
