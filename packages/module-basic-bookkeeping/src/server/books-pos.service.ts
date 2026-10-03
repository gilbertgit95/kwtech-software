import { Inject, Injectable, Optional } from '@nestjs/common';
import { booksDayToDate, isBooksDay } from '../domain/days.js';
import { BOOKS_PLACES, checkBooksAmount } from '../domain/entries.js';
import { prepareBooksLine } from '../domain/text.js';
import type { BooksDay } from '../types.js';
import { refusalError } from './books.errors.js';
import { BooksEventPublisher } from './books.events.js';
import { type BooksSettingsView, isUniqueViolation, lockBooks, moveMarks, readSettings } from './books.lookup.js';
import type { BooksWriteClient, InScope } from './books.repository.js';
import { BOOKS_PRISMA_WRITE, BOOKS_SALES_SOURCE } from './books.tokens.js';
import { type BooksPosSalesView, type BooksSalesImportView, renderSalesImport } from './books.views.js';
import { nextPosDay } from './books-ledger.service.js';
import { BooksTimeZoneService } from './books-time-zone.service.js';
import type { BooksSalesFigures, BooksSalesSource } from './ports.js';

/** The most days one import covers. A year and a day: "bring in last year" in one go, and no more. */
export const BOOKS_POS_IMPORT_DAYS_MAX = 366;

/**
 * Bringing the point of sale's sales into the books (BOOKKEEPING-PLAN §1), bound
 * to `books:record`.
 *
 * The POS answers "what did we sell"; the books need it as MONEY IN — one
 * `sales` entry per place it came in (cash, e-wallet, bank for cards), dated the
 * last day it covers — and as COST OF GOODS, which the import keeps for profit.
 *
 * ⚠ DAYS COME IN ONCE AND IN ORDER. Each import starts the day after the last
 * one (`posRecordedThrough`), moved under the books' lock, so no day's sales
 * are ever counted twice and none is skipped. Days are taken whole, through a
 * day the person chooses — never "until now", which would close today while
 * today is still selling.
 */
@Injectable()
export class BooksPosService {
  constructor(
    @Inject(BOOKS_PRISMA_WRITE) private readonly prisma: BooksWriteClient,
    private readonly events: BooksEventPublisher,
    private readonly zones: BooksTimeZoneService,
    /** Unbound: there is no point of sale; both operations refuse. */
    @Optional() @Inject(BOOKS_SALES_SOURCE) private readonly sales?: BooksSalesSource,
  ) {}

  /** What bringing the sales in through `toDay` would record. Nothing is written. */
  async preview(scope: InScope, toDay: string, now: Date): Promise<BooksPosSalesView> {
    const settings = await readSettings(this.prisma, scope);
    const { fromDay, source } = await this.range(scope, settings, toDay, now);
    const figures = await source.salesBetween(scope.organizationId, scope.workspaceId, fromDay, toDay);
    return { fromDay, toDay, ...figures };
  }

