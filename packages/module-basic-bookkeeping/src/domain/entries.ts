import type { BooksEntryKind, BooksPlace, BooksRefusal } from '../types.js';
import { BOOKS_CATEGORY_MAX, prepareBooksLine } from './text.js';

/**
 * What a ledger entry is allowed to look like (BOOKKEEPING-PLAN §2). The server
 * refuses with these and the forms validate with them, so a form never offers
 * what the server would refuse.
 *
 * ⚠ ENTRIES ARE NEVER EDITED OR DELETED. A mistake is VOIDED — kept, with who,
 * when and why — and recorded again. Cash on hand that changed because somebody
 * quietly edited last month's expense is the failure this module exists to
 * prevent.
 */

/** The largest single entry: ₱1,000,000,000.00. Past this it is a typo. Well inside 2^53. */
export const BOOKS_AMOUNT_MAX = 100_000_000_000;

export const BOOKS_PLACES: readonly BooksPlace[] = ['cash', 'ewallet', 'bank'];

/** Which way money moves for each kind. `none`: the investors' ledger only, no money moves. */
export type BooksDirection = 'in' | 'out' | 'transfer' | 'none';

export function entryDirection(kind: BooksEntryKind): BooksDirection {
  switch (kind) {
    case 'capital':
    case 'sales':
    case 'loan_repayment':
    case 'adjustment_in':
      return 'in';
    case 'expense':
    case 'purchase':
    case 'refund':
    case 'loan_out':
    case 'payout':
    case 'capital_return':
    case 'adjustment_out':
      return 'out';
    case 'transfer':
      return 'transfer';
    case 'profit_share':
    case 'reinvest':
      return 'none';
  }
}

/**
 * The kinds `recordBooksEntry` takes: the day-to-day money of the business,
 * bound to `books:record`. Investors' money and lending have their own
 * operations and keys; a profit share is only ever made by sharing profit.
 */
export const BOOKS_RECORDED_KINDS: readonly BooksEntryKind[] = [
  'sales',
  'refund',
  'expense',
  'purchase',
  'transfer',
  'adjustment_in',
  'adjustment_out',
  'loan_repayment',
];

/**
 * The kinds `recordBooksInvestorEntry` takes, bound to `books:manage_investors`:
 * what changes an investor's capital or what they are owed.
 */
export const BOOKS_INVESTOR_KINDS: readonly BooksEntryKind[] = ['capital', 'payout', 'capital_return', 'reinvest'];

/** The kinds that name an investor. */
const NAMES_INVESTOR: ReadonlySet<BooksEntryKind> = new Set([
  'capital',
  'payout',
  'capital_return',
  'reinvest',
  'profit_share',
]);

/** The kinds that name a loan. */
const NAMES_LOAN: ReadonlySet<BooksEntryKind> = new Set(['loan_out', 'loan_repayment']);

/** The kinds that must say what the money was for. */
const NEEDS_CATEGORY: ReadonlySet<BooksEntryKind> = new Set(['expense', 'purchase']);

/** Kinds that may carry a category at all. */
const TAKES_CATEGORY: ReadonlySet<BooksEntryKind> = new Set([
  'expense',
  'purchase',
  'sales',
  'refund',
  'adjustment_in',
  'adjustment_out',
]);

/**
 * The categories a form offers. Free text is allowed — a business names its
 * own costs — these are the common ones, so the monthly table groups "Rent"
 * with "Rent" rather than with "rent " and "Rental".
 */
export const BOOKS_EXPENSE_CATEGORIES: readonly string[] = [
  'Rent',
  'Electricity',
  'Water',
  'Internet and phone',
  'Wages',
  'Supplies',
  'Transport',
  'Repairs',
  'Taxes and fees',
  'Research and development',
  'Other',
];

/**
 * ⚠ "STOCK FOR RESALE" IS A PURCHASE, NOT AN EXPENSE, when the point of sale
 * keeps item costs: the POS counts each item's cost when it is SOLD, and the
 * books take that cost from the imported sales. Recording the bulk buy as an
 * expense too would count it twice.
 */
