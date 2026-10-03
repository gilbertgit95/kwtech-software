import type { BooksInvestorBalance, BooksLoanBalance, BooksMoney } from '../domain/balances.js';
import { booksDayFromDate } from '../domain/days.js';
import type { BooksProfit } from '../domain/profit.js';
import type { BooksDay } from '../types.js';
import { centavos } from './books.lookup.js';
import type {
  BooksEntryRow,
  BooksInvestorRow,
  BooksLoanRow,
  BooksProfitShareRow,
  BooksSalesImportRow,
} from './books.repository.js';

/**
 * What the services answer with: plain data with the fields the GraphQL types
 * declare, amounts as numbers, days as `YYYY-MM-DD`, moments as ISO strings.
 * Rendered from rows HERE, once, so the overview's investor and a saved
 * investor cannot be drawn two ways.
 */

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** Who did something, by id → display name. A missing name is "a former member" on screen. */
export type BooksNames = ReadonlyMap<string, string>;

export interface BooksEntryView {
  id: string;
  kind: string;
  amount: number;
  place: string | null;
  toPlace: string | null;
  day: BooksDay;
  category: string | null;
  description: string | null;
  reference: string | null;
  investorId: string | null;
  loanId: string | null;
  importId: string | null;
  shareId: string | null;
  advance: boolean;
  recordedById: string;
  recordedByName: string | null;
  recordedAt: string;
  voidedAt: string | null;
  voidedById: string | null;
  voidedByName: string | null;
  voidReason: string | null;
}

export function renderEntry(row: BooksEntryRow, names: BooksNames = new Map()): BooksEntryView {
  return {
    id: row.id,
    kind: row.kind,
    amount: centavos(row.amount),
    place: row.place,
    toPlace: row.toPlace,
    day: booksDayFromDate(row.day),
    category: row.category,
    description: row.description,
    reference: row.reference,
    investorId: row.investorId,
    loanId: row.loanId,
    importId: row.importId,
    shareId: row.shareId,
    advance: row.advance,
    recordedById: row.recordedById,
    recordedByName: names.get(row.recordedById) ?? null,
    recordedAt: row.createdAt.toISOString(),
    voidedAt: iso(row.voidedAt),
    voidedById: row.voidedById,
    voidedByName: row.voidedById ? (names.get(row.voidedById) ?? null) : null,
    voidReason: row.voidReason,
  };
}

export interface BooksInvestorView extends BooksInvestorBalance {
  id: string;
  name: string;
  contact: string | null;
  note: string | null;
  agreedShare: number | null;
  formerAt: string | null;
  /** Their share of profit now, in basis points; null when shares cannot be worked out. */
  share: number | null;
}

export function renderInvestor(
  row: BooksInvestorRow,
  balance: BooksInvestorBalance,
  share: number | null,
): BooksInvestorView {
  return {
    id: row.id,
    name: row.name,
    contact: row.contact,
    note: row.note,
    agreedShare: row.agreedShare,
    formerAt: iso(row.formerAt),
    ...balance,
    share,
  };
}

export interface BooksLoanView extends Omit<BooksLoanBalance, 'lastDay'> {
  id: string;
  borrowerName: string;
  contact: string | null;
  note: string | null;
  lastDay: BooksDay | null;
  createdAt: string;
}

