import { Inject, Injectable, Logger } from '@nestjs/common';
import { planRefundReturn, planVoidReturn, type StockTaken } from '../domain/returns.js';
import { posLineKey, posRefundKey, posVoidKey } from '../domain/sources.js';
import { canStillMake, planLineTakes } from '../domain/uses.js';
import type { StockDelta, StockUseLine } from '../types.js';
import type { StockSourceEvent } from './ports.js';
import { StockEventPublisher } from './stock.events.js';
import { readOnHand, STOCK_READ_MAX } from './stock.lookup.js';
import type { InScope, StockMoveFields, StockTransaction, StockWriteClient } from './stock.repository.js';
import { STOCK_PRISMA_WRITE } from './stock.tokens.js';

/** What `apply` did, in counts: for the catch-up's run result, never names. */
export interface StockIntakeResult {
  /** Events that wrote movements. */
  recorded: number;
  /** Events already recorded, or that took nothing (an untracked product). */
  skipped: number;
}

/** How many of a product or variant the shelf can still make. Null: nothing it uses is tracked. */
export interface StockLevelAnswer {
  itemId: string;
  variantId: string | null;
  left: number | null;
}

/**
 * Stock taken and returned by ANOTHER MODULE's events — the point of sale's
 * finalised, voided and refunded lines (INVENTORY-PLAN §5) — and the counts the
 * till shows.
 *
 * Two paths deliver the same events: the POS's push after its commit, and the
 * catch-up process reading the POS's feed. Both call `apply`.
 *
 * ⚠ AN EVENT TAKES STOCK ONCE. Its movements carry the event's key
 * (`posLineKey`…), unique per stock item, and an event whose key is already
 * written is skipped WHOLE — so a list edited between two deliveries cannot add
 * a line the first delivery did not take.
 *
 * ⚠ IT NEVER REFUSES A SALE. The sale is already saved at the POS. On hand may go
 * below zero and shows as `negative` (I5).
 */
@Injectable()
export class StockIntakeService {
  private readonly logger = new Logger('StockIntake');

  constructor(
    @Inject(STOCK_PRISMA_WRITE) private readonly prisma: StockWriteClient,
    private readonly events: StockEventPublisher,
  ) {}

  /**
   * Records `events` in order, one transaction each: a later event (a void)
   * reads what an earlier one (the sale) wrote. Never throws for one bad event:
   * it is logged and counted, and the catch-up tries it again.
   */
  async apply(scope: InScope, events: readonly StockSourceEvent[]): Promise<StockIntakeResult> {
    const result: StockIntakeResult = { recorded: 0, skipped: 0 };
    // Sequential: a void must see the sale it reverses.
    for (const event of events) {
      try {
        const wrote = await this.prisma.$transaction((tx) => this.one(tx, scope, event));
        if (wrote) result.recorded += 1;
        else result.skipped += 1;
      } catch (error) {
        result.skipped += 1;
        this.logger.error(`A point-of-sale ${event.kind} event could not be recorded: ${(error as Error).message}`);
      }
    }
    if (result.recorded > 0) await this.events.changed(scope, 'stock', null);
    return result;
  }

  /**
   * How many of each product the shelf can still make, for the till's "3 left".
   * A product nothing uses answers null, and the till shows no count at all.
   */
  async levelsFor(
    scope: InScope,
    refs: readonly { itemId: string; variantId: string | null }[],
  ): Promise<StockLevelAnswer[]> {
    if (refs.length === 0) return [];
    const uses = await this.usesOf(
      this.prisma,
      scope,
      refs.map((ref) => ref.itemId),
    );
    if (uses.length === 0) return refs.map((ref) => ({ ...ref, left: null }));
    const onHand = await readOnHand(this.prisma, scope, [...new Set(uses.map((use) => use.stockItemId))]);
    return refs.map((ref) => ({ ...ref, left: canStillMake(uses, ref, onHand) }));
  }

  // ── one event ─────────────────────────────────────────────────────────────

