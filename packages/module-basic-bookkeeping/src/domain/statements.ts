import type { BooksEntryKind } from '../types.js';
import { type BooksLedgerEntry, netMoneyChange } from './balances.js';

/**
 * Running balances, line by line — an investor's statement, a loan's, the cash
 * book — the way BOOKKEEPING-PLAN §4 draws Maria's ("still owed ₱13,000" after
 * each payout).
 *
 * ⚠ THE CALLER ORDERS THE ENTRIES (the server sends them by day, then by when
 * they were recorded). These only add up, so a statement and the balance at
 * its foot always agree: both run the same sums over the same entries.
 */

/** An entry and the balances after it. Voided lines keep the balances of the line before. */
export interface BooksStatementLine<E> {
  entry: E;
  /** True when the entry changed nothing, because it was voided. */
  voided: boolean;
}

/** An investor's statement line: capital and owed after it. */
export interface BooksInvestorStatementLine<E> extends BooksStatementLine<E> {
  /** + or − on their capital. */
  capitalChange: number;
  /** + or − on what they are owed. */
  owedChange: number;
  capital: number;
  owed: number;
}

/** What each kind does to an investor's capital and owed. */
function investorChange(kind: BooksEntryKind, amount: number): { capital: number; owed: number } {
  switch (kind) {
    case 'capital':
      return { capital: amount, owed: 0 };
    case 'capital_return':
      return { capital: -amount, owed: 0 };
    case 'profit_share':
      return { capital: 0, owed: amount };
    case 'payout':
      return { capital: 0, owed: -amount };
    case 'reinvest':
      return { capital: amount, owed: -amount };
    case 'sales':
    case 'loan_repayment':
    case 'adjustment_in':
    case 'expense':
    case 'purchase':
    case 'refund':
    case 'loan_out':
    case 'adjustment_out':
    case 'transfer':
      return { capital: 0, owed: 0 };
  }
}

/** One investor's entries, in order, with capital and owed after each. */
export function investorStatement<E extends Pick<BooksLedgerEntry, 'kind' | 'amount' | 'voided'>>(
  entries: readonly E[],
): BooksInvestorStatementLine<E>[] {
  let capital = 0;
  let owed = 0;
  return entries.map((entry) => {
    const change = entry.voided ? { capital: 0, owed: 0 } : investorChange(entry.kind, entry.amount);
    capital += change.capital;
    owed += change.owed;
    return { entry, voided: entry.voided, capitalChange: change.capital, owedChange: change.owed, capital, owed };
  });
}

/** A loan's statement line: still owed after it. */
export interface BooksLoanStatementLine<E> extends BooksStatementLine<E> {
  change: number;
  outstanding: number;
}

/** One loan's entries, in order, with what is still owed after each. */
export function loanStatement<E extends Pick<BooksLedgerEntry, 'kind' | 'amount' | 'voided'>>(
  entries: readonly E[],
): BooksLoanStatementLine<E>[] {
  let outstanding = 0;
  return entries.map((entry) => {
    const signed = entry.kind === 'loan_out' ? entry.amount : -entry.amount;
    const change = entry.voided ? 0 : signed;
    outstanding += change;
    return { entry, voided: entry.voided, change, outstanding };
  });
}

/** A cash-book line: what it did to cash on hand, and the total after it. */
export interface BooksCashBookLine<E> extends BooksStatementLine<E> {
  change: number;
  balance: number;
}

/**
 * The cash book: each entry and cash on hand after it, starting from
 * `opening` (cash on hand before the first line — the month's opening when a
 * month is shown).
 */
export function cashBook<E extends Pick<BooksLedgerEntry, 'kind' | 'amount' | 'place' | 'toPlace' | 'voided'>>(
  entries: readonly E[],
  opening: number,
): BooksCashBookLine<E>[] {
  let balance = opening;
  return entries.map((entry) => {
    const change = entry.voided ? 0 : netMoneyChange(entry);
    balance += change;
    return { entry, voided: entry.voided, change, balance };
  });
}
