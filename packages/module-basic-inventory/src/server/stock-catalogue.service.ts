import type { LimitChecker, LimitDecision } from '@kwtech/module-kit';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { isStockItemKind, isStockUnit } from '../domain/guards.js';
import { checkLowStockAt } from '../domain/levels.js';
import { checkStockCost } from '../domain/quantities.js';
import { prepareStockCode, prepareStockName } from '../domain/text.js';
import { checkUseList, oneToOneUse, type StockUseDraft } from '../domain/uses.js';
import { STOCK_LIMIT, STOCK_LIMIT_REGISTRY } from '../feature-keys.js';
import type { StockUseRefKind } from '../types.js';
import type { StockItemView, StockOverviewView, StockSourceItemView, StockUseView } from '../views.js';
import type { StockSourceCatalogue, StockSourceItem } from './ports.js';
import { refusalError, StockWriteError, unwrap } from './stock.errors.js';
import { StockEventPublisher } from './stock.events.js';
import { findItem, isUniqueViolation, readOnHand, STOCK_READ_MAX } from './stock.lookup.js';
import type { InScope, StockTransaction, StockUseRow, StockWriteClient } from './stock.repository.js';
import { STOCK_LIMIT_CHECKER, STOCK_PRISMA_WRITE, STOCK_SOURCE_CATALOGUE } from './stock.tokens.js';
import { renderCategory, renderItem, renderSourceItem, renderUse, sourceLabel } from './stock.views.js';

/** What a stock item's form sends. `id` absent: a new item. */
export interface StockItemInput {
  id?: string | null | undefined;
  /** A `StockItemKind`, as the wire sends it; narrowed here. */
  kind: string;
  name: string;
  code?: string | null | undefined;
  /** A `StockUnit`, as the wire sends it; narrowed here. */
  unit: string;
  unitCost?: number | null | undefined;
  lowStockAt?: number | null | undefined;
  categoryId?: string | null | undefined;
}

/** One product a list hangs on: the POS item, or one of its variants. */
export interface StockUseTarget {
  refKind: StockUseRefKind;
  /** The item's id for `item`, the variant's for `variant`. */
  refId: string;
  /** The item's id, for both kinds. */
  refItemId: string;
}

/** The most POS items (with variants) the picker reads: the POS's own cap. */
const SOURCE_ITEMS_MAX = 1000;

/** The most lines one product's list may have: no real product is made of more. */
const USE_LINES_MAX = 30;

/**
 * Stock items, categories and materials lists — what is counted, and how a
 * sale takes it (INVENTORY-PLAN §2).
 */
@Injectable()
export class StockCatalogueService {
  private readonly logger = new Logger('StockCatalogue');

  constructor(
    @Inject(STOCK_PRISMA_WRITE) private readonly prisma: StockWriteClient,
    private readonly events: StockEventPublisher,
    @Optional() @Inject(STOCK_LIMIT_CHECKER) private readonly limits?: LimitChecker,
    @Optional() @Inject(STOCK_SOURCE_CATALOGUE) private readonly source?: StockSourceCatalogue,
  ) {}

  // ── reading ───────────────────────────────────────────────────────────────

  /** Every item with on hand and value, the categories, and every list line. */
  async overview(scope: InScope, options: { includeArchived?: boolean } = {}): Promise<StockOverviewView> {
    const [items, categories, uses] = await Promise.all([
      this.prisma.stockItem.findMany({
        where: options.includeArchived ? { ...scope } : { ...scope, archivedAt: null },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: STOCK_READ_MAX,
      }),
      this.prisma.stockCategory.findMany({
        where: { ...scope },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        take: STOCK_READ_MAX,
      }),
      this.allUses(this.prisma, scope),
    ]);
    const onHand = await readOnHand(
      this.prisma,
      scope,
      items.map((item) => item.id),
    );
    const usedBy = countUses(uses);
    const views = items.map((item) => renderItem(item, onHand.get(item.id) ?? 0, usedBy.get(item.id) ?? 0));
    let totalValue = 0;
    let unvalued = 0;
    for (const view of views) {
      if (view.archivedAt) continue;
      if (view.value === null) unvalued += 1;
      else totalValue += view.value;
    }
    return {
      items: views,
      categories: categories.map(renderCategory),
      uses: uses.map(renderUse),
      totalValue,
      unvalued,
      hasSource: this.source !== undefined,
    };
  }

