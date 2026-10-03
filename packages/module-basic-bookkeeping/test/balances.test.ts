import {
  allocate,
  type BooksLedgerEntry,
  checkAgreedShares,
  investorBalances,
  loanBalances,
  moneyOnHand,
  profitShares,
} from '../src/domain/balances.js';

/** An entry with the fields the sums ignore filled in. */
function entry(fields: Partial<BooksLedgerEntry> & Pick<BooksLedgerEntry, 'kind' | 'amount'>): BooksLedgerEntry {
  return {
    place: 'cash',
    toPlace: null,
    day: '2026-10-01',
    investorId: null,
    loanId: null,
    voided: false,
    ...fields,
  };
}

describe('moneyOnHand', () => {
  it('adds money in and takes money out, per place', () => {
    const money = moneyOnHand([
      entry({ kind: 'capital', amount: 1_500_000, investorId: 'gil' }),
      entry({ kind: 'sales', amount: 300_000, place: 'ewallet' }),
      entry({ kind: 'expense', amount: 100_000 }),
      entry({ kind: 'payout', amount: 50_000, place: 'ewallet', investorId: 'gil' }),
    ]);
    expect(money).toEqual({ cash: 1_400_000, ewallet: 250_000, bank: 0, total: 1_650_000 });
  });

  it('moves a transfer between places and leaves the total alone', () => {
    const money = moneyOnHand([
      entry({ kind: 'sales', amount: 100_000 }),
      entry({ kind: 'transfer', amount: 60_000, place: 'cash', toPlace: 'bank' }),
    ]);
    expect(money).toEqual({ cash: 40_000, ewallet: 0, bank: 60_000, total: 100_000 });
  });

  it('⚠ counts a voided entry for nothing', () => {
    expect(moneyOnHand([entry({ kind: 'sales', amount: 100_000, voided: true })]).total).toBe(0);
  });

  it('⚠ moves no money for a profit share or a reinvestment', () => {
    const money = moneyOnHand([
      entry({ kind: 'profit_share', amount: 100_000, place: null, investorId: 'gil' }),
      entry({ kind: 'reinvest', amount: 50_000, place: null, investorId: 'gil' }),
    ]);
    expect(money.total).toBe(0);
  });

  it('shows a balance below zero rather than hiding it — something is not recorded yet', () => {
    expect(moneyOnHand([entry({ kind: 'expense', amount: 10_000 })]).cash).toBe(-10_000);
  });

  it('stops at a day when asked: the opening of a month', () => {
    const entries = [
      entry({ kind: 'sales', amount: 100, day: '2026-09-30' }),
      entry({ kind: 'sales', amount: 5, day: '2026-10-01' }),
    ];
    expect(moneyOnHand(entries, '2026-09-30').total).toBe(100);
  });
});

describe('investorBalances', () => {
  it('follows capital and what is owed through every kind', () => {
    const balances = investorBalances([
      entry({ kind: 'capital', amount: 1_500_000, investorId: 'gil' }),
      entry({ kind: 'profit_share', amount: 160_000, place: null, investorId: 'gil' }),
      entry({ kind: 'payout', amount: 30_000, investorId: 'gil' }),
      entry({ kind: 'reinvest', amount: 50_000, place: null, investorId: 'gil' }),
      entry({ kind: 'capital_return', amount: 500_000, investorId: 'gil' }),
    ]);
    expect(balances.get('gil')).toEqual({
      putIn: 1_500_000,
      reinvested: 50_000,
      capitalReturned: 500_000,
      capital: 1_050_000,
      profitShared: 160_000,
      paidOut: 30_000,
      owed: 80_000,
    });
  });

  it('shows an advance as negative owed', () => {
    const balances = investorBalances([entry({ kind: 'payout', amount: 10_000, investorId: 'gil' })]);
    expect(balances.get('gil')?.owed).toBe(-10_000);
  });
});

