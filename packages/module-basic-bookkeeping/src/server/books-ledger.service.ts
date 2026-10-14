import { Inject, Injectable, Optional } from '@nestjs/common';
import { investorBalance, investorBalances, loanBalances, moneyOnHand, profitShares } from '../domain/balances.js';
import {
  booksDayToDate,
  isBooksMonth,
  monthBounds,
  monthOfDay,
  monthsEndingWith,
  nextBooksDay,
  prepareBooksRange,
  previousBooksDay,
} from '../domain/days.js';
import { nextShareFrom, profitBetween, profitByMonth } from '../domain/profit.js';
import type { BooksDay } from '../types.js';
import { refusalError } from './books.errors.js';
import {
  allImports,
  type BooksSettingsView,
  liveLedger,
  readEntries,
  readSettings,
  toImportFigures,
  toLedgerEntry,
} from './books.lookup.js';
import type { BooksEntryRow, BooksEntryWhere, BooksWriteClient, InScope } from './books.repository.js';
import { BOOKS_PRISMA_WRITE, BOOKS_SALES_SOURCE } from './books.tokens.js';
import {
  type BooksEntriesView,
  type BooksOverviewView,
  type BooksPosStatusView,
  renderEntry,
  renderInvestor,
  renderLoan,
  renderProfitShare,
} from './books.views.js';
import { BooksDirectoryService } from './books-directory.service.js';
import { BooksTimeZoneService } from './books-time-zone.service.js';
import type { BooksSalesSource } from './ports.js';

/** How many months of profit the overview shows. */
export const BOOKS_OVERVIEW_MONTHS = 12;

/** How many recent profit shares the overview lists. */
export const BOOKS_OVERVIEW_SHARES = 12;

/**
 * Reading the books, bound to `books:read`. Every balance is added up HERE from
 * the live entries by `src/domain/`, so the overview, an investor's statement
 * and a profit share's plan run the same sums.
 *
 * ⚠ Reads through the WRITE client: the overview right after a payout must
 * show the payout. A replica a moment behind would show the old balance, and
 * the person would pay again.
 */
@Injectable()
export class BooksLedgerService {
  constructor(
    @Inject(BOOKS_PRISMA_WRITE) private readonly prisma: BooksWriteClient,
    private readonly zones: BooksTimeZoneService,
    private readonly directory: BooksDirectoryService,
    /** Unbound: there is no point of sale, and the overview says so. */
    @Optional() @Inject(BOOKS_SALES_SOURCE) private readonly sales?: BooksSalesSource,
  ) {}

