import { Inject, Injectable } from '@nestjs/common';
import { checkStockQuantity } from '../domain/quantities.js';
import { checkStockCount, planTakeDifferences, takeMoves } from '../domain/takes.js';
import { prepareStockText } from '../domain/text.js';
import type { StockQuantity } from '../types.js';
import type { StockTakeView } from '../views.js';
import { refusalError, unwrap } from './stock.errors.js';
import { StockEventPublisher } from './stock.events.js';
import { readOnHand, STOCK_READ_MAX } from './stock.lookup.js';
import type { InScope, StockTakeRow, StockTransaction, StockWriteClient } from './stock.repository.js';
import { STOCK_PRISMA_WRITE } from './stock.tokens.js';
import { renderTake } from './stock.views.js';
import { StockDirectoryService } from './stock-directory.service.js';

/** The takes the list shows: the latest, which is all a store looks back on. */
const TAKES_PAGE = 50;

/**
 * Stock takes: open a count sheet, type what is on the shelf, confirm
 * (INVENTORY-PLAN §2).
 *
 * ⚠ ONE OPEN TAKE AT A TIME per store. Two sheets open on the same shelf would
 * each confirm a difference against the other's correction.
 *
 * ⚠ COMPARED AT CONFIRMATION (`planTakeDifferences`), not when the sheet was
 * opened, so a sale between the two is not written back.
 */
@Injectable()
export class StockTakeService {
  constructor(
    @Inject(STOCK_PRISMA_WRITE) private readonly prisma: StockWriteClient,
    private readonly events: StockEventPublisher,
    private readonly directory: StockDirectoryService,
  ) {}

  async list(scope: InScope): Promise<StockTakeView[]> {
    const rows = await this.prisma.stockTake.findMany({
      where: { ...scope },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: TAKES_PAGE,
    });
    const names = await this.directory.names(rows.map((row) => row.createdById));
    // The list shows headers only; a take's lines are read when it is opened.
    return rows.map((row) => renderTake(row, [], new Map(), names));
  }

  async take(scope: InScope, id: string): Promise<StockTakeView> {
    const row = await this.prisma.stockTake.findFirst({ where: { ...scope, id } });
    if (!row) throw refusalError('not_found');
    return this.render(scope, row);
  }

  /** A sheet of every live item in `categoryIds` (none: every item), nothing counted yet. */
  async start(
    scope: InScope,
    actorId: string,
    input: { categoryIds: readonly string[]; note?: string | null | undefined },
  ): Promise<StockTakeView> {
    const note = unwrap(prepareStockText(input.note)).text;
    const categoryIds = [...new Set(input.categoryIds)];
    const row = await this.prisma.$transaction(async (tx) => {
      if (await tx.stockTake.findFirst({ where: { ...scope, status: 'open' } })) throw refusalError('take_open');
      const items = await tx.stockItem.findMany({
        where:
          categoryIds.length > 0
            ? { ...scope, archivedAt: null, categoryId: { in: categoryIds } }
            : { ...scope, archivedAt: null },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: STOCK_READ_MAX,
      });
      if (items.length === 0) throw refusalError('no_change');
      const take = await tx.stockTake.create({ data: { ...scope, categoryIds, note, createdById: actorId } });
      await tx.stockTakeLine.createMany({
        data: items.map((item) => ({
          takeId: take.id,
          stockItemId: item.id,
          workspaceId: scope.workspaceId,
          updatedById: actorId,
        })),
      });
      return take;
    });
    await this.events.changed(scope, 'take', actorId);
    return this.render(scope, row);
  }

  /** Typed counts, saved as they are typed so a long count survives a closed tab. Null clears a line. */
  async saveCounts(
    scope: InScope,
    actorId: string,
    takeId: string,
    counts: readonly { stockItemId: string; counted: StockQuantity | null }[],
  ): Promise<StockTakeView> {
    const row = await this.prisma.$transaction(async (tx) => {
      const take = await this.openTake(tx, scope, takeId);
      const lines = new Map(
        (await tx.stockTakeLine.findMany({ where: { takeId } })).map((line) => [line.stockItemId, line]),
      );
      // Sequential: one small update per typed line, in the one transaction.
      for (const count of counts) {
        if (!lines.has(count.stockItemId)) throw refusalError('not_found');
        if (count.counted !== null) await this.checkCount(tx, scope, count.stockItemId, count.counted);
        await tx.stockTakeLine.updateMany({
          where: { takeId, stockItemId: count.stockItemId },
          data: { counted: count.counted, updatedById: actorId },
        });
      }
      return take;
    });
    await this.events.changed(scope, 'take', actorId);
    return this.render(scope, row);
  }

