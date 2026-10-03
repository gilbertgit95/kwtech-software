import { netMoneyChange } from '../../domain/balances.js';
import { type BooksDirection, entryDirection } from '../../domain/entries.js';
import type { BooksEntryKind, BooksPlace } from '../../types.js';
import type { BooksEntryView } from '../books-client.js';

/**
 * The words the screens use for the books' data, in one place, so the ledger,
 * a statement and a form never call one kind of entry two names.
 */

/** The tone of a status chip, mapped to theme tokens by `StatusChip`. */
export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/** What each kind is called on screen. */
export const KIND_LABEL: Readonly<Record<BooksEntryKind, string>> = {
  capital: 'Capital in',
  sales: 'Sales',
  loan_repayment: 'Loan repayment',
  adjustment_in: 'Count adjustment (more)',
  expense: 'Expense',
  purchase: 'Purchase',
  refund: 'Refund',
  loan_out: 'Money lent',
  payout: 'Payout',
  capital_return: 'Capital returned',
  adjustment_out: 'Count adjustment (less)',
  transfer: 'Transfer',
  profit_share: 'Profit share',
  reinvest: 'Reinvested',
};

/** One line under each kind in the "record" form, so the person picks the right one. */
export const KIND_HINT: Readonly<Partial<Record<BooksEntryKind, string>>> = {
  sales: 'Money taken from customers, recorded by hand (not through the point of sale).',
  refund: 'Money given back to a customer.',
  expense: 'Rent, power, wages, supplies: money spent to run the business. Counts against profit.',
  purchase: 'Something that lasts or is resold: equipment, stock. Not an expense — stock is costed when it sells.',
  transfer: 'Money moved between places, such as cash deposited at the bank.',
  adjustment_in: 'The count found more than the books say — or the money the business had when the books began.',
  adjustment_out: 'The count found less than the books say.',
  loan_repayment: 'A borrower paying some of a loan back.',
};

export const PLACE_LABEL: Readonly<Record<BooksPlace, string>> = {
  cash: 'Cash',
  ewallet: 'E-wallet',
  bank: 'Bank',
};

/** A wire kind as its label; an unknown one (a newer server) is shown as it came. */
export function kindLabel(kind: string): string {
  return (KIND_LABEL as Record<string, string>)[kind] ?? kind;
}

export function placeLabel(place: string | null): string {
  if (place === null) return '—';
  return (PLACE_LABEL as Record<string, string>)[place] ?? place;
}

/** Whether a wire kind is one this build knows. */
export function isKnownKind(kind: string): kind is BooksEntryKind {
  return kind in KIND_LABEL;
}

/** Which way an entry moved money, for its colour and sign. Unknown kinds move nothing. */
export function directionOf(kind: string): BooksDirection {
  return isKnownKind(kind) ? entryDirection(kind) : 'none';
}

/**
 * What an entry did to cash on hand, as the ledger prints it: + in, − out, 0
 * for a transfer or the investors' ledger. Voided: 0. The domain's
 * `netMoneyChange`, so the ledger and the overview cannot disagree.
 */
export function entryMoneyChange(
  entry: Pick<BooksEntryView, 'kind' | 'amount' | 'place' | 'toPlace' | 'voidedAt'>,
): number {
  if (entry.voidedAt !== null || !isKnownKind(entry.kind)) return 0;
  return netMoneyChange({
    kind: entry.kind,
    amount: entry.amount,
    // Wire strings: a place the domain does not know moves nothing.
    place: entry.place as BooksPlace | null,
    toPlace: entry.toPlace as BooksPlace | null,
  });
}

/** The ledger line's title: what it was for, then where. "Expense · Rent", "Transfer · Cash → Bank". */
export function entryTitle(
  entry: Pick<BooksEntryView, 'kind' | 'category' | 'place' | 'toPlace' | 'advance'>,
  names: { investor?: string | null; borrower?: string | null } = {},
): string {
  const parts = [kindLabel(entry.kind)];
  if (entry.kind === 'payout' && entry.advance) parts[0] = 'Payout (advance)';
  if (entry.category) parts.push(entry.category);
  if (names.investor) parts.push(names.investor);
  if (names.borrower) parts.push(names.borrower);
  if (entry.kind === 'transfer') parts.push(`${placeLabel(entry.place)} → ${placeLabel(entry.toPlace)}`);
  return parts.join(' · ');
}

/** `2026-10-03` → "Oct 3, 2026". A day has no zone: formatted as the calendar date it names (in UTC, where its midnight is). */
export function formatDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** `2026-10` → "October 2026". */
export function formatMonth(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** `2026-10` → "Oct". */
export function formatShortMonth(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleDateString('en-PH', { month: 'short', timeZone: 'UTC' });
}

/** A run of days: "Oct 3, 2026", or "Oct 1, 2026 – Oct 3, 2026". */
export function formatDays(fromDay: string, toDay: string): string {
  return fromDay === toDay ? formatDay(fromDay) : `${formatDay(fromDay)} – ${formatDay(toDay)}`;
}

/** The month before or after `month` (`YYYY-MM`). */
export function shiftMonth(month: string, by: number): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + by);
  return date.toISOString().slice(0, 7);
}

/** Who did something, for the ledger: their name, or "a former member" when the directory no longer knows them. */
export function whoName(name: string | null): string {
  return name ?? 'a former member';
}
