import { BOOKS_OVERVIEW_LOANS } from '../../domain/borrowers.js';
import type { BooksBorrowerView } from '../books-client.js';

/**
 * The Loans tab's view rules: which list it shows, and what the "By borrower"
 * view prints. Pure, so they are tested without rendering (testing.md).
 */

/** The Loans tab lists loans one by one, or added up per borrower (issue #48). */
export type BooksLoansView = 'loans' | 'borrowers';

export const BOOKS_LOANS_VIEWS: readonly { key: BooksLoansView; label: string }[] = [
  { key: 'loans', label: 'Loans' },
  { key: 'borrowers', label: 'By borrower' },
];

/**
 * Which view this device showed last. Per device, like the point of sale's
 * Sell mode, so localStorage and not a setting: it is how one person likes to
 * look, not a fact about the books.
 */
export const BOOKS_LOANS_VIEW_STORAGE_KEY = 'kwtech:books-loans-view';

/**
 * The stored view, or `loans`. Untrusted like everything in localStorage: an
 * old or hand-edited value must open the tab, not break it.
 */
export function parseLoansView(raw: string | null): BooksLoansView {
  return BOOKS_LOANS_VIEWS.some((view) => view.key === raw) ? (raw as BooksLoansView) : 'loans';
}

/** The strip above the "By borrower" list. */
export interface BooksBorrowerSummary {
  lent: number;
  repaid: number;
  /** Σ outstanding: the overview's `lentOutstanding`, by another road. */
  unpaid: number;
  /** Borrowers who still owe something, of `borrowers`. */
  owing: number;
  borrowers: number;
}

export function borrowerSummary(
  borrowers: readonly Pick<BooksBorrowerView, 'lent' | 'repaid' | 'outstanding'>[],
): BooksBorrowerSummary {
  const summary = { lent: 0, repaid: 0, unpaid: 0, owing: 0, borrowers: borrowers.length };
  for (const borrower of borrowers) {
    summary.lent += borrower.lent;
    summary.repaid += borrower.repaid;
    summary.unpaid += borrower.outstanding;
    if (borrower.outstanding > 0) summary.owing += 1;
  }
  return summary;
}

/** "1 loan", "3 loans", "3 loans · 1 open". A single loan's open or paid is already the row's chip. */
export function loanCountLabel(borrower: Pick<BooksBorrowerView, 'loanCount' | 'openCount'>): string {
  const count = borrower.loanCount === 1 ? '1 loan' : `${borrower.loanCount} loans`;
  if (borrower.loanCount === 1 || borrower.openCount === 0) return count;
  return `${count} · ${borrower.openCount} open`;
}

/**
 * Whether the overview reached its loan limit, so older loans MAY be missing
 * from the totals: at exactly the limit nothing is, and telling the two apart
 * would mean reading one loan more only to find out. Not `overview.truncated`:
 * that is the LEDGER's own limit, a separate one.
 */
export function isLoansCapped(loanCount: number): boolean {
  return loanCount >= BOOKS_OVERVIEW_LOANS;
}

/** What the By borrower view says when `isLoansCapped`. */
export const BOOKS_LOANS_CAPPED_NOTE = `Only the newest ${BOOKS_OVERVIEW_LOANS} loans are counted, so older loans may be left out of these totals.`;
