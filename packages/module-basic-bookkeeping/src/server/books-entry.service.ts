import { Inject, Injectable } from '@nestjs/common';
import { investorBalance, investorBalances, loanBalances } from '../domain/balances.js';
import { booksDayFromDate, booksDayToDate, prepareBooksDay, previousBooksDay } from '../domain/days.js';
import { BOOKS_INVESTOR_KINDS, BOOKS_RECORDED_KINDS, decidesShares, prepareBooksEntry } from '../domain/entries.js';
import { checkInvestorEntry, checkLoanRepayment, isInvestorEntryKind } from '../domain/investors.js';
import { prepareBooksLine, prepareBooksReason, prepareBooksText } from '../domain/text.js';
import { BOOKS_FEATURE } from '../feature-keys.js';
import type { BooksDay, BooksEntryKind, BooksPlace } from '../types.js';
import { refusalError, unwrap } from './books.errors.js';
import { BooksEventPublisher } from './books.events.js';
import {
  type BooksSettingsView,
  isUniqueViolation,
  lockBooks,
  moveMarks,
  readEntries,
  toLedgerEntry,
} from './books.lookup.js';
import type { BooksEntryRow, BooksLoanRow, BooksTransaction, BooksWriteClient, InScope } from './books.repository.js';
import { BOOKS_PRISMA_WRITE } from './books.tokens.js';
import { type BooksEntryView, type BooksLoanView, renderEntry, renderLoan } from './books.views.js';
import { BooksAccessService } from './books-access.service.js';
import { BooksTimeZoneService } from './books-time-zone.service.js';

/** A day-to-day entry, as the form sends it. */
export interface RecordBooksEntryInput {
  kind: string;
  amount: number;
  place: string | null;
  toPlace?: string | null | undefined;
  day: string;
  category?: string | null | undefined;
  description?: string | null | undefined;
  reference?: string | null | undefined;
  loanId?: string | null | undefined;
  /** The form's id for this entry: a second press with the same id records nothing new. */
  clientId: string;
}

/** An investor's entry, as the form sends it. */
export interface RecordBooksInvestorEntryInput {
  kind: string;
  investorId: string;
  amount: number;
  /** Null for a reinvestment, which moves no money. */
  place: string | null;
  day: string;
  description?: string | null | undefined;
  reference?: string | null | undefined;
  /** Payouts only: paid ahead of profit, leaving them owing. */
  advance?: boolean | null | undefined;
  clientId: string;
}

/** Lending: to a new borrower (`loanId` omitted, `borrowerName` given), or more to one already owing. */
export interface LendBooksMoneyInput {
  loanId?: string | null | undefined;
  borrowerName?: string | null | undefined;
  contact?: string | null | undefined;
  note?: string | null | undefined;
  amount: number;
  place: string;
  day: string;
  description?: string | null | undefined;
  reference?: string | null | undefined;
  clientId: string;
}

/** The fields every new entry is checked for, once they are prepared. */
interface PreparedEntry {
  kind: BooksEntryKind;
  amount: number;
  place: BooksPlace | null;
  toPlace: BooksPlace | null;
  day: BooksDay;
  category: string | null;
  description: string | null;
  reference: string | null;
  investorId: string | null;
  loanId: string | null;
  advance: boolean;
  clientId: string;
}

/** A client id as stored: a short, plain token. */
function prepareClientId(raw: string): string {
  const id = prepareBooksLine(raw, 64);
  if (id === null) throw refusalError('invalid_text');
  return id;
}

/**
 * Recording money, lending it and voiding a mistake (BOOKKEEPING-PLAN §2).
 *
 * ⚠ EVERY WRITE TAKES THE BOOKS' LOCK FIRST (`lockBooks`), then decides on what
 * it reads under it: two payouts at once cannot both fit in what one investor
 * is owed, and nothing slips into a period while its profit is being shared.
 *
 * ⚠ A SECOND PRESS RECORDS NOTHING NEW. Each form sends a `clientId`; an entry
 * that already has it is returned as it is (`@@unique([workspaceId, clientId])`
 * catches two presses that race).
 */
@Injectable()
export class BooksEntryService {
  constructor(
    @Inject(BOOKS_PRISMA_WRITE) private readonly prisma: BooksWriteClient,
    private readonly events: BooksEventPublisher,
    private readonly zones: BooksTimeZoneService,
    private readonly access: BooksAccessService,
  ) {}

