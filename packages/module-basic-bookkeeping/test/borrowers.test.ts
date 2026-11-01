import { type BooksBorrowerLoan, borrowerKey, borrowerTotals } from '../src/domain/borrowers.js';

/** A loan with the fields grouping ignores filled in. */
function loan(fields: Partial<BooksBorrowerLoan> & Pick<BooksBorrowerLoan, 'id' | 'borrowerName'>): BooksBorrowerLoan {
  return { lent: 0, repaid: 0, outstanding: 0, lastDay: null, createdAt: '2026-10-01T00:00:00.000Z', ...fields };
}

describe('borrowerKey', () => {
  it('makes names that differ only in case or spacing the same borrower', () => {
    expect(borrowerKey('Juan Dela Cruz')).toBe(borrowerKey('  juan   dela CRUZ '));
    expect(borrowerKey('Juan Dela Cruz')).not.toBe(borrowerKey('Juana Dela Cruz'));
  });
});

describe('borrowerTotals', () => {
  it('adds up one borrower’s loans, spelled as the newest loan spells the name', () => {
    const [juan, ...rest] = borrowerTotals([
      loan({
        id: 'a',
        borrowerName: 'juan  dela cruz',
        lent: 100_000,
        repaid: 100_000,
        lastDay: '2026-09-10',
        createdAt: '2026-09-01T00:00:00.000Z',
      }),
      loan({
        id: 'b',
        borrowerName: 'Juan Dela Cruz',
        lent: 50_000,
        repaid: 10_000,
        outstanding: 40_000,
        lastDay: '2026-10-05',
        createdAt: '2026-10-01T00:00:00.000Z',
      }),
    ]);
    expect(rest).toEqual([]);
    expect(juan).toEqual({
      key: 'juan dela cruz',
      borrowerName: 'Juan Dela Cruz',
      lent: 150_000,
      repaid: 110_000,
      outstanding: 40_000,
      loanCount: 2,
      openCount: 1,
      lastDay: '2026-10-05',
      loanIds: ['b', 'a'],
    });
  });

  it('puts those still owing first, the most owed first, then the paid up by name', () => {
    const order = borrowerTotals([
      loan({ id: 'z', borrowerName: 'Zed', lent: 10_000, repaid: 10_000 }),
      loan({ id: 'm', borrowerName: 'Maria', lent: 20_000, outstanding: 5_000 }),
      loan({ id: 'b', borrowerName: 'Ben', lent: 90_000, outstanding: 90_000 }),
      loan({ id: 'a', borrowerName: 'Ana', lent: 10_000, repaid: 10_000 }),
    ]).map((borrower) => borrower.borrowerName);
    expect(order).toEqual(['Ben', 'Maria', 'Ana', 'Zed']);
  });

  it('counts a borrower with nothing owed as paid, with no open loans', () => {
    const [ana] = borrowerTotals([loan({ id: 'a', borrowerName: 'Ana', lent: 10_000, repaid: 10_000 })]);
    expect(ana?.outstanding).toBe(0);
    expect(ana?.openCount).toBe(0);
    expect(ana?.lastDay).toBeNull();
  });

  it('is empty with no loans', () => {
    expect(borrowerTotals([])).toEqual([]);
  });
});
