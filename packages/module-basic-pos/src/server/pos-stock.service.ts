import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { PosItemKind } from '../types.js';
import type { PosStockEvent, PosStockEvents, PosStockLevel, PosStockLevels } from './ports.js';
import type { InScope, PosOrderLineRow, PosOrderRow, PosWriteClient } from './pos.repository.js';
import { POS_PRISMA_WRITE, POS_STOCK_EVENTS, POS_STOCK_LEVELS } from './pos.tokens.js';

/** The most items and variants read at once: the `pos:items` cap's default. */
const CATALOGUE_MAX = 1000;

/** One item or variant the store sells, as the stock app needs it to hang a materials list on it. */
export interface PosStockCatalogueEntry {
  itemId: string;
  variantId: string | null;
  itemName: string;
  variantName: string | null;
  kind: PosItemKind;
  code: string | null;
  archived: boolean;
}

/**
 * The point of sale's side of stock (INVENTORY-PLAN §5, §6): telling the stock
 * app what left the store or came back, the feed its catch-up reads, the
 * catalogue its lists hang on, and the till's counts.
 *
 * ⚠ STOCK NEVER STOPS A SALE. Every call out is AFTER the commit and swallowed
 * on failure: the order is paid whatever the stock app says, and the catch-up
 * reads the same events from `eventsSince` later. The till's counts are a
 * warning, never a refusal (I5).
 */
@Injectable()
export class PosStockService {
  private readonly logger = new Logger('PosStock');

  constructor(
    @Inject(POS_PRISMA_WRITE) private readonly prisma: PosWriteClient,
    @Optional() @Inject(POS_STOCK_EVENTS) private readonly stock?: PosStockEvents,
    @Optional() @Inject(POS_STOCK_LEVELS) private readonly levels?: PosStockLevels,
  ) {}

  /** Whether the store counts stock at all: the till hides every count when not. */
  get counts(): boolean {
    return this.levels !== undefined;
  }

  // ── after a commit ────────────────────────────────────────────────────────

  /** An order was just finalised (paid from open, or released unpaid): every line left the store. */
  async finalised(scope: InScope, order: PosOrderRow): Promise<void> {
    if (!this.stock || !order.finalisedAt) return;
    const at = order.finalisedAt.toISOString();
    const lines = await this.linesOf(order.id);
    await this.tell(
      scope,
      lines.map((line) => finalisedEvent(line, at)),
    );
  }

  /** An unpaid order was just voided: its goods came back whole. */
  async voided(scope: InScope, order: PosOrderRow): Promise<void> {
    if (!this.stock || !order.voidedAt) return;
    const at = order.voidedAt.toISOString();
    const lines = await this.linesOf(order.id);
    await this.tell(
      scope,
      lines.map((line) => ({ kind: 'voided' as const, lineId: line.id, at })),
    );
  }

  /** A refund was just recorded: its lines marked "put back in stock" came back sellable. */
  async returned(scope: InScope, refundId: string, orderId: string, refundedAt: Date): Promise<void> {
    if (!this.stock) return;
    const [refundLines, orderLines] = await Promise.all([
      this.prisma.posRefundLine.findMany({ where: { refundId: { in: [refundId] }, restock: true } }),
      this.linesOf(orderId),
    ]);
    const quantityOf = new Map(orderLines.map((line) => [line.id, line.quantity]));
    const at = refundedAt.toISOString();
    await this.tell(
      scope,
      refundLines.map((line) => ({
        kind: 'returned' as const,
        refundLineId: line.id,
        lineId: line.orderLineId,
        lineQuantity: quantityOf.get(line.orderLineId) ?? line.quantity,
        quantity: line.quantity,
        at,
      })),
    );
  }

  // ── what the stock app reads ──────────────────────────────────────────────

