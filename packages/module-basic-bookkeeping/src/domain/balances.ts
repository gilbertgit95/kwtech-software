import type { BooksDay, BooksEntryKind, BooksPlace, BooksRefusal, BooksShareMode } from '../types.js';
import { BOOKS_PLACES, entryDirection } from './entries.js';

/**
 * Every balance the books show — cash on hand, what each investor has put in
 * and is owed, what each borrower still owes — ADDED UP FROM THE ENTRIES, never
 * stored (BOOKKEEPING-PLAN §2). A stored balance is a second copy of the truth,
 * and the day it disagrees with the entries nobody can say which is right.
 *
 * ⚠ VOIDED ENTRIES COUNT FOR NOTHING. They stay in the ledger, shown struck
 * through, so the history explains itself; every sum here skips them.
 */

/** One entry, as the sums need it. */
export interface BooksLedgerEntry {
  kind: BooksEntryKind;
  /** Centavos, always above 0. The direction is the kind's (`entryDirection`). */
  amount: number;
  place: BooksPlace | null;
  /** Transfers only: where the money went. */
  toPlace: BooksPlace | null;
  day: BooksDay;
  investorId: string | null;
  loanId: string | null;
  voided: boolean;
}

/** 100%, in basis points. */
export const BOOKS_PERCENT_FULL = 10_000;

export type BooksMoney = Readonly<Record<BooksPlace, number>> & { readonly total: number };

/** The empty tally, one per place. */
function noMoney(): Record<BooksPlace, number> {
  return { cash: 0, ewallet: 0, bank: 0 };
}

/**
 * Cash on hand: what came in, less what went out, per place, through `toDay`
 * (every entry when omitted). A transfer moves money between places and leaves
 * the total alone.
 *
 * ⚠ IT CAN BE NEGATIVE, and is shown so rather than refused: an expense paid
 * from today's takings is recorded before the sales are brought in, and a
 * negative balance is the books saying "something is not recorded yet".
 */
export function moneyOnHand(entries: readonly BooksLedgerEntry[], toDay?: BooksDay): BooksMoney {
  const money = noMoney();
  for (const entry of entries) {
    if (entry.voided || (toDay !== undefined && entry.day > toDay)) continue;
    for (const [place, change] of placeChanges(entry)) money[place] += change;
  }
  return { ...money, total: money.cash + money.ewallet + money.bank };
}

/**
 * How one entry moves money, place by place: `[place, +amount]` for money in,
 * `[place, −amount]` for money out, both for a transfer, nothing for the
 * investors' ledger. The ONE place a kind's direction becomes a sign, so the
 * balance and a running statement cannot disagree.
 */
export function placeChanges(
  entry: Pick<BooksLedgerEntry, 'kind' | 'amount' | 'place' | 'toPlace'>,
): [BooksPlace, number][] {
  const direction = entryDirection(entry.kind);
  if (direction === 'none' || entry.place === null) return [];
  if (direction === 'in') return [[entry.place, entry.amount]];
  if (direction === 'out') return [[entry.place, -entry.amount]];
  if (entry.toPlace === null) return [];
  return [
    [entry.place, -entry.amount],
    [entry.toPlace, entry.amount],
  ];
}

/** What cash on hand does for one entry overall: + in, − out, 0 for a transfer or the investors' ledger. */
export function netMoneyChange(entry: Pick<BooksLedgerEntry, 'kind' | 'amount' | 'place' | 'toPlace'>): number {
  return placeChanges(entry).reduce((sum, [, change]) => sum + change, 0);
}