  async overview(scope: InScope, now: Date): Promise<BooksOverviewView> {
    const [settings, ledger, investorRows, loanRows, importRows, shareRows, { today, timeZone }] = await Promise.all([
      readSettings(this.prisma, scope),
      readEntries(this.prisma, { ...scope, voidedAt: null }),
      this.prisma.booksInvestor.findMany({ where: scope, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 500 }),
      this.prisma.booksLoan.findMany({ where: scope, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 500 }),
      allImports(this.prisma, scope),
      this.prisma.booksProfitShare.findMany({
        where: scope,
        orderBy: [{ toDay: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take: BOOKS_OVERVIEW_SHARES,
      }),
      this.zones.today(scope, now),
    ]);
    const entries = ledger.rows.map(toLedgerEntry);
    const imports = importRows.map(toImportFigures);

    const balances = investorBalances(entries);
    const split = profitShares(
      investorRows.map((row) => ({ id: row.id, agreedShare: row.agreedShare, former: row.formerAt !== null })),
      balances,
      settings.shareMode,
    );
    const investors = investorRows.map((row) =>
      renderInvestor(
        row,
        investorBalance(balances, row.id),
        'shares' in split ? (split.shares.get(row.id) ?? null) : null,
      ),
    );

    const loanTallies = loanBalances(entries);
    const loans = loanRows.map((row) =>
      renderLoan(row, loanTallies.get(row.id) ?? { lent: 0, repaid: 0, outstanding: 0, lastDay: null }),
    );

    const unsharedFrom = nextShareFrom(entries, settings.sharedThrough);
    const unshared =
      unsharedFrom !== null && unsharedFrom <= today ? profitBetween(entries, imports, unsharedFrom, today) : null;

    const names = await this.directory.names(shareRows.map((row) => row.recordedById));
    const shares = shareRows.map((row) =>
      renderProfitShare(
        row,
        ledger.rows.filter((entry: BooksEntryRow) => entry.shareId === row.id),
        names,
      ),
    );

    return {
      timeZone,
      today,
      money: moneyOnHand(entries),
      shareMode: settings.shareMode,
      sharedThrough: settings.sharedThrough,
      investors,
      owedToInvestors: investors.reduce((sum, investor) => sum + investor.owed, 0),
      loans,
      lentOutstanding: loans.reduce((sum, loan) => sum + loan.outstanding, 0),
      unsharedFrom,
      unshared,
      months: profitByMonth(entries, imports, monthsEndingWith(monthOfDay(today), BOOKS_OVERVIEW_MONTHS)),
      shares,
      pos: this.posStatus(settings),
      truncated: ledger.truncated,
    };
  }

  /**
   * One month of the ledger, a run of days (`fromDay`–`toDay`, both ends
   * included, the Money tab's range), or one investor's or one loan's entries
   * — voided ones INCLUDED, so the history explains itself. Exactly one filter
   * (a range is one: both its ends, or neither); with none, the month is the
   * workspace's current one.
   */
  async entries(
    scope: InScope,
    filter: {
      month?: string | null;
      fromDay?: string | null;
      toDay?: string | null;
      investorId?: string | null;
      loanId?: string | null;
    },
    now: Date,
  ): Promise<BooksEntriesView> {
    const present = (value: string | null | undefined): value is string => value != null && value !== '';
    // Half a range is refused, not read as "from then on": the screen always sends both.
    if (present(filter.fromDay) !== present(filter.toDay)) throw refusalError('invalid_range');
    const given = [filter.month, filter.fromDay, filter.investorId, filter.loanId].filter(present);
    if (given.length > 1) throw refusalError('invalid_range');

    if (filter.investorId) return this.page(scope, { ...scope, investorId: filter.investorId }, 0);
    if (filter.loanId) return this.page(scope, { ...scope, loanId: filter.loanId }, 0);

    let period: { fromDay: string; toDay: string };
    if (present(filter.fromDay) && present(filter.toDay)) {
      const range = prepareBooksRange(filter.fromDay, filter.toDay);
      if ('refused' in range) throw refusalError(range.refused);
      period = range;
    } else {
      const month = filter.month ?? monthOfDay((await this.zones.today(scope, now)).today);
      if (!isBooksMonth(month)) throw refusalError('invalid_period');
      period = monthBounds(month);
    }
    const { fromDay, toDay } = period;
    const { entries } = await liveLedger(this.prisma, scope);
    const opening = moneyOnHand(entries, previousBooksDay(fromDay)).total;
    return this.page(scope, { ...scope, day: { gte: booksDayToDate(fromDay), lte: booksDayToDate(toDay) } }, opening);
  }

  private async page(scope: InScope, where: BooksEntryWhere, opening: number): Promise<BooksEntriesView> {
    const { rows, truncated } = await readEntries(this.prisma, { ...where, ...scope });
    const names = await this.directory.names(
      rows.flatMap((row) => (row.voidedById ? [row.recordedById, row.voidedById] : [row.recordedById])),
    );
    return { entries: rows.map((row) => renderEntry(row, names)), opening, truncated };
  }

  /** Whether sales come in from the POS, and from which day the next import starts. */
  posStatus(settings: BooksSettingsView): BooksPosStatusView {
    return {
      available: this.sales !== undefined,
      connected: settings.posImportFrom !== null,
      importFrom: settings.posImportFrom,
      recordedThrough: settings.posRecordedThrough,
      nextFromDay: nextPosDay(settings),
    };
  }
}

/**
 * The first day the next import covers: the day after the last one brought in,
 * or the chosen first day — whichever is LATER, so moving the first day
 * forward skips days rather than bringing them in twice. Null: not connected.
 */
export function nextPosDay(settings: Pick<BooksSettingsView, 'posImportFrom' | 'posRecordedThrough'>): BooksDay | null {
  if (settings.posImportFrom === null) return null;
  if (settings.posRecordedThrough === null) return settings.posImportFrom;
  const after = nextBooksDay(settings.posRecordedThrough);
  return after > settings.posImportFrom ? after : settings.posImportFrom;
}
