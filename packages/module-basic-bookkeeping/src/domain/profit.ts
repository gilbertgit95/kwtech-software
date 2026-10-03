import type { BooksDay, BooksRefusal, BooksShareMode } from '../types.js';
import { allocate, type BooksLedgerEntry, type BooksShareholder, investorBalances, profitShares } from './balances.js';
import { monthBounds, nextBooksDay } from './days.js';

/**
 * Profit, and sharing it among the investors (BOOKKEEPING-PLAN §4–5).
 *
 * ⚠ THE COUNTING RULES, in one place:
 * - profit = sales − refunds − cost of goods sold − expenses, by the DAY each
 *   entry happened;
 * - cost of goods comes with the sales the point of sale brought in: the POS
 *   knows what each item cost (POS-PLAN D15);
 * - purchases (equipment, stock), loans, capital, payouts, transfers and count
 *   adjustments are NOT profit or loss: they move money, they do not earn it.
 */

/** A batch of sales brought in from the point of sale, as profit needs it. */
export interface BooksSalesImportFigures {
  /** The day its entries are dated: the last day it covers. */
  toDay: BooksDay;
  /** Σ unit cost × quantity of what was sold, over the lines that had a cost. */
  costOfGoods: number;
  voided: boolean;
}

/** A period's profit, and what it is made of. Centavos. */
export interface BooksProfit {
  sales: number;
  refunds: number;
  costOfGoods: number;
  expenses: number;
  /** Sales − refunds − cost of goods − expenses. Negative is a loss. */
  profit: number;
  /** Shown beside profit, never in it: what was bought to keep. */
  purchases: number;
}

/** The profit of the days `fromDay`…`toDay`, inclusive. */
export function profitBetween(
  entries: readonly BooksLedgerEntry[],
  imports: readonly BooksSalesImportFigures[],
  fromDay: BooksDay,
  toDay: BooksDay,
): BooksProfit {
  const within = (day: BooksDay) => day >= fromDay && day <= toDay;
  let sales = 0;
  let refunds = 0;
  let expenses = 0;
  let purchases = 0;
  for (const entry of entries) {
    if (entry.voided || !within(entry.day)) continue;
    if (entry.kind === 'sales') sales += entry.amount;
    if (entry.kind === 'refund') refunds += entry.amount;
    if (entry.kind === 'expense') expenses += entry.amount;
    if (entry.kind === 'purchase') purchases += entry.amount;
  }
  const costOfGoods = imports
    .filter((batch) => !batch.voided && within(batch.toDay))
    .reduce((sum, batch) => sum + batch.costOfGoods, 0);
  return { sales, refunds, costOfGoods, expenses, profit: sales - refunds - costOfGoods - expenses, purchases };
}

/** Profit month by month (`YYYY-MM`), in the order given. */
export function profitByMonth(
  entries: readonly BooksLedgerEntry[],
  imports: readonly BooksSalesImportFigures[],
  months: readonly string[],
): (BooksProfit & { month: string })[] {
  return months.map((month) => {
    const { fromDay, toDay } = monthBounds(month);
    return { month, ...profitBetween(entries, imports, fromDay, toDay) };
  });
}

/** The first day a profit share may start on: the day after the last one, or the first entry's day. */
export function nextShareFrom(
  entries: readonly Pick<BooksLedgerEntry, 'day' | 'voided'>[],
  sharedThrough: BooksDay | null,
): BooksDay | null {
  if (sharedThrough !== null) return nextBooksDay(sharedThrough);
  let first: BooksDay | null = null;
  for (const entry of entries) {
    if (entry.voided) continue;
    if (first === null || entry.day < first) first = entry.day;
  }
  return first;
}

/** Whether the point of sale's sales are in the books through a day. */
export interface BooksPosStanding {
  /** True once somebody chose a first day to bring POS sales in from. */
  connected: boolean;
  /** The last day brought in, or null when nothing has been yet. */
  recordedThrough: BooksDay | null;
}

export interface BooksProfitShareInput {
  investors: readonly BooksShareholder[];
  entries: readonly BooksLedgerEntry[];
  imports: readonly BooksSalesImportFigures[];
  mode: BooksShareMode;
  /** The last day already shared, or null when profit was never shared. */
  sharedThrough: BooksDay | null;
  pos: BooksPosStanding;
  /** The last day to share. */
  toDay: BooksDay;
  today: BooksDay;
  /** Centavos of the profit kept in the business rather than shared. */
  kept: number;
}

/** One investor's part of a share. */
export interface BooksSharePart {
  investorId: string;
  /** Basis points, for showing. */
  share: number;
  /** Centavos, now owed to them. */
  amount: number;
}

export type BooksProfitSharePlan =
  | { kind: 'refused'; reason: BooksRefusal; profit: BooksProfit | null; fromDay: BooksDay | null }
  | {
      kind: 'share';
      fromDay: BooksDay;
      toDay: BooksDay;
      profit: BooksProfit;
      kept: number;
      /** Profit − kept: what is split. Σ parts is exactly this. */
      shared: number;
      parts: BooksSharePart[];
    };

/**
 * Splitting a period's profit (BOOKKEEPING-PLAN §4): from the day after the
 * last share through `toDay`, less what is kept in the business, by the
 * investors' shares AS THEY STOOD ON `toDay` — capital put in after the period
 * did not earn in it.
 *
 * Refused when:
 * - the period is empty or runs past today (`invalid_period`);
 * - the POS is connected and its sales are not in the books through `toDay`
 *   (`sales_not_recorded`): sharing before the sales are in would share a
 *   profit that is too small, and the period then closes for good;
 * - there is no profit (`no_profit`). A LOSS IS NOT SHARED: the period stays
 *   open, so the next share starts from it and the loss comes off that profit;
 * - `kept` is not a whole amount from ₱0 to the profit (`invalid_kept`);
 * - the shares cannot be worked out (`no_investors`, `shares_incomplete`).
 *
 * The plan is what the preview shows and what the server stores: one function.
 */
export function planProfitShare(input: BooksProfitShareInput): BooksProfitSharePlan {
  const fromDay = nextShareFrom(input.entries, input.sharedThrough);
  const refused = (reason: BooksRefusal, profit: BooksProfit | null = null): BooksProfitSharePlan => ({
    kind: 'refused',
    reason,
    profit,
    fromDay,
  });
  if (fromDay === null) return refused('no_profit');
  if (input.toDay < fromDay || input.toDay > input.today) return refused('invalid_period');
  if (input.pos.connected && (input.pos.recordedThrough === null || input.pos.recordedThrough < input.toDay)) {
    return refused('sales_not_recorded');
  }

  const profit = profitBetween(input.entries, input.imports, fromDay, input.toDay);
  if (profit.profit <= 0) return refused('no_profit', profit);
  if (!Number.isSafeInteger(input.kept) || input.kept < 0 || input.kept > profit.profit) {
    return refused('invalid_kept', profit);
  }

  const shared = profit.profit - input.kept;
  const balances = investorBalances(input.entries, input.toDay);
  const split = profitShares(input.investors, balances, input.mode);
  if ('refused' in split) return refused(split.refused, profit);
  const amounts = allocate(shared, split.weights);
  const parts = [...split.shares.entries()]
    .map(([investorId, share]) => ({ investorId, share, amount: amounts.get(investorId) ?? 0 }))
    .filter((part) => part.share > 0 || part.amount > 0);
  return { kind: 'share', fromDay, toDay: input.toDay, profit, kept: input.kept, shared, parts };
}