/** One investor's standing (BOOKKEEPING-PLAN §3–4). */
export interface BooksInvestorBalance {
  /** Σ capital put in. */
  putIn: number;
  /** Σ owed profit left in as capital. */
  reinvested: number;
  /** Σ capital given back. */
  capitalReturned: number;
  /** Put in + reinvested − returned: what they have IN the business now. */
  capital: number;
  /** Σ profit shares. */
  profitShared: number;
  /** Σ payouts from the profit share. */
  paidOut: number;
  /**
   * Profit shared − paid out − reinvested: what the business still owes them.
   * NEGATIVE is an ADVANCE — paid ahead of profit — taken from the next share.
   */
  owed: number;
}

const NO_BALANCE: BooksInvestorBalance = {
  putIn: 0,
  reinvested: 0,
  capitalReturned: 0,
  capital: 0,
  profitShared: 0,
  paidOut: 0,
  owed: 0,
};

/** Every investor's standing, through `toDay` (every entry when omitted), by investor id. */
export function investorBalances(
  entries: readonly BooksLedgerEntry[],
  toDay?: BooksDay,
): Map<string, BooksInvestorBalance> {
  const tallies = new Map<string, BooksInvestorBalance>();
  for (const entry of entries) {
    if (entry.voided || entry.investorId === null || (toDay !== undefined && entry.day > toDay)) continue;
    const tally = { ...(tallies.get(entry.investorId) ?? NO_BALANCE) };
    switch (entry.kind) {
      case 'capital':
        tally.putIn += entry.amount;
        break;
      case 'reinvest':
        tally.reinvested += entry.amount;
        break;
      case 'capital_return':
        tally.capitalReturned += entry.amount;
        break;
      case 'profit_share':
        tally.profitShared += entry.amount;
        break;
      case 'payout':
        tally.paidOut += entry.amount;
        break;
      default:
        continue;
    }
    tally.capital = tally.putIn + tally.reinvested - tally.capitalReturned;
    tally.owed = tally.profitShared - tally.paidOut - tally.reinvested;
    tallies.set(entry.investorId, tally);
  }
  return tallies;
}

/** One investor's standing, or all zeros. */
export function investorBalance(
  balances: ReadonlyMap<string, BooksInvestorBalance>,
  investorId: string,
): BooksInvestorBalance {
  return balances.get(investorId) ?? NO_BALANCE;
}

/** What a loan stands at. */
export interface BooksLoanBalance {
  lent: number;
  repaid: number;
  /** Lent − repaid. Never below 0: a repayment above it is refused. */
  outstanding: number;
  /** The last day anything moved on it, or null. */
  lastDay: BooksDay | null;
}

/** Every loan's balance, by loan id. */
export function loanBalances(entries: readonly BooksLedgerEntry[]): Map<string, BooksLoanBalance> {
  const tallies = new Map<string, BooksLoanBalance>();
  for (const entry of entries) {
    if (entry.voided || entry.loanId === null) continue;
    const tally = { ...(tallies.get(entry.loanId) ?? { lent: 0, repaid: 0, outstanding: 0, lastDay: null }) };
    if (entry.kind === 'loan_out') tally.lent += entry.amount;
    if (entry.kind === 'loan_repayment') tally.repaid += entry.amount;
    tally.outstanding = tally.lent - tally.repaid;
    if (tally.lastDay === null || entry.day > tally.lastDay) tally.lastDay = entry.day;
    tallies.set(entry.loanId, tally);
  }
  return tallies;
}

/** An investor, as sharing needs one. */
export interface BooksShareholder {
  id: string;
  /** The agreed share in basis points (5000 = 50%), or null when none was agreed. */
  agreedShare: number | null;
  /** A former investor (bought out, or paid back in full) takes no new share. */
  former: boolean;
}

/**
 * Each current investor's share of profit, in basis points, by id — or why
 * there is none (BOOKKEEPING-PLAN §3).
 *
 *   capital — capital ÷ everybody's capital. An investor with nothing in has 0%.
 *   agreed  — the agreed percentages, which must be set for every current
 *             investor and add up to exactly 100%: a split that adds to 90%
 *             would quietly keep a tenth of the profit nobody agreed to keep.
 *
 * The shares are for SHOWING; `allocate` splits money by the raw weights, so
 * rounding a share to a basis point never loses a centavo.
 */