  /** One item, archived or not, with on hand. */
  async item(scope: InScope, id: string): Promise<StockItemView> {
    const row = await findItem(this.prisma, scope, id);
    if (!row) throw refusalError('not_found');
    const [onHand, usedBy] = await Promise.all([
      readOnHand(this.prisma, scope, [id]),
      this.prisma.stockUse.count({ where: { ...scope, stockItemId: id } }),
    ]);
    return renderItem(row, onHand.get(id) ?? 0, usedBy);
  }

  /** The POS's items and variants, to pick what a list hangs on. Empty, never an error, when there is no POS. */
  async sourceItems(scope: InScope): Promise<StockSourceItemView[]> {
    return (await this.readSource(scope)).map(renderSourceItem);
  }

  // ── stock items and categories ────────────────────────────────────────────

  async saveItem(scope: InScope, actorId: string, input: StockItemInput): Promise<StockItemView> {
    const { kind, unit } = input;
    if (!isStockItemKind(kind) || !isStockUnit(unit)) throw refusalError('invalid_kind');
    const { name } = unwrap(prepareStockName(input.name));
    const { code } = unwrap(prepareStockCode(input.code ?? ''));
    const unitCost = input.unitCost ?? null;
    const lowStockAt = input.lowStockAt ?? null;
    const costRefused = checkStockCost(unitCost);
    if (costRefused) throw refusalError(costRefused);
    const lowRefused = checkLowStockAt(lowStockAt);
    if (lowRefused) throw refusalError(lowRefused);
    const categoryId = input.categoryId ?? null;

    let id = input.id ?? null;
    try {
      await this.prisma.$transaction(async (tx) => {
        if (categoryId) await this.checkCategory(tx, scope, categoryId);
        const fields = { categoryId, kind, name, code, unit, unitCost, lowStockAt };
        if (!id) {
          await this.checkRoom(tx, scope, actorId, 1);
          const created = await tx.stockItem.create({
            data: { ...scope, ...fields, createdById: actorId, updatedById: actorId },
          });
          id = created.id;
          return;
        }
        const existing = await findItem(tx, scope, id);
        if (!existing) throw refusalError('not_found');
        /*
         * ⚠ THE UNIT IS FIXED ONCE STOCK HAS MOVED. Every movement is a number of
         * thousandths of the unit it was recorded in: turning "sheet" into
         * "pack" would make 500 sheets read as 500 packs.
         */
        if (existing.unit !== unit && (await tx.stockMove.count({ where: { ...scope, stockItemId: id } })) > 0) {
          throw refusalError('unit_in_use');
        }
        await tx.stockItem.updateMany({ where: { ...scope, id }, data: { ...fields, updatedById: actorId } });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw refusalError('code_taken');
      throw error;
    }
    await this.events.changed(scope, 'setup', actorId);
    return this.item(scope, id ?? '');
  }

  async setItemArchived(scope: InScope, actorId: string, id: string, archived: boolean): Promise<StockItemView> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await findItem(tx, scope, id);
      if (!existing) throw refusalError('not_found');
      if (!archived && existing.archivedAt) await this.checkRoom(tx, scope, actorId, 1);
      await tx.stockItem.updateMany({
        where: { ...scope, id },
        data: { archivedAt: archived ? (existing.archivedAt ?? new Date()) : null, updatedById: actorId },
      });
    });
    await this.events.changed(scope, 'setup', actorId);
    return this.item(scope, id);
  }

  async saveCategory(
    scope: InScope,
    actorId: string,
    input: { id?: string | null | undefined; name: string; sortOrder?: number | null | undefined },
  ) {
    const { name } = unwrap(prepareStockName(input.name));
    const sortOrder = input.sortOrder ?? 0;
    if (!Number.isSafeInteger(sortOrder)) throw refusalError('invalid_quantity');
    const row = await this.prisma.$transaction(async (tx) => {
      if (!input.id) return tx.stockCategory.create({ data: { ...scope, name, sortOrder } });
      const { count } = await tx.stockCategory.updateMany({
        where: { ...scope, id: input.id },
        data: { name, sortOrder },
      });
      if (count === 0) throw refusalError('not_found');
      return tx.stockCategory.findFirst({ where: { ...scope, id: input.id } });
    });
    if (!row) throw refusalError('not_found');
    await this.events.changed(scope, 'setup', actorId);
    return renderCategory(row);
  }

  /** Archiving a category keeps its items; they only stop being offered it. */
  async setCategoryArchived(scope: InScope, actorId: string, id: string, archived: boolean) {
    const { count } = await this.prisma.stockCategory.updateMany({
      where: { ...scope, id },
      data: { archivedAt: archived ? new Date() : null },
    });
    if (count === 0) throw refusalError('not_found');
    const row = await this.prisma.stockCategory.findFirst({ where: { ...scope, id } });
    if (!row) throw refusalError('not_found');
    await this.events.changed(scope, 'setup', actorId);
    return renderCategory(row);
  }

  // ── materials lists ───────────────────────────────────────────────────────

  /**
   * REPLACES one product's list (the item's, or one variant's) with `lines`.
   * An empty list takes the product off stock: its sales move nothing from now on.
   *
   * ⚠ ONLY LATER SALES READ IT. What a line already took was fixed when it was
   * recorded (INVENTORY-PLAN §3), so editing a list never rewrites history.
   *
   * The label is read from the POS when it is connected, so a list shows the
   * product's current name; with no POS there is no product to hang it on.
   */
  async setUses(
    scope: InScope,
    actorId: string,
    target: StockUseTarget,
    lines: readonly StockUseDraft[],
  ): Promise<StockUseView[]> {
    if (target.refKind === 'item' && target.refId !== target.refItemId) throw refusalError('not_found');
    if (lines.length > USE_LINES_MAX) throw refusalError('limit_reached');
    const refused = checkUseList(lines);
    if (refused) throw refusalError(refused);
    const product = await this.findProduct(scope, target);

    await this.prisma.$transaction(async (tx) => {
      for (const line of lines) {
        const item = await findItem(tx, scope, line.stockItemId);
        if (!item) throw refusalError('not_found');
        if (item.archivedAt) throw refusalError('archived');
      }
      await tx.stockUse.deleteMany({ where: { ...scope, source: 'pos', refId: target.refId } });
      if (lines.length === 0) return;
      await tx.stockUse.createMany({
        data: lines.map((line) => ({
          ...scope,
          source: 'pos' as const,
          refKind: target.refKind,
          refId: target.refId,
          refItemId: target.refItemId,
          refLabel: sourceLabel(product),
          stockItemId: line.stockItemId,
          quantityPerUnit: line.quantityPerUnit,
          createdById: actorId,
          updatedById: actorId,
        })),
      });
      await this.startFeed(tx, scope);
    });
    await this.events.changed(scope, 'setup', actorId);
    return (await this.allUses(this.prisma, scope)).filter((use) => use.refId === target.refId).map(renderUse);
  }

  /**
   * "Create from POS products" (I17): each picked product or variant becomes a
   * FOR-SALE stock item at quantity 0, linked one to one, ready for a first
   * count. A service is never offered (it is made, not shelved), and a product
   * something already uses is skipped rather than given a second item.
   */
  async createFromSource(
    scope: InScope,
    actorId: string,
    picks: readonly { itemId: string; variantId: string | null }[],
  ): Promise<StockOverviewView> {
    if (!this.source) throw refusalError('no_source');
    if (picks.length === 0) throw refusalError('no_change');
    const catalogue = await this.readSource(scope);
    const wanted = picks.map((pick) => {
      const found = catalogue.find((item) => item.itemId === pick.itemId && item.variantId === pick.variantId);
      if (found?.kind !== 'product' || found.archived) throw refusalError('not_found');
      return found;
    });

    await this.prisma.$transaction(async (tx) => {
      const used = new Set((await this.allUses(tx, scope)).map((use) => use.refId));
      const fresh = wanted.filter((item) => !used.has(item.variantId ?? item.itemId));
      if (fresh.length === 0) throw refusalError('no_change');
      await this.checkRoom(tx, scope, actorId, fresh.length);
      // Sequential: each item's id is needed for its list line, in this one transaction.
      for (const product of fresh) {
        const created = await tx.stockItem.create({
          data: {
            ...scope,
            categoryId: null,
            kind: 'for_sale',
            name: sourceLabel(product),
            code: null,
            unit: 'piece',
            unitCost: null,
            lowStockAt: null,
            createdById: actorId,
            updatedById: actorId,
          },
        });
        const refKind: StockUseRefKind = product.variantId ? 'variant' : 'item';
        const use = oneToOneUse(refKind, product.variantId ?? product.itemId, created.id);
        await tx.stockUse.createMany({
          data: [
            {
              ...scope,
              source: 'pos',
              ...use,
              refItemId: product.itemId,
              refLabel: sourceLabel(product),
              createdById: actorId,
              updatedById: actorId,
            },
          ],
        });
      }
      await this.startFeed(tx, scope);
    });
    await this.events.changed(scope, 'setup', actorId);
    return this.overview(scope);
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async allUses(tx: Pick<StockTransaction, 'stockUse'>, scope: InScope): Promise<StockUseRow[]> {
    return tx.stockUse.findMany({
      where: { ...scope, source: 'pos' },
      orderBy: [{ refLabel: 'asc' }, { refKind: 'asc' }, { id: 'asc' }],
      take: STOCK_READ_MAX * 10,
    });
  }

  private async readSource(scope: InScope): Promise<readonly StockSourceItem[]> {
    if (!this.source) return [];
    try {
      return await this.source.itemsOf(scope.organizationId, scope.workspaceId, SOURCE_ITEMS_MAX);
    } catch (error) {
      this.logger.warn(`The point of sale's items could not be read: ${(error as Error).message}`);
      throw new StockWriteError('no_source', 'The point of sale’s items could not be read just now — try again');
    }
  }

  /** The product a list hangs on, from the POS, or why not. */
  private async findProduct(scope: InScope, target: StockUseTarget): Promise<StockSourceItem> {
    if (!this.source) throw refusalError('no_source');
    const catalogue = await this.readSource(scope);
    const variantId = target.refKind === 'variant' ? target.refId : null;
    const found = catalogue.find((item) => item.itemId === target.refItemId && item.variantId === variantId);
    if (!found) throw refusalError('not_found');
    return found;
  }

  /**
   * The catch-up's cursor starts when the store first hangs a list on a
   * product: sales before then took nothing, so there is nothing to catch up.
   */
  private async startFeed(tx: StockTransaction, scope: InScope): Promise<void> {
    await tx.stockFeedCursor.createMany({
      data: [{ ...scope, source: 'pos', through: new Date() }],
      skipDuplicates: true,
    });
  }

  private async checkCategory(tx: StockTransaction, scope: InScope, id: string): Promise<void> {
    const category = await tx.stockCategory.findFirst({ where: { ...scope, id } });
    if (!category) throw refusalError('not_found');
    if (category.archivedAt) throw refusalError('category_archived');
  }

  private async checkRoom(tx: StockTransaction, scope: InScope, actorId: string, added: number): Promise<void> {
    const current = await tx.stockItem.count({ where: { ...scope, archivedAt: null } });
    // `allowed` means ONE more fits; the last of `added` must fit.
    const decision = await this.checkCap(scope, actorId, current + added - 1);
    if (!decision.allowed) {
      throw new StockWriteError(
        'limit_reached',
        `This store can count ${decision.limit} stock items — archive some first`,
        { limit: decision.limit },
      );
    }
  }

  private async checkCap(scope: InScope, actorId: string, current: number): Promise<LimitDecision> {
    if (this.limits) return this.limits.check({ actorId, key: STOCK_LIMIT.items, current, ...scope });
    const cap = STOCK_LIMIT_REGISTRY.find((spec) => spec.key === STOCK_LIMIT.items)?.defaultValue ?? 0;
    return { allowed: current < cap, limit: cap, current, remaining: Math.max(cap - current, 0) };
  }
}

/** How many list lines use each stock item. */
function countUses(uses: readonly Pick<StockUseRow, 'stockItemId'>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const use of uses) counts.set(use.stockItemId, (counts.get(use.stockItemId) ?? 0) + 1);
  return counts;
}
