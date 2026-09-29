import { declareScope, REQUIRED_SCOPE_METADATA, withCatchUp } from '@kwtech/module-kit';
import { Inject, Optional, SetMetadata } from '@nestjs/common';
import { Args, Context, Int, Mutation, Query, Resolver, Subscription } from '@nestjs/graphql';
import type { PosKeymap } from '../../domain/keymap.js';
import { PosWriteError } from '../pos.errors.js';
import type { PosModuleOptions } from '../pos.options.js';
import { isPosEventFor, NULL_POS_PUBSUB, POS_EVENT, type PosEvent, type PosPubSub } from '../pos.pubsub.js';
import type { PosCategoryRow, PosCustomerRow, PosItemVariantRow } from '../pos.repository.js';
import { POS_OPTIONS, POS_PUBSUB } from '../pos.tokens.js';
import { PosAccessService } from '../pos-access.service.js';
import { type PosCatalogueItem, PosCatalogueService } from '../pos-catalogue.service.js';
import { PosCustomerService } from '../pos-customer.service.js';
import { PosSettingsService, type PosStoreSettings } from '../pos-settings.service.js';
import {
  PosCatalogueType,
  PosCategoryType,
  PosCustomerType,
  PosEventType,
  PosItemType,
  PosSettingsType,
  PosVariantType,
  SavePosCustomerInputType,
  SavePosItemInputType,
} from './pos.types.js';

/**
 * The POS catalogue, customers, settings and live events.
 *
 * ## ⚠ THE SCOPE IS DECLARED ON THE CLASS, and nothing here works without it
 *
 * Every `pos:*` key is WORKSPACE level. A resolver has no path, so without a
 * declaration `FeatureGuard` resolves app level — where no workspace key
 * participates — and every key grants nothing to everybody, silently (§12.13).
 * `surface-coverage.test.ts` fails if it goes. Every operation therefore takes
 * `organizationId` and `workspaceId`.
 *
 * ## Where the guard is, since there is no decorator here
 *
 * Every operation is guarded by its BINDING in `POS_FEATURE_REGISTRY`. The
 * services then find every row BY ID AND SCOPE.
 */
@SetMetadata(REQUIRED_SCOPE_METADATA, declareScope('workspace'))
@Resolver()
export class PosCatalogueResolver {
  constructor(
    private readonly catalogue: PosCatalogueService,
    private readonly customers: PosCustomerService,
    private readonly settings: PosSettingsService,
    private readonly access: PosAccessService,
    @Inject(POS_OPTIONS) private readonly options: PosModuleOptions,
    /** Absent means not live: `posEvents` sends `sync` and ends. */
    @Optional() @Inject(POS_PUBSUB) private readonly pubsub?: PosPubSub,
  ) {}

  // ── the catalogue ─────────────────────────────────────────────────────────

  /**
   * The store's items, variants and categories — what a till loads once and
   * searches in the browser (D19).
   *
   * ⚠ COSTS ONLY FOR `pos:manage_items` OR `pos:reports`. Stripped HERE, on the
   * server, for everybody else: hiding them on screen is not enough, because
   * the API answer is readable by whoever is signed in (guard rules).
   */
  @Query(() => PosCatalogueType, { name: 'posCatalogue' })
  async posCatalogue(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('includeArchived', { type: () => Boolean, nullable: true }) includeArchived?: boolean | null,
  ): Promise<PosCatalogueType> {
    const scope = { organizationId, workspaceId };
    const viewerId = this.actor(gql.req);
    const [catalogue, costsVisible] = await Promise.all([
      this.catalogue.catalogue(scope, includeArchived ?? false),
      this.access.seesCosts(scope, viewerId),
    ]);
    return {
      categories: catalogue.categories.map(renderCategory),
      items: catalogue.items.map((entry) => renderItem(entry, costsVisible)),
      costsVisible,
    };
  }