export function renderLoan(row: BooksLoanRow, balance: BooksLoanBalance): BooksLoanView {
  return {
    id: row.id,
    borrowerName: row.borrowerName,
    contact: row.contact,
    note: row.note,
    lent: balance.lent,
    repaid: balance.repaid,
    outstanding: balance.outstanding,
    lastDay: balance.lastDay,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface BooksSharePartView {
  investorId: string;
  share: number;
  amount: number;
}

export interface BooksProfitShareView {
  id: string;
  fromDay: BooksDay;
  toDay: BooksDay;
  sales: number;
  refunds: number;
  costOfGoods: number;
  expenses: number;
  profit: number;
  kept: number;
  shared: number;
  /** Who got what. Empty for a voided share: its entries are voided with it. */
  parts: BooksSharePartView[];
  recordedById: string;
  recordedByName: string | null;
  recordedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

/**
 * A profit share with its parts. `parts` come from its live `profit_share`
 * entries; the share each was given is worked back from the amounts, since the
 * entries keep the money, not the percentage.
 */
export function renderProfitShare(
  row: BooksProfitShareRow,
  partEntries: readonly Pick<BooksEntryRow, 'investorId' | 'amount'>[],
  names: BooksNames = new Map(),
): BooksProfitShareView {
  const shared = centavos(row.shared);
  return {
    id: row.id,
    fromDay: booksDayFromDate(row.fromDay),
    toDay: booksDayFromDate(row.toDay),
    sales: centavos(row.sales),
    refunds: centavos(row.refunds),
    costOfGoods: centavos(row.costOfGoods),
    expenses: centavos(row.expenses),
    profit: centavos(row.profit),
    kept: centavos(row.kept),
    shared,
    parts: partEntries.map((entry) => ({
      investorId: entry.investorId ?? '',
      amount: centavos(entry.amount),
      share: shared === 0 ? 0 : Math.round((centavos(entry.amount) * 10_000) / shared),
    })),
    recordedById: row.recordedById,
    recordedByName: names.get(row.recordedById) ?? null,
    recordedAt: row.createdAt.toISOString(),
    voidedAt: iso(row.voidedAt),
    voidReason: row.voidReason,
  };
}

export interface BooksSalesImportView {
  id: string;
  fromDay: BooksDay;
  toDay: BooksDay;
  cash: number;
  ewallet: number;
  bank: number;
  costOfGoods: number;
  costCoverage: number;
  orders: number;
  recordedAt: string;
  voidedAt: string | null;
}

export function renderSalesImport(row: BooksSalesImportRow): BooksSalesImportView {
  return {
    id: row.id,
    fromDay: booksDayFromDate(row.fromDay),
    toDay: booksDayFromDate(row.toDay),
    cash: centavos(row.cash),
    ewallet: centavos(row.ewallet),
    bank: centavos(row.bank),
    costOfGoods: centavos(row.costOfGoods),
    costCoverage: row.costCoverage,
    orders: row.orders,
    recordedAt: row.createdAt.toISOString(),
    voidedAt: iso(row.voidedAt),
  };
}

/** What bringing the POS's sales in would record. */
export interface BooksPosSalesView {
  fromDay: BooksDay;
  toDay: BooksDay;
  cash: number;
  ewallet: number;
  bank: number;
  costOfGoods: number;
  costCoverage: number;
  orders: number;
  truncated: boolean;
}

export interface BooksPosStatusView {
  /** A sales source is bound: this workspace's app has a point of sale to read. */
  available: boolean;
  /** A first day was chosen: sales come in from the POS, and profit waits for them. */
  connected: boolean;
  importFrom: BooksDay | null;
  recordedThrough: BooksDay | null;
  /** The first day the next import starts on, or null when not connected. */
  nextFromDay: BooksDay | null;
}

export interface BooksMonthView extends BooksProfit {
  month: string;
}

export interface BooksOverviewView {
  timeZone: string;
  today: BooksDay;
  money: BooksMoney;
  shareMode: string;
  sharedThrough: BooksDay | null;
  investors: BooksInvestorView[];
  /** Σ what current and former investors are still owed (advances count against it). */
  owedToInvestors: number;
  loans: BooksLoanView[];
  lentOutstanding: number;
  /** The first day not yet shared, or null with nothing recorded. */
  unsharedFrom: BooksDay | null;
  /** Profit from `unsharedFrom` through today; null with nothing recorded. */
  unshared: BooksProfit | null;
  months: BooksMonthView[];
  shares: BooksProfitShareView[];
  pos: BooksPosStatusView;
  truncated: boolean;
}

export interface BooksEntriesView {
  entries: BooksEntryView[];
  /** Cash on hand before the first entry: the day before the month, for a month; 0 otherwise. */
  opening: number;
  truncated: boolean;
}

export interface BooksSharePlanView {
  ok: boolean;
  /** Why it cannot be shared, in a sentence; null when it can. */
  refusal: string | null;
  fromDay: BooksDay | null;
  toDay: BooksDay;
  profit: BooksProfit | null;
  kept: number;
  shared: number;
  parts: BooksSharePartView[];
}

export interface BooksSettingsOut {
  shareMode: string;
  posImportFrom: BooksDay | null;
  version: number;
}
