import { Inject, Injectable } from '@nestjs/common';
import { isStockAdjustReason, isStockWasteReason } from '../domain/guards.js';
import { checkReceive, costAfterReceipt, prepareAdjustment, prepareWaste } from '../domain/moves.js';
import { prepareStockText } from '../domain/text.js';
import type { StockDelta } from '../types.js';
import type { StockMovesView, StockMoveView } from '../views.js';
import { refusalError, unwrap } from './stock.errors.js';
import { StockEventPublisher } from './stock.events.js';
import { findItem, isUniqueViolation, STOCK_READ_MAX } from './stock.lookup.js';
import type {
  InScope,
  StockItemRow,
  StockMoveFields,
  StockMoveRow,
  StockMoveWhere,
  StockTransaction,
  StockWriteClient,
} from './stock.repository.js';
import { STOCK_PRISMA_WRITE } from './stock.tokens.js';
import { renderMove } from './stock.views.js';
import { StockDirectoryService } from './stock-directory.service.js';

/** A history page: the newest first. */
const MOVES_PAGE = 100;

/** The most lines one waste may carry: a product's whole list, and then some. */
const WASTE_LINES_MAX = 30;

/** Fields a move made here leaves empty. */
const BY_HAND = {
  sourceKey: null,
  sourceLineId: null,
  takeId: null,
  wasteRefId: null,
  wasteRefLabel: null,
} as const;

/**
 * Movements made by hand: receiving, adjusting, recording waste — and an
 * item's history (INVENTORY-PLAN §2).
 *
 * ⚠ EVERY MOVE MADE HERE CARRIES THE CLIENT'S ID, unique per item. A double
 * press, or a retry after a dropped connection, clashes on it and is answered
 * with the first move, never recorded twice.
 */
@Injectable()
export class StockMoveService {
  constructor(
    @Inject(STOCK_PRISMA_WRITE) private readonly prisma: StockWriteClient,
    private readonly events: StockEventPublisher,
    private readonly directory: StockDirectoryService,
  ) {}