  @Mutation(() => PosItemType, { name: 'savePosItem' })
  async savePosItem(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('input', { type: () => SavePosItemInputType }) input: SavePosItemInputType,
  ): Promise<PosItemType> {
    const saved = await this.catalogue.saveItem({ organizationId, workspaceId }, this.actor(gql.req), { ...input });
    // Bound to `pos:manage_items`, which sees costs.
    return renderItem(saved, true);
  }

  @Mutation(() => PosItemType, { name: 'setPosItemArchived' })
  async setPosItemArchived(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('itemId') itemId: string,
    @Args('archived') archived: boolean,
  ): Promise<PosItemType> {
    const scope = { organizationId, workspaceId };
    return renderItem(await this.catalogue.setItemArchived(scope, this.actor(gql.req), itemId, archived), true);
  }

  /** Omit `categoryId` for a new one. */
  @Mutation(() => PosCategoryType, { name: 'savePosCategory' })
  async savePosCategory(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('name') name: string,
    @Args('categoryId', { type: () => String, nullable: true }) categoryId?: string | null,
    @Args('sortOrder', { type: () => Int, nullable: true }) sortOrder?: number | null,
  ): Promise<PosCategoryType> {
    const scope = { organizationId, workspaceId };
    return renderCategory(
      await this.catalogue.saveCategory(scope, this.actor(gql.req), { id: categoryId, name, sortOrder }),
    );
  }

  @Mutation(() => PosCategoryType, { name: 'setPosCategoryArchived' })
  async setPosCategoryArchived(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('categoryId') categoryId: string,
    @Args('archived') archived: boolean,
  ): Promise<PosCategoryType> {
    const scope = { organizationId, workspaceId };
    return renderCategory(await this.catalogue.setCategoryArchived(scope, this.actor(gql.req), categoryId, archived));
  }

  // ── customers ─────────────────────────────────────────────────────────────

  /** The till's customer picker: by name or contact. */
  @Query(() => [PosCustomerType], { name: 'posCustomers' })
  async posCustomers(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('search', { type: () => String, nullable: true }) search?: string | null,
    @Args('includeArchived', { type: () => Boolean, nullable: true }) includeArchived?: boolean | null,
  ): Promise<PosCustomerType[]> {
    const rows = await this.customers.search({ organizationId, workspaceId }, search ?? '', includeArchived ?? false);
    return rows.map(renderCustomer);
  }

  /** Null for a customer that is not in this store. */
  @Query(() => PosCustomerType, { name: 'posCustomer', nullable: true })
  async posCustomer(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('customerId') customerId: string,
  ): Promise<PosCustomerType | null> {
    const row = await this.customers.get({ organizationId, workspaceId }, customerId);
    return row ? renderCustomer(row) : null;
  }

  @Mutation(() => PosCustomerType, { name: 'savePosCustomer' })
  async savePosCustomer(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('input', { type: () => SavePosCustomerInputType }) input: SavePosCustomerInputType,
  ): Promise<PosCustomerType> {
    return renderCustomer(
      await this.customers.save({ organizationId, workspaceId }, this.actor(gql.req), { ...input }),
    );
  }

  @Mutation(() => PosCustomerType, { name: 'setPosCustomerArchived' })
  async setPosCustomerArchived(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('customerId') customerId: string,
    @Args('archived') archived: boolean,
  ): Promise<PosCustomerType> {
    const scope = { organizationId, workspaceId };
    return renderCustomer(await this.customers.setArchived(scope, this.actor(gql.req), customerId, archived));
  }

  // ── settings ──────────────────────────────────────────────────────────────

