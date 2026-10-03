'use client';

import { BOOKS_OPERATIONS } from '../operations.js';

/**
 * How the books reach the API — through the app's same-origin route handler,
 * which attaches the session. The path is a parameter because that handler
 * belongs to `module-auth`, and this module may not name its URL (PLAN §9).
 */
export const DEFAULT_GRAPHQL_PATH = '/api/auth/graphql';

type BooksCall = Exclude<keyof typeof BOOKS_OPERATIONS, 'booksEvents'>;

/*
 * The shapes the API answers with, hand-written (no codegen, frontend rules).
 * ⚠ Every amount is WHOLE CENTAVOS, as the server keeps it: ₱12.50 is 1250.
 * Days are `YYYY-MM-DD` in the workspace's calendar.
 */

export interface BooksScopeView {
  organizationId: string;
  workspaceId: string;
}

export interface BooksMoneyView {
  cash: number;
  ewallet: number;
  bank: number;
  total: number;
}

export interface BooksProfitView {
  sales: number;
  refunds: number;
  costOfGoods: number;
  expenses: number;
  profit: number;
  purchases: number;
}

export interface BooksInvestorView {
  id: string;
  name: string;
  contact: string | null;
  note: string | null;
  agreedShare: number | null;
  formerAt: string | null;
  putIn: number;
  reinvested: number;
  capitalReturned: number;
  capital: number;
  profitShared: number;
  paidOut: number;
  owed: number;
  share: number | null;
}

export interface BooksLoanView {
  id: string;
  borrowerName: string;
  contact: string | null;
  note: string | null;
  lent: number;
  repaid: number;
  outstanding: number;
  lastDay: string | null;
  createdAt: string;
}

export interface BooksSharePartView {
  investorId: string;
  share: number;
  amount: number;
}