export const BOOKS_PURCHASE_CATEGORIES: readonly string[] = ['Equipment', 'Stock for resale', 'Furniture', 'Other'];

/**
 * The kinds that decide a profit share: what profit is made of (sales,
 * refunds, expenses) and what the shares are weighed by (capital, capital
 * returns, reinvestments), and the shares themselves.
 *
 * ⚠ ONCE A PERIOD'S PROFIT IS SHARED, THESE ARE CLOSED IN IT: recording or
 * voiding one dated in a shared period would change a split already owed to
 * people. Everything else — a payout, a loan, a transfer, a purchase — moves
 * money without changing a past profit, and may still be recorded late.
 */
export function decidesShares(kind: BooksEntryKind): boolean {
  switch (kind) {
    case 'sales':
    case 'refund':
    case 'expense':
    case 'capital':
    case 'capital_return':
    case 'reinvest':
    case 'profit_share':
      return true;
    case 'loan_repayment':
    case 'adjustment_in':
    case 'purchase':
    case 'loan_out':
    case 'payout':
    case 'adjustment_out':
    case 'transfer':
      return false;
  }
}

/** What a new entry says, before the server adds who, when and the ids. */
export interface BooksEntryDraft {
  kind: BooksEntryKind;
  amount: number;
  place: BooksPlace | null;
  toPlace: BooksPlace | null;
  investorId: string | null;
  loanId: string | null;
  category: string | null;
}

/** An amount, or why it is refused: whole centavos, above ₱0, at most `BOOKS_AMOUNT_MAX`. */
export function checkBooksAmount(amount: number): BooksRefusal | null {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > BOOKS_AMOUNT_MAX) return 'invalid_amount';
  return null;
}

export function isBooksPlace(value: string | null): value is BooksPlace {
  return value === 'cash' || value === 'ewallet' || value === 'bank';
}

/**
 * Whether the draft has the fields its kind needs, and none it must not have.
 * Returns the normalised category on success, since the check already did the
 * work.
 *
 * Shape only: whether the investor exists, is still investing and is owed
 * enough is the service's question, because the answer is in the database.
 */
export function prepareBooksEntry(draft: BooksEntryDraft): { category: string | null } | { refused: BooksRefusal } {
  const amount = checkBooksAmount(draft.amount);
  if (amount) return { refused: amount };

  const places = checkPlaces(draft);
  if (places) return { refused: places };

  if (NAMES_INVESTOR.has(draft.kind) !== (draft.investorId !== null)) return { refused: 'investor_required' };
  if (NAMES_LOAN.has(draft.kind) !== (draft.loanId !== null)) return { refused: 'loan_required' };

  if (draft.category === null || normalizedEmpty(draft.category)) {
    if (NEEDS_CATEGORY.has(draft.kind)) return { refused: 'invalid_category' };
    return { category: null };
  }
  if (!TAKES_CATEGORY.has(draft.kind)) return { refused: 'invalid_category' };
  const category = prepareBooksLine(draft.category, BOOKS_CATEGORY_MAX);
  if (category === null) return { refused: 'invalid_category' };
  return { category };
}

/**
 * Where the money was: one place for money in or out, two different places for
 * a transfer, and NONE for the investors' ledger — a profit share moves no
 * money, and a place on it would put it into cash on hand.
 */
function checkPlaces(draft: Pick<BooksEntryDraft, 'kind' | 'place' | 'toPlace'>): BooksRefusal | null {
  const direction = entryDirection(draft.kind);
  if (direction === 'none') return draft.place === null && draft.toPlace === null ? null : 'invalid_place';
  if (!isBooksPlace(draft.place)) return 'invalid_place';
  if (direction !== 'transfer') return draft.toPlace === null ? null : 'invalid_place';
  if (!isBooksPlace(draft.toPlace)) return 'invalid_place';
  if (draft.toPlace === draft.place) return 'same_place';
  return null;
}

function normalizedEmpty(text: string): boolean {
  return text.trim().length === 0;
}