  /** Every till reads these: the keymap drives its keys and its shortcut bar, the time zone its "today". */
  @Query(() => PosSettingsType, { name: 'posSettings' })
  async posSettings(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<PosSettingsType> {
    return renderSettings(await this.settings.get({ organizationId, workspaceId }));
  }

  /** `keymap` is `PosKeymap` as JSON text; omit it to reset every key to its default. */
  @Mutation(() => PosSettingsType, { name: 'savePosSettings' })
  async savePosSettings(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('timeZone') timeZone: string,
    @Args('keymap', { type: () => String, nullable: true }) keymap?: string | null,
  ): Promise<PosSettingsType> {
    const saved = await this.settings.save({ organizationId, workspaceId }, this.actor(gql.req), {
      timeZone,
      keymap: keymap ? parseKeymap(keymap) : null,
    });
    return renderSettings(saved);
  }

  // ── live ──────────────────────────────────────────────────────────────────

  /**
   * Changes in this store: the catalogue, customers, settings, one order.
   *
   * ⚠ IDS, NEVER CONTENT — the till reads again through the guarded queries,
   * so no event can carry a cost to somebody who may not see it. `sync` first,
   * on every (re)subscribe: the engine has no replay.
   */
  @Subscription(() => PosEventType, {
    name: 'posEvents',
    // ⚠ REQUIRED: without it GraphQL looks for a `posEvents` key on the
    // payload, finds none, and delivers `data: null` forever.
    resolve: (payload: PosEventType) => payload,
  })
  posEvents(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): AsyncIterableIterator<PosEventType> {
    this.actor(gql.req);
    const viewer = { organizationId, workspaceId };
    return withCatchUp<PosEvent, PosEventType>({
      live: (this.pubsub ?? NULL_POS_PUBSUB).asyncIterableIterator<PosEvent>(POS_EVENT.changed),
      catchUp: async () => [{ kind: 'sync', orderId: null, actorId: null }],
      transform: (event) => {
        if (!isPosEventFor(event, viewer)) return null;
        return { kind: event.change, orderId: event.orderId, actorId: event.actorId };
      },
      keyOf: () => null,
    });
  }

  private actor(request: unknown): string {
    const actorId = this.options.resolveActorId?.(request);
    if (!actorId) throw new PosWriteError('not_permitted', 'Not signed in');
    return actorId;
  }
}

/** A keymap off the wire: JSON text, shaped by `validateKeymap` in the service. */
function parseKeymap(text: string): PosKeymap {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
    const { actions, items } = parsed as Partial<PosKeymap>;
    return { actions: actions ?? ({} as PosKeymap['actions']), items: items ?? {} };
  } catch {
    throw new PosWriteError('invalid_keymap', 'Those shortcuts are not in a form this server reads');
  }
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);

export function renderCategory(row: PosCategoryRow): PosCategoryType {
  return { id: row.id, name: row.name, sortOrder: row.sortOrder, archivedAt: iso(row.archivedAt) };
}

function renderVariant(row: PosItemVariantRow, costsVisible: boolean): PosVariantType {
  return {
    id: row.id,
    itemId: row.itemId,
    name: row.name,
    code: row.code,
    price: row.price,
    cost: costsVisible ? row.cost : null,
    sortOrder: row.sortOrder,
    archivedAt: iso(row.archivedAt),
  };
}

/** ⚠ `costsVisible` false strips every cost — the item's and each variant's. */
export function renderItem(entry: PosCatalogueItem, costsVisible: boolean): PosItemType {
  const { item } = entry;
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    code: item.code,
    price: item.price,
    cost: costsVisible ? item.cost : null,
    categoryId: item.categoryId,
    archivedAt: iso(item.archivedAt),
    variants: entry.variants.map((variant) => renderVariant(variant, costsVisible)),
  };
}

export function renderCustomer(row: PosCustomerRow): PosCustomerType {
  return { id: row.id, name: row.name, contact: row.contact, note: row.note, archivedAt: iso(row.archivedAt) };
}

function renderSettings(settings: PosStoreSettings): PosSettingsType {
  return { timeZone: settings.timeZone, keymap: JSON.stringify(settings.keymap), version: settings.version };
}
