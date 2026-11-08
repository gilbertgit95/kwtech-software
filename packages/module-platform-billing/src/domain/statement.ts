import { type DayKey, daysBetween, isDayKey, platformDay } from './days.js';
import type { PlatformBillingRefusal } from './refusals.js';
import { documentNumber } from './standing.js';

/**
 * THE STATEMENT OF ACCOUNT (PLATFORM-BILLING-PLAN §7): every bill, receipt
 * and credit entry of a range, oldest first, with the credit balance running
 * beside them, built from rows as pure data.
 *
 * ⚠ No "amount owed" column. An overpayment is a receipt AND a credit entry,
 * so netting bills against receipts would count it twice. The credit ledger
 * is the organization's account: what it holds is the balance, and a bill
 * shows what was asked for, a receipt what was received.
 */

/** One line of the statement. */
export interface StatementEntry {
  /** The bill's, receipt's or credit entry's own id: a stable key for a list. */
  id: string;
  /** ISO instant, and its day in the billing time zone. */
  at: string;
  day: DayKey;
  /** `bill`, `receipt`, or `credit`. */
  kind: 'bill' | 'receipt' | 'credit';
  /** As printed (`B-000012`, `R-000003`), or null for a credit entry. */
  number: string | null;
  /**
   * What it was, as a code the page words: a bill's status (`paid`,
   * `cancelled`…), a receipt's kind or `void`, a credit entry's kind.
   */
  detail: string;
  /** A credit entry's own note ("Basic was withdrawn on …"), or null. */
  note: string | null;
  /** Centavos asked for (a bill that stands), received (a receipt that stands), and credit moved (signed). */
  billed: number;
  paid: number;
  credit: number;
  /** The credit balance after this line. */
  creditBalance: number;
}

/** The statement of a range. */
export interface Statement {
  from: DayKey;
  to: DayKey;
  currency: string;
  /** The credit balance before the range, and after it. */
  openingCredit: number;
  closingCredit: number;
  /** What was billed (bills not cancelled) and received (receipts not voided) in the range. */
  billed: number;
  paid: number;
  entries: StatementEntry[];
}

/** The rows a statement is built from: only the fields it reads. */
export interface StatementInput {
  from: DayKey;
  to: DayKey;
  currency: string;
  timeZone: string;
  openingCredit: number;
  bills: ReadonlyArray<{ id: string; number: number; status: string; total: number; issuedAt: Date }>;
  receipts: ReadonlyArray<{
    id: string;
    number: number;
    amount: number;
    kind: string;
    issuedAt: Date;
    voidedAt: Date | null;
  }>;
  credits: ReadonlyArray<{ id: string; amount: number; kind: string; note: string | null; createdAt: Date }>;
}

/** The statement for `input`, oldest first; at one instant, bills before receipts before credit (the order an approval writes them). */
export function buildStatement(input: StatementInput): Statement {
  const order = { bill: 0, receipt: 1, credit: 2 } as const;
  const raw: Array<Omit<StatementEntry, 'creditBalance'> & { time: number }> = [
    ...input.bills.map((bill) => ({
      id: bill.id,
      time: bill.issuedAt.getTime(),
      at: bill.issuedAt.toISOString(),
      day: platformDay(bill.issuedAt, input.timeZone),
      kind: 'bill' as const,
      number: documentNumber('bill', bill.number),
      detail: bill.status,
      note: null,
      billed: bill.status === 'cancelled' ? 0 : bill.total,
      paid: 0,
      credit: 0,
    })),
    ...input.receipts.map((receipt) => ({
      id: receipt.id,
      time: receipt.issuedAt.getTime(),
      at: receipt.issuedAt.toISOString(),
      day: platformDay(receipt.issuedAt, input.timeZone),
      kind: 'receipt' as const,
      number: documentNumber('receipt', receipt.number),
      detail: receipt.voidedAt ? 'void' : receipt.kind,
      note: null,
      billed: 0,
      paid: receipt.voidedAt ? 0 : receipt.amount,
      credit: 0,
    })),
    ...input.credits.map((entry) => ({
      id: entry.id,
      time: entry.createdAt.getTime(),
      at: entry.createdAt.toISOString(),
      day: platformDay(entry.createdAt, input.timeZone),
      kind: 'credit' as const,
      number: null,
      detail: entry.kind,
      note: entry.note,
      billed: 0,
      paid: 0,
      credit: entry.amount,
    })),
  ];
  raw.sort((a, b) => a.time - b.time || order[a.kind] - order[b.kind]);

  let balance = input.openingCredit;
  const entries: StatementEntry[] = [];
  for (const { time: _time, ...entry } of raw) {
    balance += entry.credit;
    entries.push({ ...entry, creditBalance: balance });
  }
  return {
    from: input.from,
    to: input.to,
    currency: input.currency,
    openingCredit: input.openingCredit,
    closingCredit: balance,
    billed: entries.reduce((sum, entry) => sum + entry.billed, 0),
    paid: entries.reduce((sum, entry) => sum + entry.paid, 0),
    entries,
  };
}

/** The history's filters (plan §7): a year, a state, and whether to hide what changed nothing. */
export interface HistoryFilter {
  /** A calendar year in the billing time zone: requests made in it. */
  year?: number | null | undefined;
  /** One state (`approved`, `pending`, …). */
  state?: string | null | undefined;
  /** Hide the requests that changed nothing: withdrawn and rejected (their bills were cancelled). */
  hideClosed?: boolean | null | undefined;
}

/** What the history's filter covers: how many requests, and what was received in the year when one is chosen. */
export interface HistoryTotals {
  requests: number;
  /** Centavos received in the chosen year (receipts not voided), or null when no year is chosen. */
  paidInYear: number | null;
}

/** The states a filter may name. Anything else is ignored, never passed to a query. */
export const HISTORY_STATES = ['pending', 'approved', 'rejected', 'withdrawn', 'voided', 'closed_as_credit'] as const;

/** A year a filter may name: four digits, from the first year the app could have billed. */
export function isHistoryYear(year: number): boolean {
  return Number.isInteger(year) && year >= 2000 && year <= 9999;
}

/** The longest statement one read returns, in days: two years. A statement is read in one go, never paged. */
export const STATEMENT_MAX_DAYS = 731;

/** Whether `from` to `to` is a range a statement can cover: two real days, in order, at most two years apart. */
export function checkStatementRange(from: string, to: string): PlatformBillingRefusal | null {
  if (!isDayKey(from) || !isDayKey(to) || from > to) return 'invalid';
  return daysBetween(from, to) > STATEMENT_MAX_DAYS ? 'invalid' : null;
}
