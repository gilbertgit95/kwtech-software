import type { BooksBorrowerView } from '../src/react/books-client.js';
import {
  BORROWER_SUGGESTIONS_MAX,
  borrowerSuggestions,
  existingBorrower,
  moreBorrowersText,
} from '../src/react/view/borrower-suggestions.js';

function borrower(key: string, borrowerName: string, loanIds: string[], extra: Partial<BooksBorrowerView> = {}) {
  return {
    key,
    borrowerName,
    lent: 100_000,
    repaid: 0,
    outstanding: 100_000,
    loanCount: loanIds.length,
    openCount: loanIds.length,
    lastDay: '2026-11-01',
    loanIds,
    ...extra,
  } satisfies BooksBorrowerView;
}

// The overview's order: still owing first, most owed first.
const BORROWERS: BooksBorrowerView[] = [
  borrower('maria cruz', 'Maria Cruz', ['m2', 'm1'], { outstanding: 250_000, loanCount: 2 }),
  borrower('juan dela cruz', 'Juan Dela Cruz', ['j1']),
  borrower('pedro', 'Pedro', ['p1'], { outstanding: 0, repaid: 100_000, openCount: 0 }),
];
const LOANS = [
  { id: 'm2', contact: '0917 555 0101', createdAt: '2026-10-01T02:00:00Z' },
  { id: 'm1', contact: null, createdAt: '2026-09-01T02:00:00Z' },
  { id: 'j1', contact: null, createdAt: '2026-11-10T02:00:00Z' },
  { id: 'p1', contact: '0918', createdAt: '2026-11-15T02:00:00Z' },
];

describe('borrower suggestions (issue #167)', () => {
  it('offers every borrower before anything is typed, the most recently lent to first', () => {
    expect(borrowerSuggestions(BORROWERS, LOANS, '').shown.map((one) => one.borrowerName)).toEqual([
      'Pedro',
      'Juan Dela Cruz',
      'Maria Cruz',
    ]);
  });

  it('narrows to names holding the typed text anywhere, ignoring case and spacing', () => {
    expect(borrowerSuggestions(BORROWERS, LOANS, '  CRUZ ').shown.map((one) => one.key)).toEqual([
      'juan dela cruz',
      'maria cruz',
    ]);
    expect(borrowerSuggestions(BORROWERS, LOANS, 'dela   cruz').shown.map((one) => one.key)).toEqual([
      'juan dela cruz',
    ]);
    expect(borrowerSuggestions(BORROWERS, LOANS, 'nobody')).toEqual({ shown: [], matched: 0 });
  });

  it('carries the newest loan’s contact, and what they owe and how many loans', () => {
    const maria = borrowerSuggestions(BORROWERS, LOANS, 'maria').shown[0];
    expect(maria).toEqual({
      key: 'maria cruz',
      borrowerName: 'Maria Cruz',
      contact: '0917 555 0101',
      detail: 'Owes ₱2,500.00 · 2 loans',
    });
    expect(borrowerSuggestions(BORROWERS, LOANS, 'pedro').shown[0]?.detail).toBe('Paid up · 1 loan');
  });

  it('keeps the overview’s order where the newest loan is not known', () => {
    expect(borrowerSuggestions(BORROWERS, [], '').shown.map((one) => one.key)).toEqual([
      'maria cruz',
      'juan dela cruz',
      'pedro',
    ]);
  });

  it(`draws at most ${BORROWER_SUGGESTIONS_MAX}, says how many more, and typing searches them all`, () => {
    const many = Array.from({ length: 240 }, (_, index) => borrower(`b${index}`, `B${index}`, [`l${index}`]));
    const all = borrowerSuggestions(many, [], '');
    expect(all.shown).toHaveLength(BORROWER_SUGGESTIONS_MAX);
    expect(all.matched).toBe(240);
    expect(moreBorrowersText(all.shown.length, all.matched, '')).toBe(
      'Showing the 30 most recent of 240. Type to find the others.',
    );
    // b239 is past the first 30 drawn, and typing still finds it.
    expect(borrowerSuggestions(many, [], 'b239').shown.map((one) => one.key)).toEqual(['b239']);
    const ones = borrowerSuggestions(many, [], 'b1');
    expect(moreBorrowersText(ones.shown.length, ones.matched, 'b1')).toBe(
      'Showing 30 of 111 matches. Type more to narrow them.',
    );
    expect(moreBorrowersText(3, 3, '')).toBeNull();
  });
});

describe('existingBorrower (issue #167)', () => {
  it('finds the borrower a typed name already is, in any case or spacing', () => {
    expect(existingBorrower(BORROWERS, ' juan  DELA cruz ')?.borrowerName).toBe('Juan Dela Cruz');
  });

  it('is null for a new name, or nothing typed', () => {
    expect(existingBorrower(BORROWERS, 'Juan')).toBeNull();
    expect(existingBorrower(BORROWERS, '   ')).toBeNull();
  });
});
