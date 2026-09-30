import type { LimitChecker, LimitDecision } from '@kwtech/module-kit';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { checkPosCost, checkPosPrice } from '../domain/money.js';
import { preparePosCode, preparePosDescription, preparePosName } from '../domain/text.js';
import { POS_LIMIT, POS_LIMIT_REGISTRY } from '../feature-keys.js';
import type { PosItemKind, PosRefusal } from '../types.js';
import { PosWriteError, refusalError, unwrap } from './pos.errors.js';
import { PosEventPublisher } from './pos.events.js';
import type {
  InScope,
  PosCategoryRow,
  PosItemRow,
  PosItemVariantRow,
  PosTransaction,
  PosWriteClient,
} from './pos.repository.js';
import { POS_LIMIT_CHECKER, POS_PRISMA_WRITE } from './pos.tokens.js';

/** How many items one catalogue read returns. The default cap is 1000 items and variants, so this is generous. */
export const POS_CATALOGUE_READ_MAX = 5000;

/** How many categories a store may have. A till with more tabs than this is unreadable. */
export const POS_CATEGORIES_MAX = 200;

/** How many variants one item may have. Past this it is a catalogue of its own. */
export const POS_VARIANTS_MAX = 100;

export const POS_ITEM_KINDS = ['product', 'service'] as const satisfies readonly PosItemKind[];

/** A kind as it arrives over the wire — a string — narrowed. */
export function isPosItemKind(value: unknown): value is PosItemKind {
  return (POS_ITEM_KINDS as readonly unknown[]).includes(value);
}

/** An item with its variants in order. */
export interface PosCatalogueItem {
  item: PosItemRow;
  variants: readonly PosItemVariantRow[];
}

export interface PosCatalogue {
  categories: readonly PosCategoryRow[];
  items: readonly PosCatalogueItem[];
}

export interface SavePosVariantInput {
  /** An existing variant of this item, or omitted for a new one. */
  id?: string | null | undefined;
  name: string;
  code?: string | null | undefined;
  price: number;
  cost?: number | null | undefined;
}

export interface SavePosItemInput {
  /** Omitted: a new item. */
  id?: string | null | undefined;
  /** A string off the wire, checked by `isPosItemKind`. */
  kind: string;
  name: string;
  code?: string | null | undefined;
  /**
   * One line for the till, or null / empty to clear it. OMITTED: LEFT AS IT
   * IS, so a client that predates the field cannot wipe it by saving an item.
   */
  description?: string | null | undefined;
  /** Centavos. Unused while the item has variants. */
  price: number;
  cost?: number | null | undefined;
  categoryId?: string | null | undefined;
  /**
   * The item's variants, IN ORDER — the whole list. An existing variant left
   * out is ARCHIVED (old orders point at it), never deleted. Omitted: the
   * variants are left as they are.
   */
  variants?: readonly SavePosVariantInput[] | null | undefined;
}

interface PreparedVariant {
  id: string | null;
  name: string;
  code: string | null;
  price: number;
  cost: number | null;
}

/**
 * The catalogue: items, their variants, categories. Everything here but the
 * read is bound to `pos:manage_items`.
 *
 * Each write: prepare every field through the domain, then find what it
 * touches BY ID AND SCOPE inside one transaction, count against the cap in
 * that same transaction, write, and publish `catalogue` after the commit so
 * every till's search reloads (D19).
 */
@Injectable()
export class PosCatalogueService {
  constructor(
    @Inject(POS_PRISMA_WRITE) private readonly prisma: PosWriteClient,
    private readonly events: PosEventPublisher,
    /** Unbound: the declared default cap. */
    @Optional() @Inject(POS_LIMIT_CHECKER) private readonly limits?: LimitChecker,
  ) {}

  // ── reading ───────────────────────────────────────────────────────────────

  /**
   * The store's catalogue. `archived: false` is what a till loads; the item
   * screen asks for everything, archived items included, to restore them.
   *
   * ⚠ ROWS CARRY COSTS. The resolver strips them for anybody without
   * `pos:manage_items` or `pos:reports`; nothing here decides who sees them.
   */
  async catalogue(scope: InScope, includeArchived: boolean): Promise<PosCatalogue> {
    const live = includeArchived ? {} : { archivedAt: null };
    const [categories, items] = await Promise.all([
      this.prisma.posCategory.findMany({
        where: { ...scope, ...live },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        take: POS_CATEGORIES_MAX * 2,
      }),
      this.prisma.posItem.findMany({
        where: { ...scope, ...live },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: POS_CATALOGUE_READ_MAX,
      }),
    ]);
    const variants = await this.prisma.posItemVariant.findMany({
      where: { ...scope, itemId: { in: items.map((item) => item.id) }, ...live },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      take: POS_CATALOGUE_READ_MAX,
    });
    return { categories, items: items.map((item) => withVariants(item, variants)) };
  }