  /** One item's movements, newest first, a page at a time. The cursor is a move's id. */
  async moves(scope: InScope, stockItemId: string, cursor: string | null): Promise<StockMovesView> {
    const item = await findItem(this.prisma, scope, stockItemId);
    if (!item) throw refusalError('not_found');
    const where: StockMoveWhere = { ...scope, stockItemId };
    if (cursor) {
      const after = await this.prisma.stockMove.findFirst({ where: { ...scope, stockItemId, id: cursor } });
      if (!after) throw refusalError('not_found');
      where.OR = [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }];
    }
    const rows = await this.prisma.stockMove.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MOVES_PAGE + 1,
    });
    const page = rows.slice(0, MOVES_PAGE);
    const names = await this.directory.names(page.map((row) => row.createdById));
    return {
      moves: page.map((row) => renderMove(row, names)),
      nextCursor: rows.length > MOVES_PAGE ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * A delivery. The cost typed becomes the item's cost (I16); `opening` marks
   * the first stock of a new item, so the history says where it started.
   */
  async receive(
    scope: InScope,
    actorId: string,
    input: {
      stockItemId: string;
      quantity: number;
      unitCost?: number | null | undefined;
      supplier?: string | null | undefined;
      reference?: string | null | undefined;
      opening?: boolean | null | undefined;
      clientId: string;
    },
  ): Promise<StockMoveView> {
    const unitCost = input.unitCost ?? null;
    const supplier = unwrap(prepareStockText(input.supplier)).text;
    const reference = unwrap(prepareStockText(input.reference)).text;
    const moves = await this.record(scope, actorId, input.clientId, async (tx) => {
      const item = await this.liveItem(tx, scope, input.stockItemId);
      const refused = checkReceive({ quantity: input.quantity, unitCost }, item.unit);
      if (refused) throw refusalError(refused);
      const nextCost = costAfterReceipt(item.unitCost, unitCost);
      if (nextCost !== item.unitCost) {
        await tx.stockItem.updateMany({
          where: { ...scope, id: item.id },
          data: { unitCost: nextCost, updatedById: actorId },
        });
      }
      return [
        {
          ...scope,
          ...BY_HAND,
          stockItemId: item.id,
          kind: input.opening ? 'opening' : 'received',
          quantity: input.quantity,
          unitCost,
          reason: null,
          note: null,
          supplier,
          reference,
          clientId: input.clientId,
          createdById: actorId,
        },
      ];
    });
    return this.single(moves);
  }

  /** A correction by hand, in or out, with its reason. */
  async adjust(
    scope: InScope,
    actorId: string,
    input: {
      stockItemId: string;
      quantity: number;
      /** A `StockAdjustReason`, as the wire sends it; narrowed here. */
      reason: string;
      note?: string | null | undefined;
      clientId: string;
    },
  ): Promise<StockMoveView> {
    const reason = input.reason;
    if (!isStockAdjustReason(reason)) throw refusalError('invalid_kind');
    const moves = await this.record(scope, actorId, input.clientId, async (tx) => {
      const item = await this.liveItem(tx, scope, input.stockItemId);
      const adjustment = unwrap(prepareAdjustment({ ...input, reason }, item.unit));
      return [
        {
          ...scope,
          ...BY_HAND,
          stockItemId: item.id,
          kind: 'adjustment',
          quantity: adjustment.quantity,
          unitCost: null,
          reason: adjustment.reason,
          note: adjustment.note,
          supplier: null,
          reference: null,
          clientId: input.clientId,
          createdById: actorId,
        },
      ];
    });
    return this.single(moves);
  }

  /**
   * Spoiled work (I15): one `wasted` move per material, every one carrying what
   * it was a waste OF (a POS product's label, or nothing for a single item) and
   * the reason. The form proposes the lines from the product's lists
   * (`proposeWaste`); what arrives here is what the person confirmed.
   */
  async waste(
    scope: InScope,
    actorId: string,
    input: {
      lines: readonly StockDelta[];
      /** A `StockWasteReason`, as the wire sends it; narrowed here. */
      reason: string;
      note?: string | null | undefined;
      of?: { refId: string; refLabel: string } | null | undefined;
      clientId: string;
    },
  ): Promise<StockMoveView[]> {
    const reason = input.reason;
    if (!isStockWasteReason(reason)) throw refusalError('invalid_kind');
    if (input.lines.length > WASTE_LINES_MAX) throw refusalError('limit_reached');
    const ofLabel = input.of ? unwrap(prepareStockText(input.of.refLabel)).text : null;
    return this.record(scope, actorId, input.clientId, async (tx) => {
      const items = new Map<string, StockItemRow>();
      for (const line of input.lines) {
        const item = await findItem(tx, scope, line.stockItemId);
        if (item && !item.archivedAt) items.set(item.id, item);
      }
      const waste = unwrap(prepareWaste({ ...input, reason }, (id) => items.get(id)?.unit ?? null));
      return waste.lines.map((line) => ({
        ...scope,
        ...BY_HAND,
        stockItemId: line.stockItemId,
        kind: 'wasted' as const,
        quantity: line.quantity,
        unitCost: null,
        wasteRefId: input.of?.refId ?? null,
        wasteRefLabel: ofLabel,
        reason: waste.reason,
        note: waste.note,
        supplier: null,
        reference: null,
        clientId: input.clientId,
        createdById: actorId,
      }));
    });
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /**
   * Writes the moves `plan` returns in one transaction, then announces them.
   * A clash on the client id is the same press arriving twice: the moves the
   * first one wrote are returned instead.
   */
  private async record(
    scope: InScope,
    actorId: string,
    clientId: string,
    plan: (tx: StockTransaction) => Promise<StockMoveFields[]>,
  ): Promise<StockMoveView[]> {
    if (!clientId || clientId.length > 100) throw refusalError('invalid_text');
    try {
      await this.prisma.$transaction(async (tx) => {
        const data = await plan(tx);
        await tx.stockMove.createMany({ data });
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
    const rows = await this.byClient(scope, clientId);
    if (rows.length === 0) throw refusalError('not_found');
    await this.events.changed(scope, 'stock', actorId);
    const names = await this.directory.names(rows.map((row) => row.createdById));
    return rows.map((row) => renderMove(row, names));
  }

  private async byClient(scope: InScope, clientId: string): Promise<StockMoveRow[]> {
    return this.prisma.stockMove.findMany({
      where: { ...scope, clientId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: STOCK_READ_MAX,
    });
  }

  private single(moves: readonly StockMoveView[]): StockMoveView {
    const move = moves[0];
    if (!move) throw refusalError('not_found');
    return move;
  }

  /** An item that can be moved by hand: in this store, and not archived. */
  private async liveItem(tx: StockTransaction, scope: InScope, id: string): Promise<StockItemRow> {
    const item = await findItem(tx, scope, id);
    if (!item) throw refusalError('not_found');
    if (item.archivedAt) throw refusalError('archived');
    return item;
  }
}
