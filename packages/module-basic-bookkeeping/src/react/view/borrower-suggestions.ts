import { borrowerKey } from '../../domain/borrowers.js';
import type { BooksBorrowerView, BooksLoanView } from '../books-client.js';
import { formatPeso } from './money.js';

/**
 * The borrowers "Lend money" offers under its Borrower field (issue #167), so
 * lending again to somebody is a tap, not a name typed from memory — and a
 * second spelling ("Maria" for "Ma. Cruz") never splits one person's loans.
 *
 * Matched by `borrowerKey`, the same rule that groups loans on the "By
 * borrower" view: what the list calls one borrower is what the tab adds up.
 */

/** One borrower the field offers. */
export interface BooksBorrowerSuggestion {
  key: string;
  /** As their newest loan spells it: what picking fills in. */
  borrowerName: string;
  /** Their newest loan's contact, or null: filled in only when the contact box is empty. */
  contact: string | null;
  /** "Owes ₱500.00 · 2 loans" or "Paid up · 1 loan": enough to tell two Juans apart. */
  detail: string;
}

/**
 * How many the list shows at most: 10, the operator's number (2026-11-17,
 * asked "what if there are hundreds?"). About what a glance takes in before
 * typing is quicker. Past it the list says how many more there are, and typing
 * searches them ALL — the cap is on what is drawn, never on what is found.
 */
export const BORROWER_SUGGESTIONS_MAX = 10;

/**
 * The borrowers to offer for what is typed: every one when nothing is, else
 * those whose name holds the typed text anywhere, ignoring case and spacing.
 *
 * Most recently lent to first: whoever borrows often is who is lent to next,
 * and the newest loans are the top of the Loans list too. Ties keep the
 * overview's order (still owing first, the most owed first).
 */
export function borrowerSuggestions(
  borrowers: readonly BooksBorrowerView[],
  loans: readonly Pick<BooksLoanView, 'id' | 'contact' | 'createdAt'>[],
  typed: string,
): { shown: BooksBorrowerSuggestion[]; matched: number } {
  const loanById = new Map(loans.map((loan) => [loan.id, loan]));
  const wanted = borrowerKey(typed);
  const newest = (borrower: BooksBorrowerView) => {
    const id = borrower.loanIds[0];
    return id === undefined ? undefined : loanById.get(id);
  };
  const ranked = borrowers
    .map((borrower, index) => ({ borrower, index, newest: newest(borrower) }))
    .filter(({ borrower }) => wanted === '' || borrower.key.includes(wanted))
    .sort(
      (a, b) =>
        (b.newest?.createdAt ?? '').localeCompare(a.newest?.createdAt ?? '') ||
        // Nothing to tell them apart: the overview's own order.
        a.index - b.index,
    );
  const shown = ranked.slice(0, BORROWER_SUGGESTIONS_MAX).map(({ borrower, newest: loan }) => ({
    key: borrower.key,
    borrowerName: borrower.borrowerName,
    contact: loan?.contact ?? null,
    detail: `${borrower.outstanding > 0 ? `Owes ${formatPeso(borrower.outstanding)}` : 'Paid up'} · ${
      borrower.loanCount === 1 ? '1 loan' : `${borrower.loanCount} loans`
    }`,
  }));
  return { shown, matched: ranked.length };
}

/**
 * The line under a list cut at `BORROWER_SUGGESTIONS_MAX`, or null when all
 * are shown: "Showing the 10 most recent of 240. Type to find the others."
 */
export function moreBorrowersText(shown: number, matched: number, typed: string): string | null {
  if (matched <= shown) return null;
  return typed.trim()
    ? `Showing ${shown} of ${matched} matches. Type more to narrow them.`
    : `Showing the ${shown} most recent of ${matched}. Type to find the others.`;
}

/**
 * Whether the typed name already IS one of the borrowers (any case, any
 * spacing): the field then says the loan joins theirs, rather than leaving
 * the person to wonder whether they made somebody new.
 */
export function existingBorrower(
  borrowers: readonly Pick<BooksBorrowerView, 'key' | 'borrowerName'>[],
  typed: string,
): Pick<BooksBorrowerView, 'key' | 'borrowerName'> | null {
  const wanted = borrowerKey(typed);
  if (wanted === '') return null;
  return borrowers.find((borrower) => borrower.key === wanted) ?? null;
}
