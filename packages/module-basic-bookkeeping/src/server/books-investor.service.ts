import { Inject, Injectable } from '@nestjs/common';
import { checkAgreedShare, investorBalance, investorBalances, profitShares } from '../domain/balances.js';
import { booksDayFromDate, booksDayToDate, isBooksDay } from '../domain/days.js';
import { checkMarkFormer } from '../domain/investors.js';
import { type BooksProfitSharePlan, planProfitShare } from '../domain/profit.js';
import { prepareBooksLine, prepareBooksName, prepareBooksReason, prepareBooksText } from '../domain/text.js';
import type { BooksShareMode } from '../types.js';
import { booksRefusalMessage, refusalError, unwrap } from './books.errors.js';
import { BooksEventPublisher } from './books.events.js';
import {
  allImports,
  type BooksSettingsView,
  isUniqueViolation,
  lockBooks,
  moveMarks,
  readEntries,
  readSettings,
  toImportFigures,
  toLedgerEntry,
} from './books.lookup.js';
import type { BooksInvestorRow, BooksTransaction, BooksWriteClient, InScope } from './books.repository.js';
import { BOOKS_PRISMA_WRITE } from './books.tokens.js';
import {
  type BooksInvestorView,
  type BooksProfitShareView,
  type BooksSettingsOut,
  type BooksSharePlanView,
  renderInvestor,
  renderProfitShare,
} from './books.views.js';
import { BooksTimeZoneService } from './books-time-zone.service.js';

/** An investor as the form sends it. Omit `investorId` for a new one. */
export interface SaveBooksInvestorInput {
  investorId?: string | null | undefined;
  name: string;
  contact?: string | null | undefined;
  note?: string | null | undefined;
  /** Basis points, or null for "not agreed". */
  agreedShare?: number | null | undefined;
}

/**
 * The owners' side of the books (BOOKKEEPING-PLAN §3–4), bound to
 * `books:manage_investors`: who the investors are, how profit is shared, and
 * sharing it.
 *
 * ⚠ A PROFIT SHARE IS PLANNED AND STORED BY THE SAME FUNCTION
 * (`planProfitShare`), under the books' lock: what the preview showed is what
 * each investor is owed, to the centavo — unless somebody recorded something
 * in between, and then the numbers are planned again from what is there now.
 */
@Injectable()
export class BooksInvestorService {
  constructor(
    @Inject(BOOKS_PRISMA_WRITE) private readonly prisma: BooksWriteClient,
    private readonly events: BooksEventPublisher,
    private readonly zones: BooksTimeZoneService,
  ) {}

  async save(scope: InScope, actorId: string, input: SaveBooksInvestorInput): Promise<BooksInvestorView> {
    const { name, nameKey } = unwrap(prepareBooksName(input.name));
    const { text: contact } = unwrap(prepareBooksText(input.contact));
    const { text: note } = unwrap(prepareBooksText(input.note));
    const agreedShare = input.agreedShare ?? null;
    const refused = checkAgreedShare(agreedShare);
    if (refused) throw refusalError(refused);

    let investorId = input.investorId ?? '';
    try {
      investorId = await this.prisma.$transaction(async (tx) => {
        await lockBooks(tx, scope, actorId);
        const fields = { name, nameKey, contact, note, agreedShare };
        if (!input.investorId) {
          return (await tx.booksInvestor.create({ data: { ...scope, ...fields, createdById: actorId } })).id;
        }
        const updated = await tx.booksInvestor.updateMany({ where: { ...scope, id: input.investorId }, data: fields });
        if (updated.count === 0) throw refusalError('not_found');
        return input.investorId;
      });
    } catch (error) {
      // `@@unique([workspaceId, nameKey])`: "Maria" and "maria" are one investor.
      if (isUniqueViolation(error)) throw refusalError('duplicate_name');
      throw error;
    }
    await this.events.changed(scope, actorId);
    return this.view(scope, investorId);
  }

  /**
   * Marks an investor former (their capital all returned), or restores one.
   * History is kept either way; a former investor takes no new share.
   */
  async setFormer(scope: InScope, actorId: string, investorId: string, former: boolean): Promise<BooksInvestorView> {
    await this.prisma.$transaction(async (tx) => {
      await lockBooks(tx, scope, actorId);
      const investor = await loadInvestor(tx, scope, investorId);
      if (former) {
        const { rows } = await readEntries(tx, { ...scope, investorId, voidedAt: null });
        const refused = checkMarkFormer(investorBalance(investorBalances(rows.map(toLedgerEntry)), investorId));
        if (refused) throw refusalError(refused);
      }
      await tx.booksInvestor.updateMany({
        where: { ...scope, id: investor.id },
        data: { formerAt: former ? (investor.formerAt ?? new Date()) : null },
      });
    });
    await this.events.changed(scope, actorId);
    return this.view(scope, investorId);
  }

