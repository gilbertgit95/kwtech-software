import {
  isBooksMonth,
  monthBounds,
  monthsEndingWith,
  prepareBooksDay,
  previousBooksDay,
  workspaceBooksDay,
} from '../src/domain/days.js';
import { type BooksEntryDraft, decidesShares, entryDirection, prepareBooksEntry } from '../src/domain/entries.js';
import { checkInvestorEntry, checkLoanRepayment, checkMarkFormer } from '../src/domain/investors.js';
import { cashBook, investorStatement, loanStatement } from '../src/domain/statements.js';
import { prepareBooksName } from '../src/domain/text.js';

const NONE = { putIn: 0, reinvested: 0, capitalReturned: 0, capital: 0, profitShared: 0, paidOut: 0, owed: 0 };

function draft(fields: Partial<BooksEntryDraft> & Pick<BooksEntryDraft, 'kind'>): BooksEntryDraft {
  return { amount: 1000, place: 'cash', toPlace: null, investorId: null, loanId: null, category: null, ...fields };
}

describe('days', () => {
  it('refuses a date that has not come yet, and one that does not exist', () => {
    expect(prepareBooksDay('2026-10-04', '2026-10-03')).toEqual({ refused: 'future_day' });
    expect(prepareBooksDay('2026-02-30', '2026-10-03')).toEqual({ refused: 'invalid_day' });
    expect(prepareBooksDay('2026-10-03', '2026-10-03')).toEqual({ day: '2026-10-03' });
  });

  it('⚠ takes today from the WORKSPACE’s zone: 15:00Z is the next day in Manila and the same day in London', () => {
    const instant = new Date('2026-10-03T17:00:00Z');
    expect(workspaceBooksDay(instant, 'Asia/Manila')).toBe('2026-10-04');
    expect(workspaceBooksDay(instant, 'Europe/London')).toBe('2026-10-03');
  });

  it('knows months', () => {
    expect(monthBounds('2026-02')).toEqual({ fromDay: '2026-02-01', toDay: '2026-02-28' });
    expect(monthsEndingWith('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
    expect(isBooksMonth('2026-13')).toBe(false);
    expect(previousBooksDay('2026-03-01')).toBe('2026-02-28');
  });
});

describe('prepareBooksEntry', () => {
  it('needs a category for an expense and a purchase, and trims it', () => {
    expect(prepareBooksEntry(draft({ kind: 'expense' }))).toEqual({ refused: 'invalid_category' });
    expect(prepareBooksEntry(draft({ kind: 'expense', category: '  Rent ' }))).toEqual({ category: 'Rent' });
  });

  it('needs two different places for a transfer, and one otherwise', () => {
    expect(prepareBooksEntry(draft({ kind: 'transfer', toPlace: 'cash' }))).toEqual({ refused: 'same_place' });
    expect(prepareBooksEntry(draft({ kind: 'transfer', toPlace: 'bank' }))).toEqual({ category: null });
    expect(prepareBooksEntry(draft({ kind: 'sales', toPlace: 'bank' }))).toEqual({ refused: 'invalid_place' });
  });

  it('⚠ refuses a place on a profit share or a reinvestment — it would put it in cash on hand', () => {
    expect(prepareBooksEntry(draft({ kind: 'reinvest', investorId: 'gil' }))).toEqual({ refused: 'invalid_place' });
    expect(prepareBooksEntry(draft({ kind: 'reinvest', investorId: 'gil', place: null }))).toEqual({ category: null });
  });

  it('needs an investor exactly on the investor kinds, and a loan exactly on the loan kinds', () => {
    expect(prepareBooksEntry(draft({ kind: 'payout' }))).toEqual({ refused: 'investor_required' });
    expect(prepareBooksEntry(draft({ kind: 'sales', investorId: 'gil' }))).toEqual({ refused: 'investor_required' });
    expect(prepareBooksEntry(draft({ kind: 'loan_repayment' }))).toEqual({ refused: 'loan_required' });
  });

  it('refuses ₱0, a negative, a fraction of a centavo, and more than ₱1B', () => {
    for (const amount of [0, -5, 1.5, 100_000_000_001]) {
      expect(prepareBooksEntry(draft({ kind: 'sales', amount }))).toEqual({ refused: 'invalid_amount' });
    }
  });

  it('gives every kind a direction', () => {
    expect(entryDirection('capital')).toBe('in');
    expect(entryDirection('payout')).toBe('out');
    expect(entryDirection('transfer')).toBe('transfer');
    expect(entryDirection('profit_share')).toBe('none');
  });

  it('⚠ closes what decides a profit share, and nothing else, once shared', () => {
    expect(['sales', 'expense', 'capital', 'reinvest'].every((kind) => decidesShares(kind as never))).toBe(true);
    expect(['payout', 'loan_out', 'transfer', 'purchase'].some((kind) => decidesShares(kind as never))).toBe(false);
  });
});

describe('investor and loan rules', () => {
  it('pays out at most what is owed, unless it is an advance', () => {
    const balance = { ...NONE, owed: 10_000 };
    expect(checkInvestorEntry('payout', 10_001, { balance, former: false, advance: false })).toBe('exceeds_owed');
    expect(checkInvestorEntry('payout', 10_001, { balance, former: false, advance: true })).toBeNull();
  });

  it('returns at most the capital, and reinvests at most what is owed', () => {
    expect(
      checkInvestorEntry('capital_return', 2, { balance: { ...NONE, capital: 1 }, former: false, advance: false }),
    ).toBe('exceeds_capital');
    expect(checkInvestorEntry('reinvest', 2, { balance: { ...NONE, owed: 1 }, former: false, advance: false })).toBe(
      'exceeds_owed',
    );
  });

  it('takes no capital from a former investor until they are restored', () => {
    expect(checkInvestorEntry('capital', 1, { balance: NONE, former: true, advance: false })).toBe('investor_former');
  });

  it('marks former only once the capital is back', () => {
    expect(checkMarkFormer({ ...NONE, capital: 1 })).toBe('still_invested');
    expect(checkMarkFormer({ ...NONE, owed: 500 })).toBeNull();
  });

  it('repays at most what is still owed on a loan', () => {
    expect(checkLoanRepayment(301, { lent: 500, repaid: 200, outstanding: 300, lastDay: null })).toBe('exceeds_loan');
  });

  it('refuses two names that only differ in case', () => {
    expect(prepareBooksName('Maria')).toEqual({ name: 'Maria', nameKey: 'maria' });
    expect(prepareBooksName('‮airam')).toEqual({ refused: 'invalid_name' });
  });
});

describe('statements', () => {
  it('runs Maria’s still-owed balance line by line (BOOKKEEPING-PLAN §4)', () => {
    const lines = investorStatement([
      { kind: 'profit_share', amount: 1_600_000, voided: false },
      { kind: 'payout', amount: 300_000, voided: false },
      { kind: 'payout', amount: 500_000, voided: false },
      { kind: 'payout', amount: 999, voided: true },
      { kind: 'payout', amount: 200_000, voided: false },
      { kind: 'profit_share', amount: 1_000_000, voided: false },
    ] as const);
    expect(lines.map((line) => line.owed)).toEqual([1_600_000, 1_300_000, 800_000, 800_000, 600_000, 1_600_000]);
  });

  it('moves capital and owed together on a reinvestment', () => {
    const [line] = investorStatement([{ kind: 'reinvest', amount: 100, voided: false }] as const);
    expect([line?.capitalChange, line?.owedChange]).toEqual([100, -100]);
  });

  it('runs a loan down to zero', () => {
    const lines = loanStatement([
      { kind: 'loan_out', amount: 500, voided: false },
      { kind: 'loan_repayment', amount: 500, voided: false },
    ] as const);
    expect(lines.map((line) => line.outstanding)).toEqual([500, 0]);
  });

  it('runs the cash book from the opening balance', () => {
    const lines = cashBook(
      [
        { kind: 'sales', amount: 100, place: 'cash', toPlace: null, voided: false },
        { kind: 'transfer', amount: 50, place: 'cash', toPlace: 'bank', voided: false },
        { kind: 'expense', amount: 30, place: 'cash', toPlace: null, voided: false },
      ] as const,
      1000,
    );
    expect(lines.map((line) => [line.change, line.balance])).toEqual([
      [100, 1100],
      [0, 1100],
      [-30, 1070],
    ]);
  });
});