  // ── categories ────────────────────────────────────────────────────────────

  /** A new category (no `id`), or a renamed or reordered one. Names are unique per store, case-blind. */
  async saveCategory(
    scope: InScope,
    actorId: string,
    input: { id?: string | null | undefined; name: string; sortOrder?: number | null | undefined },
  ): Promise<PosCategoryRow> {
    const { name } = unwrap(preparePosName(input.name));
    const nameKey = name.toLowerCase();
    const sortOrder = input.sortOrder ?? 0;
    if (!Number.isSafeInteger(sortOrder)) throw refusalError('invalid_name');

    const saved = await this.transact('invalid_name', async (tx) => {
      const clash = await tx.posCategory.findFirst({ where: { ...scope, nameKey } });
      if (clash && clash.id !== input.id) {
        throw new PosWriteError('invalid_name', 'This store already has a category with that name');
      }
      if (!input.id) {
        if ((await tx.posCategory.count({ where: { ...scope } })) >= POS_CATEGORIES_MAX) {
          throw refusalError('limit_reached');
        }
        return tx.posCategory.create({ data: { ...scope, name, nameKey, sortOrder } });
      }
      const updated = await tx.posCategory.updateMany({
        where: { ...scope, id: input.id },
        data: { name, nameKey, sortOrder },
      });
      if (updated.count === 0) throw refusalError('not_found');
      return this.requireCategory(tx, scope, input.id);
    });
    await this.events.changed(scope, 'catalogue', actorId);
    return saved;
  }

  /**
   * Archives a category, or restores it. Its items keep it, and the till simply
   * stops showing its tab; old orders never had a link to lose — each line
   * copied the category's NAME at sale (§3).
   */
  async setCategoryArchived(scope: InScope, actorId: string, id: string, archived: boolean): Promise<PosCategoryRow> {
    const saved = await this.transact('invalid_name', async (tx) => {
      const updated = await tx.posCategory.updateMany({
        where: { ...scope, id },
        data: { archivedAt: archived ? new Date() : null },
      });
      if (updated.count === 0) throw refusalError('not_found');
      return this.requireCategory(tx, scope, id);
    });
    await this.events.changed(scope, 'catalogue', actorId);
    return saved;
  }

  // ── items and variants ────────────────────────────────────────────────────