  /** Sales, refunds, expenses, purchases, transfers, count adjustments, repayments — `books:record`. */
  async record(scope: InScope, actorId: string, input: RecordBooksEntryInput, now: Date): Promise<BooksEntryView> {
    const kind = input.kind as BooksEntryKind;
    // The kinds this operation takes; investors' money and lending have their own operations and keys.
    if (!BOOKS_RECORDED_KINDS.includes(kind)) throw refusalError('invalid_kind');
    const entry = await this.prepare(scope, now, {
      kind,
      amount: input.amount,
      place: input.place,
      toPlace: input.toPlace ?? null,
      day: input.day,
      category: input.category ?? null,
      description: input.description ?? null,
      reference: input.reference ?? null,
      investorId: null,
      loanId: input.loanId ?? null,
      advance: false,
      clientId: input.clientId,
    });
    return this.write(scope, actorId, entry, async (tx) => {
      if (entry.kind !== 'loan_repayment' || entry.loanId === null) return;
      await loadLoan(tx, scope, entry.loanId);
      const balance = (await loanBalancesOf(tx, scope, entry.loanId)).get(entry.loanId);
      const refused = checkLoanRepayment(
        entry.amount,
        balance ?? { lent: 0, repaid: 0, outstanding: 0, lastDay: null },
      );
      if (refused) throw refusalError(refused);
    });
  }

  /** Capital in, a payout, a capital return, a reinvestment — `books:manage_investors`. */
  async recordInvestor(
    scope: InScope,
    actorId: string,
    input: RecordBooksInvestorEntryInput,
    now: Date,
  ): Promise<BooksEntryView> {
    const kind = input.kind as BooksEntryKind;
    if (!BOOKS_INVESTOR_KINDS.includes(kind) || !isInvestorEntryKind(kind)) throw refusalError('invalid_kind');
    const advance = kind === 'payout' && input.advance === true;
    const entry = await this.prepare(scope, now, {
      kind,
      amount: input.amount,
      place: input.place,
      toPlace: null,
      day: input.day,
      category: null,
      description: input.description ?? null,
      reference: input.reference ?? null,
      investorId: input.investorId,
      loanId: null,
      advance,
      clientId: input.clientId,
    });
    return this.write(scope, actorId, entry, async (tx) => {
      const investor = await tx.booksInvestor.findFirst({ where: { ...scope, id: input.investorId } });
      if (!investor) throw refusalError('not_found');
      const { rows } = await readEntries(tx, { ...scope, investorId: investor.id, voidedAt: null });
      const balance = investorBalance(investorBalances(rows.map(toLedgerEntry)), investor.id);
      const refused = checkInvestorEntry(kind, entry.amount, {
        balance,
        former: investor.formerAt !== null,
        advance,
      });
      if (refused) throw refusalError(refused);
    });
  }

