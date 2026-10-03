import type { BooksEntryKind, BooksRefusal } from '../types.js';
import type { BooksInvestorBalance, BooksLoanBalance } from './balances.js';

/**
 * What may be done with an investor's money and a borrower's loan, given where
 * they stand (BOOKKEEPING-PLAN §3–4). The server asks these inside the
 * transaction that writes; the forms ask them to say why before anybody presses
 * Save.
 */

/**
 * Whether an investor entry fits the investor's standing, or why not.
 *
 * - capital — from a CURRENT investor. A former one who comes back is restored
 *   first, on purpose, so rejoining is a decision and not a side effect.
 * - payout — at most what they are owed, unless it is marked an ADVANCE: paid
 *   ahead of profit, it leaves them owing, and the next share pays it back.
 * - capital_return — at most their capital: nobody is paid back more than they
 *   put in. More than that is a payout.
 * - reinvest — at most what they are owed, and never an advance: capital made
 *   of profit nobody earned yet is capital nobody put in.
 */
export function checkInvestorEntry(
  kind: Extract<BooksEntryKind, 'capital' | 'payout' | 'capital_return' | 'reinvest'>,
  amount: number,
  standing: { balance: BooksInvestorBalance; former: boolean; advance: boolean },
): BooksRefusal | null {
  switch (kind) {
    case 'capital':
      return standing.former ? 'investor_former' : null;
    case 'payout':
      if (standing.advance) return null;
      return amount > standing.balance.owed ? 'exceeds_owed' : null;
    case 'capital_return':
      return amount > standing.balance.capital ? 'exceeds_capital' : null;
    case 'reinvest':
      if (standing.former) return 'investor_former';
      return amount > standing.balance.owed ? 'exceeds_owed' : null;
  }
}

/** Whether `kind` is one `checkInvestorEntry` takes. */
export function isInvestorEntryKind(
  kind: BooksEntryKind,
): kind is Extract<BooksEntryKind, 'capital' | 'payout' | 'capital_return' | 'reinvest'> {
  return kind === 'capital' || kind === 'payout' || kind === 'capital_return' || kind === 'reinvest';
}

/**
 * Whether an investor may be marked former: only once their capital is all
 * paid back. Shares follow capital, so a former investor with money still in
 * would either keep earning (and not be former) or stop earning on money they
 * still have in. What they are still OWED may be paid later; it stays shown.
 */
export function checkMarkFormer(balance: BooksInvestorBalance): BooksRefusal | null {
  return balance.capital > 0 ? 'still_invested' : null;
}

/** Whether a repayment fits the loan: at most what is still owed on it. */
export function checkLoanRepayment(amount: number, balance: BooksLoanBalance): BooksRefusal | null {
  return amount > balance.outstanding ? 'exceeds_loan' : null;
}
