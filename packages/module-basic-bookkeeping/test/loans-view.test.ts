import { borrowerSummary, loanCountLabel, parseLoansView } from '../src/react/view/loans.js';

describe('parseLoansView', () => {
  it('restores a stored view', () => {
    expect(parseLoansView('borrowers')).toBe('borrowers');
    expect(parseLoansView('loans')).toBe('loans');
  });

  it('opens on Loans when nothing, or something unknown, is stored', () => {
    expect(parseLoansView(null)).toBe('loans');
    expect(parseLoansView('')).toBe('loans');
    expect(parseLoansView('by-borrower')).toBe('loans');
  });
});

describe('borrowerSummary', () => {
  it('adds up the borrowers and counts those still owing', () => {
    expect(
      borrowerSummary([
        { lent: 130_000, repaid: 50_000, outstanding: 80_000 },
        { lent: 22_000, repaid: 22_000, outstanding: 0 },
        { lent: 10_000, repaid: 0, outstanding: 10_000 },
      ]),
    ).toEqual({ lent: 162_000, repaid: 72_000, unpaid: 90_000, owing: 2, borrowers: 3 });
  });

  it('is all zeros with no borrowers', () => {
    expect(borrowerSummary([])).toEqual({ lent: 0, repaid: 0, unpaid: 0, owing: 0, borrowers: 0 });
  });
});

describe('loanCountLabel', () => {
  it('says how many loans, and how many are open when that tells something', () => {
    expect(loanCountLabel({ loanCount: 1, openCount: 1 })).toBe('1 loan');
    expect(loanCountLabel({ loanCount: 3, openCount: 0 })).toBe('3 loans');
    expect(loanCountLabel({ loanCount: 3, openCount: 1 })).toBe('3 loans · 1 open');
  });
});