  /**
   * How profit is shared, and the first day to bring the POS's sales in from
   * (null: sales are recorded by hand). A new share mode applies to the NEXT
   * share; past shares keep the mode they were made with.
   */
  async saveSettings(
    scope: InScope,
    actorId: string,
    input: { shareMode: string; posImportFrom?: string | null | undefined },
  ): Promise<BooksSettingsOut> {
    if (input.shareMode !== 'capital' && input.shareMode !== 'agreed') throw refusalError('invalid_kind');
    const shareMode: BooksShareMode = input.shareMode;
    const from = input.posImportFrom ?? null;
    if (from !== null && !isBooksDay(from)) throw refusalError('invalid_day');
    const posImportFrom = from === null ? null : booksDayToDate(from);
    const row = await this.prisma.booksSettings.upsert({
      where: { workspaceId: scope.workspaceId },
      create: { ...scope, updatedById: actorId, shareMode, posImportFrom },
      update: { version: { increment: 1 }, updatedById: actorId, shareMode, posImportFrom },
    });
    if (row.organizationId !== scope.organizationId) throw refusalError('not_found');
    await this.events.changed(scope, actorId);
    return {
      shareMode: row.shareMode,
      posImportFrom: row.posImportFrom ? booksDayFromDate(row.posImportFrom) : null,
      version: row.version,
    };
  }

  /** What sharing through `toDay`, keeping `kept`, would give each investor — or why it cannot. Nothing is written. */
  async preview(scope: InScope, toDay: string, kept: number, now: Date): Promise<BooksSharePlanView> {
    const settings = await readSettings(this.prisma, scope);
    const plan = await this.plan(this.prisma, scope, settings, toDay, kept, now);
    if (plan.kind === 'refused') {
      return {
        ok: false,
        refusal: booksRefusalMessage(plan.reason),
        fromDay: plan.fromDay,
        toDay,
        profit: plan.profit,
        kept,
        shared: 0,
        parts: [],
      };
    }
    return {
      ok: true,
      refusal: null,
      fromDay: plan.fromDay,
      toDay: plan.toDay,
      profit: plan.profit,
      kept: plan.kept,
      shared: plan.shared,
      parts: plan.parts,
    };
  }

