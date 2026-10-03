import type { BooksLedgerEntry } from '../src/domain/balances.js';
import {
  type BooksProfitShareInput,
  nextShareFrom,
  planProfitShare,
  profitBetween,
  profitByMonth,
} from '../src/domain/profit.js';

function entry(fields: Partial<BooksLedgerEntry> & Pick<BooksLedgerEntry, 'kind' | 'amount'>): BooksLedgerEntry {
  return { place: 'cash', toPlace: null, day: '2026-10-01', investorId: null, loanId: null, voided: false, ...fields };
}

/** Gilbert ₱15,000 and Maria ₱10,000 in September; a month of trade in October. */
const ENTRIES: BooksLedgerEntry[] = [
  entry({ kind: 'capital', amount: 1_500_000, investorId: 'gil', day: '2026-09-01' }),
  entry({ kind: 'capital', amount: 1_000_000, investorId: 'maria', day: '2026-09-01' }),
  entry({ kind: 'purchase', amount: 1_500_000, day: '2026-09-02' }),
  entry({ kind: 'sales', amount: 900_000, day: '2026-10-05' }),
  entry({ kind: 'refund', amount: 50_000, day: '2026-10-06' }),
  entry({ kind: 'expense', amount: 200_000, day: '2026-10-10' }),
  entry({ kind: 'expense', amount: 999_999, day: '2026-10-11', voided: true }),
  entry({ kind: 'loan_out', amount: 100_000, loanId: 'l1', day: '2026-10-12' }),
];

const IMPORTS = [
  { toDay: '2026-10-05', costOfGoods: 150_000, voided: false },
  { toDay: '2026-10-07', costOfGoods: 70_000, voided: true },
];

describe('profitBetween', () => {
  it('⚠ is sales − refunds − cost of goods − expenses; purchases, loans and capital are not in it', () => {
    expect(profitBetween(ENTRIES, IMPORTS, '2026-10-01', '2026-10-31')).toEqual({
      sales: 900_000,
      refunds: 50_000,
      costOfGoods: 150_000,
      expenses: 200_000,
      profit: 500_000,
      purchases: 0,
    });
  });

  it('shows purchases beside profit, never in it', () => {
    const september = profitBetween(ENTRIES, IMPORTS, '2026-09-01', '2026-09-30');
    expect(september.purchases).toBe(1_500_000);
    expect(september.profit).toBe(0);
  });

  it('groups by month', () => {
    const months = profitByMonth(ENTRIES, IMPORTS, ['2026-09', '2026-10']);
    expect(months.map((month) => [month.month, month.profit])).toEqual([
      ['2026-09', 0],
      ['2026-10', 500_000],
    ]);
  });
});

describe('nextShareFrom', () => {
  it('starts at the first entry when nothing was shared, and the day after the last share otherwise', () => {
    expect(nextShareFrom(ENTRIES, null)).toBe('2026-09-01');
    expect(nextShareFrom(ENTRIES, '2026-09-30')).toBe('2026-10-01');
    expect(nextShareFrom([], null)).toBeNull();
  });
});

describe('planProfitShare', () => {
  const base: BooksProfitShareInput = {
    investors: [
      { id: 'gil', agreedShare: null, former: false },
      { id: 'maria', agreedShare: null, former: false },
    ],
    entries: ENTRIES,
    imports: IMPORTS,
    mode: 'capital',
    sharedThrough: '2026-09-30',
    pos: { connected: false, recordedThrough: null },
    toDay: '2026-10-31',
    today: '2026-11-02',
    kept: 0,
  };

  it('splits October’s ₱5,000 profit 60/40 by capital', () => {
    const plan = planProfitShare(base);
    expect(plan).toMatchObject({ kind: 'share', fromDay: '2026-10-01', toDay: '2026-10-31', shared: 500_000 });
    expect(plan.kind === 'share' ? plan.parts : []).toEqual([
      { investorId: 'gil', share: 6000, amount: 300_000 },
      { investorId: 'maria', share: 4000, amount: 200_000 },
    ]);
  });

  it('keeps what the owners keep in the business, and splits the rest', () => {
    const plan = planProfitShare({ ...base, kept: 100_000 });
    expect(plan.kind === 'share' ? [plan.kept, plan.shared, plan.parts.map((part) => part.amount)] : null).toEqual([
      100_000,
      400_000,
      [240_000, 160_000],
    ]);
  });

  it('⚠ weighs capital as it stood on the last day: capital put in after the period earned nothing in it', () => {
    const late = [...ENTRIES, entry({ kind: 'capital', amount: 10_000_000, investorId: 'maria', day: '2026-11-01' })];
    const plan = planProfitShare({ ...base, entries: late });
    expect(plan.kind === 'share' ? plan.parts.map((part) => part.share) : null).toEqual([6000, 4000]);
  });

  it('⚠ refuses while the point of sale’s sales are not in through the last day', () => {
    expect(planProfitShare({ ...base, pos: { connected: true, recordedThrough: '2026-10-30' } })).toMatchObject({
      kind: 'refused',
      reason: 'sales_not_recorded',
    });
    expect(planProfitShare({ ...base, pos: { connected: true, recordedThrough: '2026-10-31' } }).kind).toBe('share');
  });

  it('⚠ does not share a loss: the period stays open, and the loss comes off the next profit', () => {
    const loss = [...ENTRIES, entry({ kind: 'expense', amount: 600_000, day: '2026-10-20' })];
    expect(planProfitShare({ ...base, entries: loss })).toMatchObject({ kind: 'refused', reason: 'no_profit' });
  });

  it('refuses a period that runs past today, or ends before it starts', () => {
    expect(planProfitShare({ ...base, toDay: '2026-11-03' })).toMatchObject({ reason: 'invalid_period' });
    expect(planProfitShare({ ...base, toDay: '2026-09-30' })).toMatchObject({ reason: 'invalid_period' });
  });

  it('refuses keeping more than the profit, or a fraction of a centavo', () => {
    expect(planProfitShare({ ...base, kept: 500_001 })).toMatchObject({ reason: 'invalid_kept' });
    expect(planProfitShare({ ...base, kept: 0.5 })).toMatchObject({ reason: 'invalid_kept' });
  });

  it('refuses agreed shares that do not add up', () => {
    const investors = [
      { id: 'gil', agreedShare: 5000, former: false },
      { id: 'maria', agreedShare: 4000, former: false },
    ];
    expect(planProfitShare({ ...base, mode: 'agreed', investors })).toMatchObject({ reason: 'shares_incomplete' });
  });
});
