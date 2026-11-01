import type { BooksDay } from '../types.js';
import { normalizeBooksLine } from './text.js';

/**
 * Loans grouped by who borrowed. A loan has only a free-text `borrowerName`,
 * and every "Lend money" to a new borrower makes a new loan, so one person can
 * hold several. Grouping them is how the Loans tab answers "what does Juan owe
 * in all". The rule lives here once (principle 5), used by the overview.
 *
 * Grouping is BY NAME, the way an investor's `nameKey` is made: normalised and
 * lower-cased, so "Juan Dela Cruz" and "juan  dela cruz" are one borrower. Two
 * different people with the same name are one group: there is no borrower
 * record to tell them apart (issue #48, out of scope).
 */

/** A loan, as grouping needs one. */
export interface BooksBorrowerLoan {
  id: string;
  borrowerName: string;
  lent: number;
  repaid: number;
  outstanding: number;
  lastDay: BooksDay | null;
  /** ISO instant; the newest loan's spelling of the name is the group's. */
  createdAt: string;
}

/** One borrower's loans, added up. */
export interface BooksBorrowerTotals {
  /** The grouping key: the name normalised and lower-cased. */
  key: string;
  /** As the most recent loan spells it. */
  borrowerName: string;
  lent: number;
  repaid: number;
  outstanding: number;
  /** How many loans, and how many still owe something. */
  loanCount: number;
  openCount: number;
  /** The last day anything moved on any of the loans, or null. */
  lastDay: BooksDay | null;
  /** Newest first. */
  loanIds: string[];
}

/** The key two loans share when they are with the same borrower. */
export function borrowerKey(borrowerName: string): string {
  return normalizeBooksLine(borrowerName).toLocaleLowerCase('en');
}

/**
 * Every borrower's totals: those still owing first, the most owed first, then
 * the paid up, each run by name. Ties break on the key, so the order is stable.
 */
export function borrowerTotals(loans: readonly BooksBorrowerLoan[]): BooksBorrowerTotals[] {
  const newestFirst = [...loans].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const groups = new Map<string, BooksBorrowerTotals>();
  for (const loan of newestFirst) {
    const key = borrowerKey(loan.borrowerName);
    const group = groups.get(key) ?? {
      key,
      borrowerName: normalizeBooksLine(loan.borrowerName),
      lent: 0,
      repaid: 0,
      outstanding: 0,
      loanCount: 0,
      openCount: 0,
      lastDay: null,
      loanIds: [],
    };
    group.lent += loan.lent;
    group.repaid += loan.repaid;
    group.outstanding += loan.outstanding;
    group.loanCount += 1;
    if (loan.outstanding > 0) group.openCount += 1;
    if (loan.lastDay !== null && (group.lastDay === null || loan.lastDay > group.lastDay)) group.lastDay = loan.lastDay;
    group.loanIds.push(loan.id);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => {
    const owing = Number(b.outstanding > 0) - Number(a.outstanding > 0);
    if (owing !== 0) return owing;
    if (a.outstanding !== b.outstanding) return b.outstanding - a.outstanding;
    return a.key.localeCompare(b.key, 'en');
  });
}