export function profitShares(
  investors: readonly BooksShareholder[],
  balances: ReadonlyMap<string, BooksInvestorBalance>,
  mode: BooksShareMode,
): { weights: Map<string, number>; shares: Map<string, number> } | { refused: BooksRefusal } {
  const current = investors.filter((investor) => !investor.former);
  const weights = new Map<string, number>();
  if (mode === 'agreed') {
    const refused = checkAgreedShares(current);
    if (refused) return { refused };
    for (const investor of current) weights.set(investor.id, investor.agreedShare ?? 0);
  } else {
    for (const investor of current) {
      weights.set(investor.id, Math.max(investorBalance(balances, investor.id).capital, 0));
    }
  }
  const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return { refused: 'no_investors' };
  const shares = new Map<string, number>();
  for (const [id, weight] of weights) shares.set(id, Math.round((weight * BOOKS_PERCENT_FULL) / total));
  return { weights, shares };
}

/** One agreed share, or why it is refused: whole basis points from 0% to 100%. Null is "not agreed". */
export function checkAgreedShare(share: number | null): BooksRefusal | null {
  if (share === null) return null;
  if (!Number.isSafeInteger(share) || share < 0 || share > BOOKS_PERCENT_FULL) return 'invalid_share';
  return null;
}

/** Whether the current investors' agreed shares are all set and add up to exactly 100%. */
export function checkAgreedShares(current: readonly Pick<BooksShareholder, 'agreedShare'>[]): BooksRefusal | null {
  if (current.length === 0) return 'no_investors';
  if (current.some((investor) => investor.agreedShare === null)) return 'shares_incomplete';
  const total = current.reduce((sum, investor) => sum + (investor.agreedShare ?? 0), 0);
  return total === BOOKS_PERCENT_FULL ? null : 'shares_incomplete';
}

/**
 * `amount` split by `weights`, to the centavo, adding up to EXACTLY `amount`
 * (largest remainder): ₱100 three ways is ₱33.34 + ₱33.33 + ₱33.33, never
 * ₱99.99. Ties in the remainder go to the larger weight, then to the order
 * given, so the same split always comes out the same.
 *
 * ⚠ BIGINT for the products: ₱1B of profit × a capital weight of ₱1B is 10^22
 * centavos², past `Number.MAX_SAFE_INTEGER`.
 */
export function allocate(amount: number, weights: ReadonlyMap<string, number>): Map<string, number> {
  const entries = [...weights.entries()].filter(([, weight]) => weight > 0);
  const total = entries.reduce((sum, [, weight]) => sum + BigInt(weight), 0n);
  const parts = new Map<string, number>();
  if (total === 0n || amount <= 0) return parts;
  const remainders: { id: string; remainder: bigint; weight: number; index: number }[] = [];
  let given = 0;
  for (const [index, [id, weight]] of entries.entries()) {
    const scaled = BigInt(amount) * BigInt(weight);
    const part = Number(scaled / total);
    parts.set(id, part);
    given += part;
    remainders.push({ id, remainder: scaled % total, weight, index });
  }
  remainders.sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    if (a.weight !== b.weight) return b.weight - a.weight;
    return a.index - b.index;
  });
  for (let i = 0; i < amount - given; i += 1) {
    const next = remainders[i % remainders.length];
    if (next) parts.set(next.id, (parts.get(next.id) ?? 0) + 1);
  }
  return parts;
}

/** The empty place tally, exported for the views. */
export function emptyMoney(): BooksMoney {
  return { ...noMoney(), total: 0 };
}

/** Each place's balance as `[place, amount]`, in the order the screens list them. */
export function moneyRows(money: BooksMoney): [BooksPlace, number][] {
  return BOOKS_PLACES.map((place) => [place, money[place]]);
}
