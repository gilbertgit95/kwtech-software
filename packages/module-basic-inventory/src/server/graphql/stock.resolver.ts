import { declareScope, REQUIRED_SCOPE_METADATA, withCatchUp } from '@kwtech/module-kit';
import { Inject, Optional, SetMetadata } from '@nestjs/common';
import { Args, Context, Int, Mutation, Query, Resolver, Subscription } from '@nestjs/graphql';
import { refusalError, StockWriteError } from '../stock.errors.js';
import type { StockModuleOptions } from '../stock.options.js';
import { isStockEventFor, NULL_STOCK_PUBSUB, STOCK_EVENT, type StockEvent, type StockPubSub } from '../stock.pubsub.js';
import { STOCK_OPTIONS, STOCK_PUBSUB } from '../stock.tokens.js';
import { StockCatalogueService } from '../stock-catalogue.service.js';
import { StockMoveService } from '../stock-move.service.js';
import { StockTakeService } from '../stock-take.service.js';
import {
  AdjustStockInputType,
  ReceiveStockInputType,
  RecordStockWasteInputType,
  SaveStockItemInputType,
  StockCategoryType,
  StockEventType,
  StockItemType,
  StockMovesType,
  StockMoveType,
  StockOverviewType,
  StockSourceItemType,
  StockSourcePickInputType,
  StockTakeCountInputType,
  StockTakeType,
  StockUseLineInputType,
  StockUseType,
} from './stock.types.js';

/**
 * Everything the stock app reads and writes, and its live events.
 *
 * ## ⚠ THE SCOPE IS DECLARED ON THE CLASS, and nothing here works without it
 *
 * Every `stock:*` key is WORKSPACE level. A resolver has no path, so without a
 * declaration `FeatureGuard` resolves app level — where no workspace key
 * participates — and every key grants nothing to everybody, silently (§12.13).
 * `surface-coverage.test.ts` fails if it goes. Every operation therefore takes
 * `organizationId` and `workspaceId`.
 *
 * ## Where the guard is, since there is no decorator here
 *
 * Every operation is guarded by its BINDING in `STOCK_FEATURE_REGISTRY`. The
 * services then find every row BY ID AND SCOPE. Kinds, units and reasons arrive
 * as strings, and the services narrow them (`domain/guards.ts`) before anything
 * reads them: a union that is only a type is no check at all.
 */
@SetMetadata(REQUIRED_SCOPE_METADATA, declareScope('workspace'))
@Resolver()
export class StockResolver {
  constructor(
    private readonly catalogue: StockCatalogueService,
    private readonly moves: StockMoveService,
    private readonly takes: StockTakeService,
    @Inject(STOCK_OPTIONS) private readonly options: StockModuleOptions,
    /** Absent means not live: `stockEvents` sends `sync` and ends. */
    @Optional() @Inject(STOCK_PUBSUB) private readonly pubsub?: StockPubSub,
  ) {}

  // ── reading ───────────────────────────────────────────────────────────────

  @Query(() => StockOverviewType, { name: 'stockItems' })
  async stockItems(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('includeArchived', { type: () => Boolean, nullable: true }) includeArchived?: boolean | null,
  ): Promise<StockOverviewType> {
    return this.catalogue.overview({ organizationId, workspaceId }, { includeArchived: includeArchived ?? false });
  }

  @Query(() => StockItemType, { name: 'stockItem' })
  async stockItem(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('stockItemId') stockItemId: string,
  ): Promise<StockItemType> {
    return this.catalogue.item({ organizationId, workspaceId }, stockItemId);
  }

  @Query(() => StockMovesType, { name: 'stockMoves' })
  async stockMoves(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('stockItemId') stockItemId: string,
    @Args('cursor', { type: () => String, nullable: true }) cursor?: string | null,
  ): Promise<StockMovesType> {
    return this.moves.moves({ organizationId, workspaceId }, stockItemId, cursor ?? null);
  }