  /**
   * A new item, or an edited one, with its variants — one save, one
   * transaction, so a till never loads an item whose variants are half saved.
   *
   * ⚠ THE CAP (`pos:items`) IS COUNTED IN THE SAME TRANSACTION, over live items
   * plus live variants of live items, and only when the save ADDS to that
   * count: renaming an item in a full store must still work.
   *
   * ⚠ CODES ARE UNIQUE PER STORE ACROSS ITEMS AND VARIANTS. Each table's
   * `@@unique` holds its own half; the other half is checked here, in the
   * transaction. Two admins saving the same code on an item and a variant at
   * the same instant is the accepted race (guard rules).
   */
  async saveItem(scope: InScope, actorId: string, input: SavePosItemInput): Promise<PosCatalogueItem> {
    if (!isPosItemKind(input.kind)) throw refusalError('invalid_kind');
    const kind = input.kind;
    const { name } = unwrap(preparePosName(input.name));
    const { code } = unwrap(preparePosCode(input.code ?? ''));
    const description =
      input.description === undefined ? undefined : unwrap(preparePosDescription(input.description ?? '')).description;
    refuse(checkPosPrice(input.price));
    const cost = input.cost ?? null;
    refuse(checkPosCost(cost));
    const variants = input.variants ? input.variants.map(prepareVariant) : null;
    if (variants && variants.length > POS_VARIANTS_MAX) throw refusalError('limit_reached');
    checkCodesDistinct(code, variants ?? []);

    const saved = await this.transact('duplicate_code', async (tx) => {
      const existing = input.id ? await this.requireItem(tx, scope, input.id) : null;
      const categoryId = input.categoryId ?? null;
      if (categoryId && !(await tx.posCategory.findFirst({ where: { ...scope, id: categoryId } }))) {
        throw refusalError('not_found');
      }
      const currentVariants = existing
        ? await tx.posItemVariant.findMany({
            where: { ...scope, itemId: existing.id },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            take: POS_VARIANTS_MAX * 10,
          })
        : [];
      for (const wanted of variants ?? []) {
        if (wanted.id && !currentVariants.some((variant) => variant.id === wanted.id)) throw refusalError('not_found');
      }
      await this.checkCodesFree(tx, scope, existing?.id ?? null, code, variants ?? [], currentVariants);

      // What this save adds to the live count: the item itself when new, and
      // the live variants it ends with minus those it had.
      const liveBefore = existing?.archivedAt ? 0 : currentVariants.filter((variant) => !variant.archivedAt).length;
      const liveAfter = variants ? variants.length : liveBefore;
      const added = (existing ? 0 : 1) + (existing?.archivedAt ? 0 : liveAfter - liveBefore);
      if (added > 0) await this.checkRoom(tx, scope, actorId, added);

      const fields = { categoryId, kind, name, code, price: input.price, cost };
      const item = existing
        ? await this.updateItem(tx, scope, existing.id, {
            ...fields,
            ...(description === undefined ? {} : { description }),
            updatedById: actorId,
          })
        : await tx.posItem.create({
            data: { ...scope, ...fields, description: description ?? null, createdById: actorId, updatedById: actorId },
          });

      if (variants) await this.writeVariants(tx, scope, item.id, variants, currentVariants);
      const rows = await tx.posItemVariant.findMany({
        where: { ...scope, itemId: item.id },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        take: POS_VARIANTS_MAX * 10,
      });
      return { item, variants: rows };
    });
    await this.events.changed(scope, 'catalogue', actorId);
    return saved;
  }

  /**
   * Archives an item — it leaves every till — or restores it, which counts
   * against the cap again (with its live variants). Never deleted: old orders
   * point at it.
   */
  async setItemArchived(scope: InScope, actorId: string, id: string, archived: boolean): Promise<PosCatalogueItem> {
    const saved = await this.transact('duplicate_code', async (tx) => {
      const item = await this.requireItem(tx, scope, id);
      const variants = await tx.posItemVariant.findMany({
        where: { ...scope, itemId: id },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        take: POS_VARIANTS_MAX * 10,
      });
      if (!archived && item.archivedAt) {
        await this.checkRoom(tx, scope, actorId, 1 + variants.filter((variant) => !variant.archivedAt).length);
      }
      const updated = await this.updateItem(tx, scope, id, {
        archivedAt: archived ? (item.archivedAt ?? new Date()) : null,
        updatedById: actorId,
      });
      return { item: updated, variants };
    });
    await this.events.changed(scope, 'catalogue', actorId);
    return saved;
  }

  // ── inside the transaction ────────────────────────────────────────────────

  private async writeVariants(
    tx: PosTransaction,
    scope: InScope,
    itemId: string,
    wanted: readonly PreparedVariant[],
    current: readonly PosItemVariantRow[],
  ): Promise<void> {
    const kept = new Set(wanted.map((variant) => variant.id).filter((id): id is string => id !== null));
    // Archive the dropped ones first. An archived variant KEEPS its code, so a
    // code can move to a new variant only once the old one gives it up.
    for (const variant of current) {
      if (kept.has(variant.id) || variant.archivedAt) continue;
      await tx.posItemVariant.updateMany({
        where: { ...scope, id: variant.id, itemId },
        data: { archivedAt: new Date() },
      });
    }
    // In order, one at a time: `sortOrder` is the position in the list sent.
    for (const [sortOrder, variant] of wanted.entries()) {
      const fields = { name: variant.name, code: variant.code, price: variant.price, cost: variant.cost, sortOrder };
      if (variant.id) {
        await tx.posItemVariant.updateMany({
          where: { ...scope, id: variant.id, itemId },
          data: { ...fields, archivedAt: null },
        });
        continue;
      }
      await tx.posItemVariant.create({ data: { ...scope, itemId, ...fields } });
    }
  }