  /** Writes one event's movements. False when it was already recorded or takes nothing. */
  private async one(tx: StockTransaction, scope: InScope, event: StockSourceEvent): Promise<boolean> {
    switch (event.kind) {
      case 'finalised': {
        const key = posLineKey(event.lineId);
        if (await this.seen(tx, scope, key)) return false;
        const uses = await this.usesOf(tx, scope, [event.itemId]);
        const takes = planLineTakes(uses, event);
        return this.write(tx, scope, takes, { kind: 'used', key, lineId: event.lineId });
      }
      case 'voided': {
        const key = posVoidKey(event.lineId);
        if (await this.seen(tx, scope, key)) return false;
        return this.write(tx, scope, planVoidReturn(await this.taken(tx, scope, event.lineId)), {
          kind: 'returned',
          key,
          lineId: event.lineId,
        });
      }
      case 'returned': {
        const key = posRefundKey(event.refundLineId);
        if (await this.seen(tx, scope, key)) return false;
        const taken = await this.taken(tx, scope, event.lineId);
        return this.write(tx, scope, planRefundReturn(taken, event.lineQuantity, event.quantity), {
          kind: 'returned',
          key,
          lineId: event.lineId,
        });
      }
    }
  }

  private async seen(tx: StockTransaction, scope: InScope, sourceKey: string): Promise<boolean> {
    return (await tx.stockMove.findFirst({ where: { ...scope, sourceKey } })) !== null;
  }

  /**
   * ⚠ `skipDuplicates`: a delivery racing this one for the same key writes the
   * same rows, and the unique key keeps one of each.
   */
  private async write(
    tx: StockTransaction,
    scope: InScope,
    deltas: readonly StockDelta[],
    source: { kind: 'used' | 'returned'; key: string; lineId: string },
  ): Promise<boolean> {
    if (deltas.length === 0) return false;
    const data: StockMoveFields[] = deltas.map((delta) => ({
      ...scope,
      stockItemId: delta.stockItemId,
      kind: source.kind,
      quantity: delta.quantity,
      unitCost: null,
      sourceKey: source.key,
      sourceLineId: source.lineId,
      takeId: null,
      wasteRefId: null,
      wasteRefLabel: null,
      reason: null,
      note: null,
      supplier: null,
      reference: null,
      clientId: null,
      createdById: null,
    }));
    const { count } = await tx.stockMove.createMany({ data, skipDuplicates: true });
    return count > 0;
  }

  /** What one POS line took and has had back, per stock item, with each item's kind. */
  private async taken(tx: StockTransaction, scope: InScope, lineId: string): Promise<StockTaken[]> {
    const moves = await tx.stockMove.findMany({
      where: { ...scope, sourceLineId: lineId, kind: { in: ['used', 'returned'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: STOCK_READ_MAX,
    });
    if (moves.length === 0) return [];
    const items = await tx.stockItem.findMany({
      where: { ...scope, id: { in: [...new Set(moves.map((move) => move.stockItemId))] } },
      orderBy: [{ id: 'asc' }],
      take: STOCK_READ_MAX,
    });
    const kindOf = new Map(items.map((item) => [item.id, item.kind]));
    const byItem = new Map<string, StockTaken>();
    for (const move of moves) {
      const kind = kindOf.get(move.stockItemId);
      if (!kind) continue;
      const entry = byItem.get(move.stockItemId) ?? { stockItemId: move.stockItemId, kind, taken: 0, returned: 0 };
      if (move.kind === 'used') entry.taken += -move.quantity;
      else entry.returned += move.quantity;
      byItem.set(move.stockItemId, entry);
    }
    return [...byItem.values()];
  }

  /** Every list line of these POS items: the items' own lists and all their variants'. */
  private async usesOf(
    tx: Pick<StockTransaction, 'stockUse'>,
    scope: InScope,
    itemIds: readonly string[],
  ): Promise<StockUseLine[]> {
    const rows = await tx.stockUse.findMany({
      where: { ...scope, source: 'pos', refItemId: { in: [...new Set(itemIds)] } },
      orderBy: [{ id: 'asc' }],
      take: STOCK_READ_MAX * 10,
    });
    return rows.map((row) => ({
      refKind: row.refKind,
      refId: row.refId,
      stockItemId: row.stockItemId,
      quantityPerUnit: row.quantityPerUnit,
    }));
  }
}