  /** One `count` move per counted line that differs from on hand NOW, and the sheet closed. */
  async confirm(scope: InScope, actorId: string, takeId: string): Promise<StockTakeView> {
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const take = await this.openTake(tx, scope, takeId);
      const lines = await tx.stockTakeLine.findMany({ where: { takeId } });
      const onHand = await readOnHand(
        tx,
        scope,
        lines.map((line) => line.stockItemId),
      );
      const differences = planTakeDifferences(lines, onHand);
      if (differences.length === 0) throw refusalError('no_change');
      // ⚠ Closed FIRST, guarded on `open`: a second confirm racing this one finds nothing to close and writes nothing.
      const { count } = await tx.stockTake.updateMany({
        where: { ...scope, id: takeId, status: 'open' },
        data: { status: 'confirmed', closedById: actorId, closedAt: now },
      });
      if (count === 0) throw refusalError('take_closed');
      for (const line of differences) {
        await tx.stockTakeLine.updateMany({
          where: { takeId, stockItemId: line.stockItemId },
          data: { onHandAtConfirm: line.onHand, updatedById: actorId },
        });
      }
      const moves = takeMoves(differences);
      if (moves.length > 0) {
        await tx.stockMove.createMany({
          data: moves.map((move) => ({
            ...scope,
            stockItemId: move.stockItemId,
            kind: 'count' as const,
            quantity: move.quantity,
            unitCost: null,
            sourceKey: null,
            sourceLineId: null,
            takeId,
            wasteRefId: null,
            wasteRefLabel: null,
            reason: null,
            note: null,
            supplier: null,
            reference: null,
            clientId: null,
            createdById: actorId,
          })),
        });
      }
      return { ...take, status: 'confirmed' as const, closedById: actorId, closedAt: now };
    });
    await this.events.changed(scope, 'stock', actorId);
    return this.render(scope, row);
  }

  async abandon(scope: InScope, actorId: string, takeId: string): Promise<StockTakeView> {
    const now = new Date();
    const { count } = await this.prisma.stockTake.updateMany({
      where: { ...scope, id: takeId, status: 'open' },
      data: { status: 'abandoned', closedById: actorId, closedAt: now },
    });
    if (count === 0) {
      const exists = await this.prisma.stockTake.findFirst({ where: { ...scope, id: takeId } });
      throw refusalError(exists ? 'take_closed' : 'not_found');
    }
    await this.events.changed(scope, 'take', actorId);
    return this.take(scope, takeId);
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async openTake(tx: StockTransaction, scope: InScope, id: string): Promise<StockTakeRow> {
    const take = await tx.stockTake.findFirst({ where: { ...scope, id } });
    if (!take) throw refusalError('not_found');
    if (take.status !== 'open') throw refusalError('take_closed');
    return take;
  }

  /** A count is zero or more, and whole for pieces, sheets and packs. */
  private async checkCount(tx: StockTransaction, scope: InScope, stockItemId: string, counted: number): Promise<void> {
    const refused = checkStockCount(counted);
    if (refused) throw refusalError(refused);
    if (counted === 0) return;
    const item = await tx.stockItem.findFirst({ where: { ...scope, id: stockItemId } });
    if (!item) throw refusalError('not_found');
    const unitRefused = checkStockQuantity(counted, item.unit);
    if (unitRefused) throw refusalError(unitRefused);
  }

  private async render(scope: InScope, row: StockTakeRow): Promise<StockTakeView> {
    const lines = await this.prisma.stockTakeLine.findMany({ where: { takeId: row.id } });
    const [onHand, names] = await Promise.all([
      row.status === 'open'
        ? readOnHand(
            this.prisma,
            scope,
            lines.map((line) => line.stockItemId),
          )
        : new Map<string, number>(),
      this.directory.names([row.createdById]),
    ]);
    return renderTake(row, lines, onHand, names);
  }
}