  /**
   * Shares the profit: one `profit_share` entry per investor, now owed to them,
   * and the period CLOSED — `sharedThrough` moves to `toDay`, so sales,
   * expenses and capital before it can no longer change a split already owed.
   */
  async share(
    scope: InScope,
    actorId: string,
    input: { toDay: string; kept: number; clientId: string },
    now: Date,
  ): Promise<BooksProfitShareView> {
    const clientId = prepareBooksLine(input.clientId, 64);
    if (clientId === null) throw refusalError('invalid_text');
    const replay = await this.prisma.booksProfitShare.findFirst({ where: { ...scope, clientId } });
    if (replay) return this.shareView(scope, replay.id);

    let shareId = '';
    try {
      shareId = await this.prisma.$transaction(async (tx) => {
        const settings = await lockBooks(tx, scope, actorId);
        const plan = await this.plan(tx, scope, settings, input.toDay, input.kept, now);
        if (plan.kind === 'refused') throw refusalError(plan.reason);
        const toDay = booksDayToDate(plan.toDay);
        const share = await tx.booksProfitShare.create({
          data: {
            ...scope,
            fromDay: booksDayToDate(plan.fromDay),
            toDay,
            sales: plan.profit.sales,
            refunds: plan.profit.refunds,
            costOfGoods: plan.profit.costOfGoods,
            expenses: plan.profit.expenses,
            profit: plan.profit.profit,
            kept: plan.kept,
            shared: plan.shared,
            mode: settings.shareMode,
            clientId,
            recordedById: actorId,
          },
        });
        // One at a time: they are few, and each is its own insert in the one transaction.
        for (const part of plan.parts) {
          if (part.amount <= 0) continue;
          await tx.booksEntry.create({
            data: {
              ...scope,
              kind: 'profit_share',
              amount: part.amount,
              place: null,
              toPlace: null,
              day: toDay,
              category: null,
              description: `Profit ${plan.fromDay} to ${plan.toDay}`,
              reference: null,
              investorId: part.investorId,
              loanId: null,
              importId: null,
              shareId: share.id,
              advance: false,
              clientId: null,
              recordedById: actorId,
            },
          });
        }
        await moveMarks(tx, scope, actorId, settings.version, { sharedThrough: toDay });
        return share.id;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.prisma.booksProfitShare.findFirst({ where: { ...scope, clientId } });
      if (!raced) throw refusalError('conflict');
      shareId = raced.id;
    }
    await this.events.changed(scope, actorId);
    return this.shareView(scope, shareId);
  }

  /**
   * Voids the LATEST profit share and what it gave each investor, and reopens
   * its period. A payout already made from it stays: the investor is then
   * owed less than nothing — an advance — until the period is shared again.
   */
  async voidShare(scope: InScope, actorId: string, shareId: string, rawReason: string): Promise<BooksProfitShareView> {
    const { reason } = unwrap(prepareBooksReason(rawReason));
    await this.prisma.$transaction(async (tx) => {
      const settings = await lockBooks(tx, scope, actorId);
      const share = await tx.booksProfitShare.findFirst({ where: { ...scope, id: shareId } });
      if (!share) throw refusalError('not_found');
      if (share.voidedAt !== null) throw refusalError('already_voided');
      if (settings.sharedThrough !== booksDayFromDate(share.toDay)) throw refusalError('not_latest');
      const voided = { voidedAt: new Date(), voidedById: actorId, voidReason: reason };
      await tx.booksProfitShare.updateMany({ where: { ...scope, id: share.id, voidedAt: null }, data: voided });
      await tx.booksEntry.updateMany({ where: { ...scope, shareId: share.id, voidedAt: null }, data: voided });
      const earlier = await tx.booksProfitShare.findMany({
        where: { ...scope, voidedAt: null },
        orderBy: [{ toDay: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
      });
      await moveMarks(tx, scope, actorId, settings.version, { sharedThrough: earlier[0]?.toDay ?? null });
    });
    await this.events.changed(scope, actorId);
    return this.shareView(scope, shareId);
  }

  /** The plan, from what the books hold now. */
  private async plan(
    client: BooksTransaction,
    scope: InScope,
    settings: BooksSettingsView,
    toDay: string,
    kept: number,
    now: Date,
  ): Promise<BooksProfitSharePlan> {
    if (!isBooksDay(toDay)) return { kind: 'refused', reason: 'invalid_day', profit: null, fromDay: null };
    const { today } = await this.zones.today(scope, now);
    // ⚠ One read at a time: inside an interactive transaction the client runs
    // one statement at a time anyway, and a parallel batch on it is not a
    // shape every Prisma version accepts.
    const { rows } = await readEntries(client, { ...scope, voidedAt: null });
    const importRows = await allImports(client, scope);
    const investorRows = await client.booksInvestor.findMany({
      where: scope,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 500,
    });
    return planProfitShare({
      investors: investorRows.map((row) => ({
        id: row.id,
        agreedShare: row.agreedShare,
        former: row.formerAt !== null,
      })),
      entries: rows.map(toLedgerEntry),
      imports: importRows.map(toImportFigures),
      mode: settings.shareMode,
      sharedThrough: settings.sharedThrough,
      pos: { connected: settings.posImportFrom !== null, recordedThrough: settings.posRecordedThrough },
      toDay,
      today,
      kept,
    });
  }

  private async view(scope: InScope, investorId: string): Promise<BooksInvestorView> {
    const [investor, { rows }, investorRows, settings] = await Promise.all([
      loadInvestor(this.prisma, scope, investorId),
      readEntries(this.prisma, { ...scope, voidedAt: null }),
      this.prisma.booksInvestor.findMany({ where: scope, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 500 }),
      readSettings(this.prisma, scope),
    ]);
    const balances = investorBalances(rows.map(toLedgerEntry));
    const split = profitShares(
      investorRows.map((row) => ({ id: row.id, agreedShare: row.agreedShare, former: row.formerAt !== null })),
      balances,
      settings.shareMode,
    );
    const share = 'shares' in split ? (split.shares.get(investor.id) ?? null) : null;
    return renderInvestor(investor, investorBalance(balances, investor.id), share);
  }

  private async shareView(scope: InScope, shareId: string): Promise<BooksProfitShareView> {
    const share = await this.prisma.booksProfitShare.findFirst({ where: { ...scope, id: shareId } });
    if (!share) throw refusalError('not_found');
    const parts = share.voidedAt === null ? await this.partsOf(scope, share.id) : [];
    return renderProfitShare(share, parts);
  }

  private async partsOf(scope: InScope, shareId: string) {
    return (await readEntries(this.prisma, { ...scope, shareId, voidedAt: null })).rows;
  }
}

async function loadInvestor(
  client: Pick<BooksTransaction, 'booksInvestor'>,
  scope: InScope,
  investorId: string,
): Promise<BooksInvestorRow> {
  const investor = await client.booksInvestor.findFirst({ where: { ...scope, id: investorId } });
  if (!investor) throw refusalError('not_found');
  return investor;
}