  @Query(() => [StockSourceItemType], { name: 'stockSourceItems' })
  async stockSourceItems(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<StockSourceItemType[]> {
    return this.catalogue.sourceItems({ organizationId, workspaceId });
  }

  @Query(() => [StockTakeType], { name: 'stockTakes' })
  async stockTakes(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<StockTakeType[]> {
    return this.takes.list({ organizationId, workspaceId });
  }

  @Query(() => StockTakeType, { name: 'stockTake' })
  async stockTake(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('takeId') takeId: string,
  ): Promise<StockTakeType> {
    return this.takes.take({ organizationId, workspaceId }, takeId);
  }

  // ── receiving, adjusting, waste (`stock:receive`) ─────────────────────────

  @Mutation(() => StockMoveType, { name: 'receiveStock' })
  async receiveStock(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('input', { type: () => ReceiveStockInputType }) input: ReceiveStockInputType,
  ): Promise<StockMoveType> {
    return this.moves.receive({ organizationId, workspaceId }, this.actor(gql.req), { ...input });
  }

  @Mutation(() => StockMoveType, { name: 'adjustStock' })
  async adjustStock(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('input', { type: () => AdjustStockInputType }) input: AdjustStockInputType,
  ): Promise<StockMoveType> {
    return this.moves.adjust({ organizationId, workspaceId }, this.actor(gql.req), { ...input });
  }

  @Mutation(() => [StockMoveType], { name: 'recordStockWaste' })
  async recordStockWaste(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('input', { type: () => RecordStockWasteInputType }) input: RecordStockWasteInputType,
  ): Promise<StockMoveType[]> {
    const of = input.ofRefId ? { refId: input.ofRefId, refLabel: input.ofRefLabel ?? '' } : null;
    return this.moves.waste({ organizationId, workspaceId }, this.actor(gql.req), {
      lines: input.lines.map((line) => ({ stockItemId: line.stockItemId, quantity: line.quantity })),
      reason: input.reason,
      note: input.note ?? null,
      of,
      clientId: input.clientId,
    });
  }

  // ── items, categories, lists (`stock:manage`) ─────────────────────────────

  @Mutation(() => StockItemType, { name: 'saveStockItem' })
  async saveStockItem(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('input', { type: () => SaveStockItemInputType }) input: SaveStockItemInputType,
  ): Promise<StockItemType> {
    return this.catalogue.saveItem({ organizationId, workspaceId }, this.actor(gql.req), { ...input });
  }

  @Mutation(() => StockItemType, { name: 'setStockItemArchived' })
  async setStockItemArchived(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('stockItemId') stockItemId: string,
    @Args('archived') archived: boolean,
  ): Promise<StockItemType> {
    return this.catalogue.setItemArchived({ organizationId, workspaceId }, this.actor(gql.req), stockItemId, archived);
  }

  @Mutation(() => StockCategoryType, { name: 'saveStockCategory' })
  async saveStockCategory(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('name') name: string,
    @Args('categoryId', { type: () => String, nullable: true }) categoryId?: string | null,
    @Args('sortOrder', { type: () => Int, nullable: true }) sortOrder?: number | null,
  ): Promise<StockCategoryType> {
    return this.catalogue.saveCategory({ organizationId, workspaceId }, this.actor(gql.req), {
      id: categoryId ?? null,
      name,
      sortOrder: sortOrder ?? null,
    });
  }

  @Mutation(() => StockCategoryType, { name: 'setStockCategoryArchived' })
  async setStockCategoryArchived(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('categoryId') categoryId: string,
    @Args('archived') archived: boolean,
  ): Promise<StockCategoryType> {
    return this.catalogue.setCategoryArchived(
      { organizationId, workspaceId },
      this.actor(gql.req),
      categoryId,
      archived,
    );
  }

  /** Replaces one product's list: the POS item's (`refKind: item`) or one variant's. */
  @Mutation(() => [StockUseType], { name: 'setStockUses' })
  async setStockUses(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('refKind') refKind: string,
    @Args('refId') refId: string,
    @Args('refItemId') refItemId: string,
    @Args('lines', { type: () => [StockUseLineInputType] }) lines: StockUseLineInputType[],
  ): Promise<StockUseType[]> {
    if (refKind !== 'item' && refKind !== 'variant') throw refusalError('not_found');
    return this.catalogue.setUses(
      { organizationId, workspaceId },
      this.actor(gql.req),
      { refKind, refId, refItemId },
      lines.map((line) => ({ stockItemId: line.stockItemId, quantityPerUnit: line.quantityPerUnit })),
    );
  }

  @Mutation(() => StockOverviewType, { name: 'createStockFromSource' })
  async createStockFromSource(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('picks', { type: () => [StockSourcePickInputType] }) picks: StockSourcePickInputType[],
  ): Promise<StockOverviewType> {
    return this.catalogue.createFromSource(
      { organizationId, workspaceId },
      this.actor(gql.req),
      picks.map((pick) => ({ itemId: pick.itemId, variantId: pick.variantId ?? null })),
    );
  }

  // ── stock takes (`stock:manage`) ──────────────────────────────────────────

  @Mutation(() => StockTakeType, { name: 'startStockTake' })
  async startStockTake(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('categoryIds', { type: () => [String] }) categoryIds: string[],
    @Args('note', { type: () => String, nullable: true }) note?: string | null,
  ): Promise<StockTakeType> {
    return this.takes.start({ organizationId, workspaceId }, this.actor(gql.req), { categoryIds, note: note ?? null });
  }

  @Mutation(() => StockTakeType, { name: 'saveStockTakeCounts' })
  async saveStockTakeCounts(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('takeId') takeId: string,
    @Args('counts', { type: () => [StockTakeCountInputType] }) counts: StockTakeCountInputType[],
  ): Promise<StockTakeType> {
    return this.takes.saveCounts(
      { organizationId, workspaceId },
      this.actor(gql.req),
      takeId,
      counts.map((count) => ({ stockItemId: count.stockItemId, counted: count.counted ?? null })),
    );
  }

  @Mutation(() => StockTakeType, { name: 'confirmStockTake' })
  async confirmStockTake(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('takeId') takeId: string,
  ): Promise<StockTakeType> {
    return this.takes.confirm({ organizationId, workspaceId }, this.actor(gql.req), takeId);
  }

  @Mutation(() => StockTakeType, { name: 'abandonStockTake' })
  async abandonStockTake(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('takeId') takeId: string,
  ): Promise<StockTakeType> {
    return this.takes.abandon({ organizationId, workspaceId }, this.actor(gql.req), takeId);
  }

  // ── live ──────────────────────────────────────────────────────────────────

  /**
   * Changes in this store's stock. ⚠ NO CONTENT — the screen reads again
   * through the guarded queries. `sync` first, on every (re)subscribe: the
   * engine has no replay.
   */
  @Subscription(() => StockEventType, {
    name: 'stockEvents',
    // ⚠ REQUIRED: without it GraphQL looks for a `stockEvents` key on the
    // payload, finds none, and delivers `data: null` forever.
    resolve: (payload: StockEventType) => payload,
  })
  stockEvents(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): AsyncIterableIterator<StockEventType> {
    this.actor(gql.req);
    const viewer = { organizationId, workspaceId };
    return withCatchUp<StockEvent, StockEventType>({
      live: (this.pubsub ?? NULL_STOCK_PUBSUB).asyncIterableIterator<StockEvent>(STOCK_EVENT.changed),
      catchUp: async () => [{ kind: 'sync', actorId: null }],
      transform: (event) => {
        if (!isStockEventFor(event, viewer)) return null;
        return { kind: event.change, actorId: event.actorId };
      },
      keyOf: () => null,
    });
  }

  private actor(request: unknown): string {
    const actorId = this.options.resolveActorId?.(request);
    if (!actorId) throw new StockWriteError('not_permitted', 'Not signed in');
    return actorId;
  }
}