  async record(
    scope: InScope,
    actorId: string,
    input: { toDay: string; clientId: string },
    now: Date,
  ): Promise<BooksSalesImportView> {
    const clientId = prepareBooksLine(input.clientId, 64);
    if (clientId === null) throw refusalError('invalid_text');
    const replay = await this.prisma.booksSalesImport.findFirst({ where: { ...scope, clientId } });
    if (replay) return renderSalesImport(replay);

    // ⚠ The POS is read OUTSIDE the transaction — a year of orders is a slow
    // read, and the books' lock would be held through it. The range is checked
    // again under the lock: if another import moved it meanwhile, this one is
    // refused as a conflict rather than recorded over days already in.
    const settings = await readSettings(this.prisma, scope);
    const { fromDay, source } = await this.range(scope, settings, input.toDay, now);
    const figures = await source.salesBetween(scope.organizationId, scope.workspaceId, fromDay, input.toDay);
    if (figures.truncated) throw refusalError('pos_truncated');

    let importId = '';
    try {
      importId = await this.prisma.$transaction(async (tx) => {
        const locked = await lockBooks(tx, scope, actorId);
        if (nextPosDay(locked) !== fromDay) throw refusalError('conflict');
        const toDay = booksDayToDate(input.toDay);
        const batch = await tx.booksSalesImport.create({
          data: {
            ...scope,
            fromDay: booksDayToDate(fromDay),
            toDay,
            cash: figures.cash,
            ewallet: figures.ewallet,
            bank: figures.bank,
            costOfGoods: figures.costOfGoods,
            costCoverage: figures.costCoverage,
            orders: figures.orders,
            clientId,
            recordedById: actorId,
          },
        });
        // One place at a time: three inserts at most, in the one transaction.
        for (const [place, amount] of placeAmounts(figures)) {
          await tx.booksEntry.create({
            data: {
              ...scope,
              // ⚠ A place whose refunds outran its sales gave money back: a refund, never a negative sale.
              kind: amount > 0 ? 'sales' : 'refund',
              amount: Math.abs(amount),
              place,
              toPlace: null,
              day: toDay,
              category: 'Point of sale',
              description:
                fromDay === input.toDay ? `Point of sale, ${fromDay}` : `Point of sale, ${fromDay} to ${input.toDay}`,
              reference: null,
              investorId: null,
              loanId: null,
              importId: batch.id,
              shareId: null,
              advance: false,
              clientId: null,
              recordedById: actorId,
            },
          });
        }
        await moveMarks(tx, scope, actorId, locked.version, { posRecordedThrough: toDay });
        return batch.id;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.prisma.booksSalesImport.findFirst({ where: { ...scope, clientId } });
      if (!raced) throw refusalError('conflict');
      importId = raced.id;
    }
    await this.events.changed(scope, actorId);
    const saved = await this.prisma.booksSalesImport.findFirst({ where: { ...scope, id: importId } });
    if (!saved) throw refusalError('not_found');
    return renderSalesImport(saved);
  }

  /**
   * The days an import through `toDay` covers, or why there are none: the POS
   * is not connected, the days are already in, `toDay` is in the future or more
   * than a year on, or the first day falls in a period whose profit is shared.
   */
  private async range(
    scope: InScope,
    settings: BooksSettingsView,
    toDay: string,
    now: Date,
  ): Promise<{ fromDay: BooksDay; source: BooksSalesSource }> {
    const fromDay = nextPosDay(settings);
    if (!this.sales || fromDay === null) throw refusalError('pos_not_connected');
    if (!isBooksDay(toDay)) throw refusalError('invalid_day');
    const { today } = await this.zones.today(scope, now);
    if (toDay > today) throw refusalError('future_day');
    if (toDay < fromDay) throw refusalError('pos_nothing_new');
    if (daysBetween(fromDay, toDay) > BOOKS_POS_IMPORT_DAYS_MAX) throw refusalError('invalid_period');
    if (settings.sharedThrough !== null && fromDay <= settings.sharedThrough) throw refusalError('day_shared');
    return { fromDay, source: this.sales };
  }
}

/**
 * The entries an import makes: one per place that moved, in the screens' order.
 * A place with ₱0 makes none. ⚠ Each amount within `BOOKS_AMOUNT_MAX`, or the
 * import is refused — a figure past ₱1B is the POS's mistake, not a sale.
 */
function placeAmounts(figures: BooksSalesFigures): [(typeof BOOKS_PLACES)[number], number][] {
  const amounts: [(typeof BOOKS_PLACES)[number], number][] = [];
  for (const place of BOOKS_PLACES) {
    const amount = figures[place];
    if (amount === 0) continue;
    const refused = checkBooksAmount(Math.abs(amount));
    if (refused) throw refusalError(refused);
    amounts.push([place, amount]);
  }
  return amounts;
}

/** Days from `fromDay` to `toDay`, inclusive. Zone-free: day keys have no zone. */
function daysBetween(fromDay: BooksDay, toDay: BooksDay): number {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000) + 1;
}