  /** ⚠ The other table's half of the code's uniqueness (the schema holds each table's own half). */
  private async checkCodesFree(
    tx: PosTransaction,
    scope: InScope,
    itemId: string | null,
    itemCode: string | null,
    variants: readonly PreparedVariant[],
    ownVariants: readonly PosItemVariantRow[],
  ): Promise<void> {
    const ownVariantIds = new Set(ownVariants.map((variant) => variant.id));
    const codes = [itemCode, ...variants.map((variant) => variant.code)].filter((c): c is string => c !== null);
    for (const code of codes) {
      const [item, variant] = await Promise.all([
        tx.posItem.findFirst({ where: { ...scope, code } }),
        tx.posItemVariant.findFirst({ where: { ...scope, code } }),
      ]);
      if (item && item.id !== itemId) throw refusalError('duplicate_code');
      if (variant && !ownVariantIds.has(variant.id)) throw refusalError('duplicate_code');
    }
  }

  /**
   * Whether `added` more live items or variants fit. The count is taken HERE,
   * inside the writing transaction.
   */
  private async checkRoom(tx: PosTransaction, scope: InScope, actorId: string, added: number): Promise<void> {
    const [items, variants] = await Promise.all([
      tx.posItem.count({ where: { ...scope, archivedAt: null } }),
      tx.posItemVariant.count({ where: { ...scope, archivedAt: null, item: { archivedAt: null } } }),
    ]);
    // `allowed` means ONE more fits; the last of `added` must fit.
    const decision = await this.checkCap(scope, actorId, items + variants + added - 1);
    if (!decision.allowed) {
      throw new PosWriteError(
        'limit_reached',
        `This store can have ${decision.limit} items and variants for sale — archive some first`,
        { limit: decision.limit },
      );
    }
  }

  private async checkCap(scope: InScope, actorId: string, current: number): Promise<LimitDecision> {
    if (this.limits) return this.limits.check({ actorId, key: POS_LIMIT.items, current, ...scope });
    const cap = POS_LIMIT_REGISTRY.find((spec) => spec.key === POS_LIMIT.items)?.defaultValue ?? 0;
    return { allowed: current < cap, limit: cap, current, remaining: Math.max(cap - current, 0) };
  }

  private async updateItem(
    tx: PosTransaction,
    scope: InScope,
    id: string,
    data: Parameters<PosTransaction['posItem']['updateMany']>[0]['data'],
  ): Promise<PosItemRow> {
    await tx.posItem.updateMany({ where: { ...scope, id }, data });
    return this.requireItem(tx, scope, id);
  }

  private async requireItem(tx: PosTransaction, scope: InScope, id: string): Promise<PosItemRow> {
    const item = await tx.posItem.findFirst({ where: { ...scope, id } });
    if (!item) throw refusalError('not_found');
    return item;
  }

  private async requireCategory(tx: PosTransaction, scope: InScope, id: string): Promise<PosCategoryRow> {
    const category = await tx.posCategory.findFirst({ where: { ...scope, id } });
    if (!category) throw refusalError('not_found');
    return category;
  }

  /**
   * A transaction whose unique violation is `onUnique`, not a 500: the race the
   * in-transaction check cannot see (two saves at the same instant) lands on
   * the schema's `@@unique` and is refused in the same words.
   */
  private async transact<T>(onUnique: PosRefusal, fn: (tx: PosTransaction) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn);
    } catch (error) {
      if (isUniqueViolation(error)) throw refusalError(onUnique);
      throw error;
    }
  }
}

function prepareVariant(input: SavePosVariantInput): PreparedVariant {
  const { name } = unwrap(preparePosName(input.name));
  const { code } = unwrap(preparePosCode(input.code ?? ''));
  refuse(checkPosPrice(input.price));
  const cost = input.cost ?? null;
  refuse(checkPosCost(cost));
  return { id: input.id ?? null, name, code, price: input.price, cost };
}

/** Two codes in ONE save that are the same: refused before the database is asked. */
function checkCodesDistinct(itemCode: string | null, variants: readonly PreparedVariant[]): void {
  const codes = [itemCode, ...variants.map((variant) => variant.code)].filter((c): c is string => c !== null);
  if (new Set(codes).size !== codes.length) throw refusalError('duplicate_code');
}

function withVariants(item: PosItemRow, variants: readonly PosItemVariantRow[]): PosCatalogueItem {
  return { item, variants: variants.filter((variant) => variant.itemId === item.id) };
}

function refuse(refusal: PosRefusal | null): void {
  if (refusal) throw refusalError(refusal);
}

/** Prisma's unique violation, detected structurally: this module never imports Prisma. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}