  /**
   * Every event AT OR AFTER `since`, oldest first, at most `limit` — the same
   * events the push sends, for the stock app's catch-up to replay. Read back
   * from the orders and refunds themselves, so nothing extra is stored to be
   * caught up on.
   */
  async eventsSince(scope: InScope, since: Date, limit: number): Promise<PosStockEvent[]> {
    const [finalised, voided, refunds] = await Promise.all([
      this.prisma.posOrder.findMany({
        where: { ...scope, finalisedAt: { gte: since } },
        orderBy: [{ finalisedAt: 'asc' }, { id: 'asc' }],
        take: limit,
      }),
      this.prisma.posOrder.findMany({
        where: { ...scope, voidedAt: { gte: since } },
        orderBy: [{ voidedAt: 'asc' }, { id: 'asc' }],
        take: limit,
      }),
      this.prisma.posRefund.findMany({
        where: { ...scope, refundedAt: { gte: since } },
        orderBy: [{ refundedAt: 'asc' }, { id: 'asc' }],
        take: limit,
      }),
    ]);
    const orderIds = [
      ...new Set([...finalised, ...voided, ...refunds].map((row) => ('orderId' in row ? row.orderId : row.id))),
    ];
    const [lines, refundLines] = await Promise.all([
      orderIds.length
        ? this.prisma.posOrderLine.findMany({
            where: { orderId: { in: orderIds } },
            orderBy: [{ orderId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
          })
        : Promise.resolve([] as PosOrderLineRow[]),
      refunds.length
        ? this.prisma.posRefundLine.findMany({
            where: { refundId: { in: refunds.map((row) => row.id) }, restock: true },
          })
        : Promise.resolve([]),
    ]);
    const linesOf = new Map<string, PosOrderLineRow[]>();
    for (const line of lines) linesOf.set(line.orderId, [...(linesOf.get(line.orderId) ?? []), line]);
    const quantityOf = new Map(lines.map((line) => [line.id, line.quantity]));
    const refundedAt = new Map(refunds.map((row) => [row.id, row.refundedAt]));

    const events: PosStockEvent[] = [];
    for (const order of finalised) {
      if (!order.finalisedAt) continue;
      const at = order.finalisedAt.toISOString();
      for (const line of linesOf.get(order.id) ?? []) events.push(finalisedEvent(line, at));
    }
    for (const order of voided) {
      if (!order.voidedAt) continue;
      const at = order.voidedAt.toISOString();
      for (const line of linesOf.get(order.id) ?? []) events.push({ kind: 'voided', lineId: line.id, at });
    }
    for (const line of refundLines) {
      const at = refundedAt.get(line.refundId);
      if (!at) continue;
      events.push({
        kind: 'returned',
        refundLineId: line.id,
        lineId: line.orderLineId,
        lineQuantity: quantityOf.get(line.orderLineId) ?? line.quantity,
        quantity: line.quantity,
        at: at.toISOString(),
      });
    }
    // ⚠ A sale before its void or refund at the same instant: the stock app must see what was taken before it returns it.
    return events.sort((a, b) => a.at.localeCompare(b.at) || EVENT_ORDER[a.kind] - EVENT_ORDER[b.kind]).slice(0, limit);
  }

  /** Every item and variant, archived ones too: a materials list on an archived product still reads. */
  async catalogue(scope: InScope, limit: number = CATALOGUE_MAX): Promise<PosStockCatalogueEntry[]> {
    const items = await this.prisma.posItem.findMany({
      where: { ...scope },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    if (items.length === 0) return [];
    const variants = await this.prisma.posItemVariant.findMany({
      where: { ...scope, itemId: { in: items.map((item) => item.id) } },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    const entries: PosStockCatalogueEntry[] = [];
    for (const item of items) {
      const base = { itemId: item.id, itemName: item.name, kind: item.kind };
      entries.push({
        ...base,
        variantId: null,
        variantName: null,
        code: item.code,
        archived: item.archivedAt !== null,
      });
      for (const variant of variants.filter((one) => one.itemId === item.id)) {
        entries.push({
          ...base,
          variantId: variant.id,
          variantName: variant.name,
          code: variant.code,
          archived: item.archivedAt !== null || variant.archivedAt !== null,
        });
      }
    }
    return entries.slice(0, limit);
  }

  /**
   * How many of each live item and variant are left, for the till. Empty when
   * the store counts no stock, or when the stock app cannot answer: a till
   * without counts still sells.
   */
  async tillLevels(scope: InScope): Promise<PosStockLevel[]> {
    if (!this.levels) return [];
    const refs = (await this.catalogue(scope))
      .filter((entry) => !entry.archived)
      .map((entry) => ({ itemId: entry.itemId, variantId: entry.variantId }));
    if (refs.length === 0) return [];
    try {
      return [...(await this.levels.levelsFor(scope.organizationId, scope.workspaceId, refs))];
    } catch (error) {
      this.logger.warn(`Stock counts could not be read for the till: ${(error as Error).message}`);
      return [];
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async linesOf(orderId: string): Promise<PosOrderLineRow[]> {
    return this.prisma.posOrderLine.findMany({ where: { orderId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
  }

  /** ⚠ Never throws: the sale is already saved, and the catch-up will deliver these again. */
  private async tell(scope: InScope, events: readonly PosStockEvent[]): Promise<void> {
    if (!this.stock || events.length === 0) return;
    try {
      await this.stock.record(scope.organizationId, scope.workspaceId, events);
    } catch (error) {
      this.logger.error(
        `Stock was not told of ${events.length} line(s); its catch-up will take them: ${(error as Error).message}`,
      );
    }
  }
}

/** Ties at one instant: what was taken comes before what came back. */
const EVENT_ORDER: Record<PosStockEvent['kind'], number> = { finalised: 0, voided: 1, returned: 2 };

function finalisedEvent(line: PosOrderLineRow, at: string): PosStockEvent {
  return {
    kind: 'finalised',
    lineId: line.id,
    itemId: line.itemId,
    variantId: line.variantId,
    quantity: line.quantity,
    at,
  };
}