describe('loanBalances', () => {
  it('is what was lent less what was repaid, with the last day anything moved', () => {
    const balances = loanBalances([
      entry({ kind: 'loan_out', amount: 500_000, loanId: 'l1', day: '2026-09-01' }),
      entry({ kind: 'loan_repayment', amount: 200_000, loanId: 'l1', day: '2026-09-20' }),
      entry({ kind: 'loan_repayment', amount: 50_000, loanId: 'l1', day: '2026-09-10', voided: true }),
    ]);
    expect(balances.get('l1')).toEqual({ lent: 500_000, repaid: 200_000, outstanding: 300_000, lastDay: '2026-09-20' });
  });
});

describe('allocate', () => {
  it('⚠ splits to the centavo and adds up to exactly the amount', () => {
    const parts = allocate(
      10_000,
      new Map([
        ['a', 1],
        ['b', 1],
        ['c', 1],
      ]),
    );
    expect([...parts.values()].reduce((sum, part) => sum + part, 0)).toBe(10_000);
    expect(parts).toEqual(
      new Map([
        ['a', 3334],
        ['b', 3333],
        ['c', 3333],
      ]),
    );
  });

  it('splits by weight: ₱15,000 and ₱10,000 of capital share 60/40', () => {
    expect(
      allocate(
        1_000_000,
        new Map([
          ['gil', 1_500_000],
          ['maria', 1_000_000],
        ]),
      ),
    ).toEqual(
      new Map([
        ['gil', 600_000],
        ['maria', 400_000],
      ]),
    );
  });

  it('gives nothing to a zero weight, and nothing at all from nothing', () => {
    expect(
      allocate(
        100,
        new Map([
          ['a', 0],
          ['b', 5],
        ]),
      ),
    ).toEqual(new Map([['b', 100]]));
    expect(allocate(0, new Map([['a', 1]]))).toEqual(new Map());
  });

  it('⚠ does not lose digits on huge products', () => {
    const parts = allocate(
      100_000_000_000,
      new Map([
        ['a', 100_000_000_000],
        ['b', 33_333_333_333],
      ]),
    );
    expect([...parts.values()].reduce((sum, part) => sum + part, 0)).toBe(100_000_000_000);
  });
});

describe('profitShares', () => {
  const balances = investorBalances([
    entry({ kind: 'capital', amount: 1_500_000, investorId: 'gil' }),
    entry({ kind: 'capital', amount: 1_000_000, investorId: 'maria' }),
  ]);

  it('shares by capital by default', () => {
    const split = profitShares(
      [
        { id: 'gil', agreedShare: null, former: false },
        { id: 'maria', agreedShare: null, former: false },
      ],
      balances,
      'capital',
    );
    expect('shares' in split ? split.shares : null).toEqual(
      new Map([
        ['gil', 6000],
        ['maria', 4000],
      ]),
    );
  });

  it('shares by the agreed percentages when agreed', () => {
    const split = profitShares(
      [
        { id: 'gil', agreedShare: 5000, former: false },
        { id: 'maria', agreedShare: 5000, former: false },
      ],
      balances,
      'agreed',
    );
    expect('shares' in split ? split.shares : null).toEqual(
      new Map([
        ['gil', 5000],
        ['maria', 5000],
      ]),
    );
  });

  it('⚠ refuses agreed shares that do not add up to 100%', () => {
    expect(checkAgreedShares([{ agreedShare: 5000 }, { agreedShare: 4000 }])).toBe('shares_incomplete');
    expect(checkAgreedShares([{ agreedShare: 5000 }, { agreedShare: null }])).toBe('shares_incomplete');
  });

  it('leaves former investors out', () => {
    const split = profitShares(
      [
        { id: 'gil', agreedShare: null, former: false },
        { id: 'maria', agreedShare: null, former: true },
      ],
      balances,
      'capital',
    );
    expect('shares' in split ? split.shares : null).toEqual(new Map([['gil', 10_000]]));
  });

  it('says there is nobody to share with when nobody has capital', () => {
    expect(profitShares([{ id: 'gil', agreedShare: null, former: false }], new Map(), 'capital')).toEqual({
      refused: 'no_investors',
    });
  });
});