export interface BooksProfitShareView extends BooksProfitView {
  id: string;
  fromDay: string;
  toDay: string;
  kept: number;
  shared: number;
  parts: BooksSharePartView[];
  recordedById: string;
  recordedByName: string | null;
  recordedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface BooksPosStatusView {
  available: boolean;
  connected: boolean;
  importFrom: string | null;
  recordedThrough: string | null;
  nextFromDay: string | null;
}

export interface BooksOverviewView {
  timeZone: string;
  today: string;
  money: BooksMoneyView;
  /** `capital` or `agreed`. */
  shareMode: string;
  sharedThrough: string | null;
  investors: BooksInvestorView[];
  owedToInvestors: number;
  loans: BooksLoanView[];
  lentOutstanding: number;
  unsharedFrom: string | null;
  unshared: BooksProfitView | null;
  months: (BooksProfitView & { month: string })[];
  shares: BooksProfitShareView[];
  pos: BooksPosStatusView;
  truncated: boolean;
}

export interface BooksEntryView {
  id: string;
  kind: string;
  amount: number;
  place: string | null;
  toPlace: string | null;
  day: string;
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

export interface BooksEntriesView {
  entries: BooksEntryView[];
  opening: number;
  truncated: boolean;
}

export interface BooksPosSalesView {
  fromDay: string;
  toDay: string;
  cash: number;
  ewallet: number;
  bank: number;
  costOfGoods: number;
  costCoverage: number;
  orders: number;
  truncated: boolean;
}

export interface BooksSalesImportView extends Omit<BooksPosSalesView, 'truncated'> {
  id: string;
  recordedAt: string;
  voidedAt: string | null;
}

export interface BooksSharePlanView {
  ok: boolean;
  refusal: string | null;
  fromDay: string | null;
  toDay: string;
  profit: BooksProfitView | null;
  kept: number;
  shared: number;
  parts: BooksSharePartView[];
}

export interface BooksSettingsView {
  shareMode: string;
  posImportFrom: string | null;
  version: number;
}

export interface BooksEventView {
  kind: string;
  actorId: string | null;
}

export interface RecordBooksEntryInput {
  kind: string;
  amount: number;
  place: string;
  toPlace?: string | null;
  day: string;
  category?: string | null;
  description?: string | null;
  reference?: string | null;
  loanId?: string | null;
  clientId: string;
}

export interface RecordBooksInvestorEntryInput {
  kind: string;
  investorId: string;
  amount: number;
  place: string | null;
  day: string;
  description?: string | null;
  reference?: string | null;
  advance?: boolean | null;
  clientId: string;
}

export interface LendBooksMoneyInput {
  loanId?: string | null;
  borrowerName?: string | null;
  contact?: string | null;
  note?: string | null;
  amount: number;
  place: string;
  day: string;
  description?: string | null;
  reference?: string | null;
  clientId: string;
}

export interface SaveBooksInvestorInput {
  investorId?: string | null;
  name: string;
  contact?: string | null;
  note?: string | null;
  agreedShare?: number | null;
}

export interface BooksClient {
  overview(scope: BooksScopeView): Promise<BooksOverviewView>;
  entries(
    scope: BooksScopeView,
    filter: { month?: string | null; investorId?: string | null; loanId?: string | null },
  ): Promise<BooksEntriesView>;
  record(scope: BooksScopeView, input: RecordBooksEntryInput): Promise<BooksEntryView>;
  lend(scope: BooksScopeView, input: LendBooksMoneyInput): Promise<BooksLoanView>;
  saveLoan(
    scope: BooksScopeView,
    loanId: string,
    input: { borrowerName: string; contact: string | null; note: string | null },
  ): Promise<BooksLoanView>;
  voidEntry(scope: BooksScopeView, entryId: string, reason: string): Promise<BooksEntryView>;
  posSalesPreview(scope: BooksScopeView, toDay: string): Promise<BooksPosSalesView>;
  recordPosSales(scope: BooksScopeView, toDay: string, clientId: string): Promise<BooksSalesImportView>;
  saveInvestor(scope: BooksScopeView, input: SaveBooksInvestorInput): Promise<BooksInvestorView>;
  setInvestorFormer(scope: BooksScopeView, investorId: string, former: boolean): Promise<BooksInvestorView>;
  recordInvestor(scope: BooksScopeView, input: RecordBooksInvestorEntryInput): Promise<BooksEntryView>;
  saveSettings(scope: BooksScopeView, shareMode: string, posImportFrom: string | null): Promise<BooksSettingsView>;
  sharePreview(scope: BooksScopeView, toDay: string, kept: number): Promise<BooksSharePlanView>;
  shareProfit(scope: BooksScopeView, toDay: string, kept: number, clientId: string): Promise<BooksProfitShareView>;
  voidShare(scope: BooksScopeView, shareId: string, reason: string): Promise<BooksProfitShareView>;
}

export function createBooksClient(options: { graphqlPath?: string } = {}): BooksClient {
  const path = options.graphqlPath ?? DEFAULT_GRAPHQL_PATH;

  /**
   * One request shape for every call, answering the operation's own field.
   * Throws the API's FIRST error message: the refusals are written for a
   * reader ("That is more than they are owed — …").
   */
  async function call<T>(operation: BooksCall, scope: BooksScopeView, variables: Record<string, unknown> = {}) {
    let response: Response;
    try {
      response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          query: BOOKS_OPERATIONS[operation],
          variables: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, ...variables },
        }),
        cache: 'no-store',
      });
    } catch {
      // ⚠ Say so, never pretend it saved: a payout that "went through" offline is paid twice.
      throw new Error('Cannot reach the server — nothing was saved. Check the connection and try again.');
    }
    if (!response.ok) {
      throw new Error(response.status === 401 ? 'Your session has ended. Sign in again.' : 'Cannot reach the server.');
    }
    const body = (await response.json()) as { data?: Record<string, unknown>; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'The request was refused.');
    if (!body.data || !(operation in body.data)) throw new Error('The server returned no data.');
    return body.data[operation] as T;
  }

  return {
    overview: (scope) => call('booksOverview', scope),
    entries: (scope, filter) =>
      call('booksEntries', scope, {
        month: filter.month ?? null,
        investorId: filter.investorId ?? null,
        loanId: filter.loanId ?? null,
      }),
    record: (scope, input) => call('recordBooksEntry', scope, { input }),
    lend: (scope, input) => call('lendBooksMoney', scope, { input }),
    saveLoan: (scope, loanId, input) => call('saveBooksLoan', scope, { loanId, ...input }),
    voidEntry: (scope, entryId, reason) => call('voidBooksEntry', scope, { entryId, reason }),
    posSalesPreview: (scope, toDay) => call('booksPosSalesPreview', scope, { toDay }),
    recordPosSales: (scope, toDay, clientId) => call('recordBooksPosSales', scope, { toDay, clientId }),
    saveInvestor: (scope, input) => call('saveBooksInvestor', scope, { input }),
    setInvestorFormer: (scope, investorId, former) => call('setBooksInvestorFormer', scope, { investorId, former }),
    recordInvestor: (scope, input) => call('recordBooksInvestorEntry', scope, { input }),
    saveSettings: (scope, shareMode, posImportFrom) => call('saveBooksSettings', scope, { shareMode, posImportFrom }),
    sharePreview: (scope, toDay, kept) => call('booksProfitSharePreview', scope, { toDay, kept }),
    shareProfit: (scope, toDay, kept, clientId) => call('shareBooksProfit', scope, { toDay, kept, clientId }),
    voidShare: (scope, shareId, reason) => call('voidBooksProfitShare', scope, { shareId, reason }),
  };
}