  /**
   * Lends money — to a new borrower, or more to one already owing — as ONE
   * write: a loan with no money behind it, or money lent to nobody, cannot be
   * left half-recorded.
   */
  async lend(scope: InScope, actorId: string, input: LendBooksMoneyInput, now: Date): Promise<BooksLoanView> {
    const clientId = prepareClientId(input.clientId);
    const replay = await this.prisma.booksEntry.findFirst({ where: { ...scope, clientId } });
    if (replay?.loanId) return this.loanView(scope, replay.loanId);

    const borrower = input.loanId ? null : prepareBorrower(input);
    const entry = await this.prepare(scope, now, {
      kind: 'loan_out',
      amount: input.amount,
      place: input.place,
      toPlace: null,
      day: input.day,
      category: null,
      description: input.description ?? null,
      reference: input.reference ?? null,
      // Filled in below, once the loan exists; `prepareBooksEntry` only asks that there is one.
      loanId: input.loanId ?? 'new',
      investorId: null,
      advance: false,
      clientId,
    });

    let loanId = '';
    try {
      loanId = await this.prisma.$transaction(async (tx) => {
        await lockBooks(tx, scope, actorId);
        const loan = borrower
          ? await tx.booksLoan.create({ data: { ...scope, ...borrower, createdById: actorId } })
          : await loadLoan(tx, scope, entry.loanId ?? '');
        await createEntry(tx, scope, actorId, { ...entry, loanId: loan.id });
        return loan.id;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.prisma.booksEntry.findFirst({ where: { ...scope, clientId } });
      if (!raced?.loanId) throw refusalError('conflict');
      loanId = raced.loanId;
    }
    await this.events.changed(scope, actorId);
    return this.loanView(scope, loanId);
  }

  /** Corrects a borrower's name, contact or note. The money is in the entries, and is never edited. */
  async saveLoan(
    scope: InScope,
    actorId: string,
    loanId: string,
    input: { borrowerName: string; contact?: string | null | undefined; note?: string | null | undefined },
  ): Promise<BooksLoanView> {
    const borrower = prepareBorrower(input);
    await this.prisma.$transaction(async (tx) => {
      await lockBooks(tx, scope, actorId);
      const updated = await tx.booksLoan.updateMany({ where: { ...scope, id: loanId }, data: borrower });
      if (updated.count === 0) throw refusalError('not_found');
    });
    await this.events.changed(scope, actorId);
    return this.loanView(scope, loanId);
  }

  /**
   * Voids an entry: kept, with who, when and why, and counted for nothing.
   *
   * - An INVESTOR's entry also needs `books:manage_investors` — the operation is
   *   bound to `books:record` (see the registry).
   * - A profit share's part is voided only with its whole share.
   * - An entry of sales brought in from the POS voids the WHOLE import, which
   *   must be the latest: the next import starts the day after the last, so a
   *   hole in the middle would never be filled.
   * - Anything that decides a profit share, dated in a shared period, stays.
   * - Nothing may leave an investor with negative capital, or a loan repaid
   *   past what was lent.
   */
  async void(scope: InScope, actorId: string, entryId: string, rawReason: string): Promise<BooksEntryView> {
    const { reason } = unwrap(prepareBooksReason(rawReason));
    const found = await this.prisma.booksEntry.findFirst({ where: { ...scope, id: entryId } });
    if (!found) throw refusalError('not_found');
    if (found.kind === 'profit_share') throw refusalError('part_of_share');
    if (isInvestorEntryKind(found.kind) && !(await this.access.holds(scope, actorId, BOOKS_FEATURE.manageInvestors))) {
      throw refusalError('not_permitted');
    }

    await this.prisma.$transaction(async (tx) => {
      const settings = await lockBooks(tx, scope, actorId);
      const entry = await tx.booksEntry.findFirst({ where: { ...scope, id: entryId } });
      if (!entry) throw refusalError('not_found');
      if (entry.voidedAt !== null) throw refusalError('already_voided');
      const day = booksDayFromDate(entry.day);
      if (decidesShares(entry.kind) && isShared(settings, day)) throw refusalError('day_shared');
      const voided = { voidedAt: new Date(), voidedById: actorId, voidReason: reason };

      if (entry.importId) {
        await voidImport(tx, scope, actorId, settings, entry.importId, voided);
        return;
      }
      await checkVoidKeepsBalances(tx, scope, entry);
      const updated = await tx.booksEntry.updateMany({
        where: { ...scope, id: entry.id, voidedAt: null },
        data: voided,
      });
      if (updated.count === 0) throw refusalError('already_voided');
    });
    await this.events.changed(scope, actorId);
    const after = await this.prisma.booksEntry.findFirst({ where: { ...scope, id: entryId } });
    if (!after) throw refusalError('not_found');
    return renderEntry(after);
  }

  /** Normalises and validates a draft — everything that needs no database. */
  private async prepare(
    scope: InScope,
    now: Date,
    raw: Omit<PreparedEntry, 'place' | 'toPlace' | 'day'> & {
      place: string | null;
      toPlace: string | null;
      day: string;
    },
  ): Promise<PreparedEntry> {
    const { today } = await this.zones.today(scope, now);
    const { day } = unwrap(prepareBooksDay(raw.day, today));
    // A wire string narrowed: `prepareBooksEntry` refuses anything that is not a place.
    const place = raw.place as BooksPlace | null;
    const toPlace = raw.toPlace as BooksPlace | null;
    const { category } = unwrap(
      prepareBooksEntry({
        kind: raw.kind,
        amount: raw.amount,
        place,
        toPlace,
        investorId: raw.investorId,
        loanId: raw.loanId,
        category: raw.category,
      }),
    );
    const { text: description } = unwrap(prepareBooksText(raw.description));
    const { text: reference } = unwrap(prepareBooksText(raw.reference));
    return { ...raw, place, toPlace, day, category, description, reference, clientId: prepareClientId(raw.clientId) };
  }

  /**
   * The write every entry shares: replay by client id, lock, the shared-period
   * rule, the caller's own check under the lock, create, publish after the
   * commit.
   */
  private async write(
    scope: InScope,
    actorId: string,
    entry: PreparedEntry,
    check: (tx: BooksTransaction) => Promise<void>,
  ): Promise<BooksEntryView> {
    const replay = await this.prisma.booksEntry.findFirst({ where: { ...scope, clientId: entry.clientId } });
    if (replay) return renderEntry(replay);
    let row: BooksEntryRow;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        const settings = await lockBooks(tx, scope, actorId);
        if (decidesShares(entry.kind) && isShared(settings, entry.day)) throw refusalError('day_shared');
        await check(tx);
        return createEntry(tx, scope, actorId, entry);
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.prisma.booksEntry.findFirst({ where: { ...scope, clientId: entry.clientId } });
      if (!raced) throw refusalError('conflict');
      return renderEntry(raced);
    }
    await this.events.changed(scope, actorId);
    return renderEntry(row);
  }

  private async loanView(scope: InScope, loanId: string): Promise<BooksLoanView> {
    const loan = await loadLoan(this.prisma, scope, loanId);
    const balance = (await loanBalancesOf(this.prisma, scope, loanId)).get(loanId);
    return renderLoan(loan, balance ?? { lent: 0, repaid: 0, outstanding: 0, lastDay: null });
  }
}

/** Whether `day` is in a period whose profit was already shared. */
function isShared(settings: BooksSettingsView, day: BooksDay): boolean {
  return settings.sharedThrough !== null && day <= settings.sharedThrough;
}

function createEntry(tx: BooksTransaction, scope: InScope, actorId: string, entry: PreparedEntry) {
  return tx.booksEntry.create({
    data: {
      ...scope,
      kind: entry.kind,
      amount: entry.amount,
      place: entry.place,
      toPlace: entry.toPlace,
      day: booksDayToDate(entry.day),
      category: entry.category,
      description: entry.description,
      reference: entry.reference,
      investorId: entry.investorId,
      loanId: entry.loanId,
      importId: null,
      shareId: null,
      advance: entry.advance,
      clientId: entry.clientId,
      recordedById: actorId,
    },
  });
}

/** A borrower's details as stored, or the refusal. */
function prepareBorrower(input: {
  borrowerName?: string | null | undefined;
  contact?: string | null | undefined;
  note?: string | null | undefined;
}): { borrowerName: string; contact: string | null; note: string | null } {
  const borrowerName = prepareBooksLine(input.borrowerName ?? '', 120);
  if (borrowerName === null) throw refusalError('invalid_name');
  const { text: contact } = unwrap(prepareBooksText(input.contact));
  const { text: note } = unwrap(prepareBooksText(input.note));
  return { borrowerName, contact, note };
}

async function loadLoan(
  client: Pick<BooksTransaction, 'booksLoan'>,
  scope: InScope,
  loanId: string,
): Promise<BooksLoanRow> {
  const loan = await client.booksLoan.findFirst({ where: { ...scope, id: loanId } });
  if (!loan) throw refusalError('not_found');
  return loan;
}

async function loanBalancesOf(client: Pick<BooksTransaction, 'booksEntry'>, scope: InScope, loanId: string) {
  const { rows } = await readEntries(client, { ...scope, loanId, voidedAt: null });
  return loanBalances(rows.map(toLedgerEntry));
}

/**
 * Whether voiding `entry` leaves every balance it touches standing: an
 * investor's capital not below 0 (voiding capital they were since paid back),
 * a loan not repaid past what was lent (voiding the lending after repayments).
 */
async function checkVoidKeepsBalances(tx: BooksTransaction, scope: InScope, entry: BooksEntryRow): Promise<void> {
  if (entry.investorId && (entry.kind === 'capital' || entry.kind === 'reinvest')) {
    const { rows } = await readEntries(tx, { ...scope, investorId: entry.investorId, voidedAt: null });
    const after = rows.filter((row) => row.id !== entry.id).map(toLedgerEntry);
    if (investorBalance(investorBalances(after), entry.investorId).capital < 0) throw refusalError('exceeds_capital');
  }
  if (entry.loanId && entry.kind === 'loan_out') {
    const { rows } = await readEntries(tx, { ...scope, loanId: entry.loanId, voidedAt: null });
    const after = loanBalances(rows.filter((row) => row.id !== entry.id).map(toLedgerEntry)).get(entry.loanId);
    if (after && after.outstanding < 0) throw refusalError('exceeds_loan');
  }
}

/**
 * Voids a whole POS import and its entries, and moves the "brought in through"
 * day back to the day before it — so the next import brings those days in
 * again. Only the LATEST import, for the reason in `void` above.
 */
async function voidImport(
  tx: BooksTransaction,
  scope: InScope,
  actorId: string,
  settings: BooksSettingsView,
  importId: string,
  voided: { voidedAt: Date; voidedById: string; voidReason: string },
): Promise<void> {
  const batch = await tx.booksSalesImport.findFirst({ where: { ...scope, id: importId } });
  if (!batch) throw refusalError('not_found');
  if (batch.voidedAt !== null) throw refusalError('already_voided');
  const toDay = booksDayFromDate(batch.toDay);
  if (settings.posRecordedThrough !== toDay) throw refusalError('not_latest');
  if (isShared(settings, toDay)) throw refusalError('day_shared');
  await tx.booksSalesImport.updateMany({ where: { ...scope, id: batch.id, voidedAt: null }, data: voided });
  await tx.booksEntry.updateMany({ where: { ...scope, importId: batch.id, voidedAt: null }, data: voided });
  const before = previousBooksDay(booksDayFromDate(batch.fromDay));
  const backTo = settings.posImportFrom !== null && before >= settings.posImportFrom ? before : null;
  await moveMarks(tx, scope, actorId, settings.version, {
    posRecordedThrough: backTo === null ? null : booksDayToDate(backTo),
  });
}
