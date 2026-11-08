import { limitReachedText, type SheetImportMode, type SheetMatchKey, type SheetProblem } from '@kwtech/module-kit';
import { Inject, Injectable } from '@nestjs/common';
import { readDefaultReference, readReferenceOptions } from '../domain/references.js';
import {
  checkPosSetupInput,
  POS_SETUP_SHEET,
  type PosSetupInput,
  type PosSetupItemRef,
  type PosSetupLine,
  type PosSetupPlan,
  type PosSetupSheetKey,
  type PosSetupStore,
  planPosSetup,
  posSetupNameKey,
} from '../domain/setup.js';
import { PosWriteError } from './pos.errors.js';
import { PosEventPublisher } from './pos.events.js';
import type { InScope, PosTransaction, PosWriteClient } from './pos.repository.js';
import { POS_PRISMA_WRITE } from './pos.tokens.js';
import {
  isUniqueViolation,
  POS_CATEGORIES_MAX,
  POS_ORDER_TYPES_MAX,
  PosCatalogueService,
} from './pos-catalogue.service.js';

/** What one sheet's import did. */
export interface PosSetupSheetOutcome {
  name: string;
  created: number;
  updated: number;
  archived: number;
}

export interface PosSetupOutcome {
  sheets: PosSetupSheetOutcome[];
}

/**
 * One import takes this long at most. ⚠ Not Prisma's 5 s default: a whole
 * catalogue — a thousand items and sizes, one write each — is written in ONE
 * transaction so it lands whole or not at all, and that takes seconds.
 */
export const POS_SETUP_TIMEOUT_MS = 60_000;

/** How many of a store's rows the import reads per table: past every cap, archived rows included. */
const STORE_READ_MAX = 20_000;

/** How many problems the refusal names before "and N more". */
const PROBLEMS_SAID = 5;

/**
 * Importing a store's setup from Excel (issue #35).
 *
 * The browser read the file and showed the preview; this receives the TYPED
 * rows and trusts none of it:
 *
 *   1. the rows are checked again with the reader's own rules
 *      (`checkPosSetupInput`);
 *   2. inside ONE transaction, the store is read as it is now and the file is
 *      planned again (`planPosSetup`, the browser's own function), so a change
 *      made while the person read the preview is planned with;
 *   3. a problem refuses the whole import — unless the person chose to skip
 *      the rows with errors, and then only those rows are dropped, and what
 *      they meant is never archived by Replace;
 *   4. `pos:items` is checked for the store as it will be;
 *   5. everything is written, and one `catalogue` (and `settings`) event
 *      follows the commit.
 *
 * ⚠ ALL OR NOTHING: a failure anywhere rolls back every write.
 */
@Injectable()
export class PosSetupService {
  constructor(
    @Inject(POS_PRISMA_WRITE) private readonly prisma: PosWriteClient,
    private readonly events: PosEventPublisher,
    private readonly catalogue: PosCatalogueService,
  ) {}

  async import(
    scope: InScope,
    actorId: string,
    received: PosSetupInput,
    mode: SheetImportMode,
    skipErrorRows: boolean,
  ): Promise<PosSetupOutcome> {
    let input = received;
    const checked = checkPosSetupInput(input);
    if (checked.some((problem) => problem.line === null) || (checked.length > 0 && !skipErrorRows)) refuse(checked);
    if (checked.length > 0) input = withoutRows(input, checked);

    let outcome: { result: PosSetupOutcome; references: boolean };
    try {
      outcome = await this.prisma.$transaction(
        async (tx) => {
          const store = await readStore(tx, scope);
          let plan = planPosSetup(input, store, mode);
          // Dropping a bad row can strand another (a size whose item was that row): plan again until none is left.
          for (let pass = 0; skipErrorRows && plan.problems.length > 0 && pass < 3; pass += 1) {
            if (plan.problems.some((problem) => problem.line === null)) break;
            input = withoutRows(input, plan.problems);
            plan = planPosSetup(input, store, mode);
          }
          if (plan.problems.length > 0) refuse(plan.problems);
          await this.checkRoom(scope, actorId, store, plan.liveAfter);
          return {
            result: await apply(tx, scope, actorId, store, plan),
            references: plan.references?.changed === true,
          };
        },
        { timeout: POS_SETUP_TIMEOUT_MS },
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Two rows swapping names or codes in one file: refused rather than half-written.
      throw new PosWriteError(
        'invalid_setup',
        'Two rows would end up with the same name or code at once. Change one of them in a separate import. Nothing was changed.',
      );
    }

    await this.events.changed(scope, 'catalogue', actorId);
    if (outcome.references) await this.events.changed(scope, 'settings', actorId);
    return outcome.result;
  }

  /** `pos:items` for the store as the import leaves it; a file that frees room always fits. */
  private async checkRoom(scope: InScope, actorId: string, store: PosSetupStore, liveAfter: number): Promise<void> {
    const archivedItems = new Set(store.items.filter((item) => item.archived).map((item) => item.id));
    const liveNow =
      store.items.filter((item) => !item.archived).length +
      store.variants.filter((variant) => !variant.archived && !archivedItems.has(variant.itemId)).length;
    if (liveAfter <= liveNow) return;
    // `allowed` means ONE more fits: the last of them must.
    const decision = await this.catalogue.checkCap(scope, actorId, liveAfter - 1);
    if (decision.allowed) return;
    throw new PosWriteError(
      'limit_reached',
      `${limitReachedText(decision, { one: 'item or size for sale', many: 'items and sizes for sale' })} This file would make ${liveAfter.toLocaleString('en-US')}. Archive some, or mark some rows Archived. Nothing was changed.`,
      { limit: decision.limit, liveAfter, raise: decision.raise },
    );
  }
}

/** Refuses with the first problems, each where the person will find it. */
function refuse(problems: readonly SheetProblem[]): never {
  const said = problems.slice(0, PROBLEMS_SAID).map((problem) => {
    const place = [problem.sheet, problem.line === null ? null : `row ${problem.line}`, problem.column].filter(Boolean);
    return `${place.join(' · ')}: ${problem.message}`;
  });
  const more = problems.length > PROBLEMS_SAID ? ` And ${problems.length - PROBLEMS_SAID} more.` : '';
  throw new PosWriteError('invalid_setup', `Nothing was changed. ${said.join(' ')}${more}`, {
    problems: problems.slice(0, 50),
  });
}

const SHEET_KEY_BY_NAME = new Map<string, PosSetupSheetKey>(
  (Object.entries(POS_SETUP_SHEET) as [PosSetupSheetKey, string][]).map(([key, name]) => [name, key]),
);

/**
 * The input without the rows that have problems — and their keys HELD, so
 * Replace never archives what a dropped row meant.
 */
function withoutRows(input: PosSetupInput, problems: readonly SheetProblem[]): PosSetupInput {
  const bad = new Map<PosSetupSheetKey, Set<number>>();
  for (const problem of problems) {
    const key = SHEET_KEY_BY_NAME.get(problem.sheet);
    if (!key || problem.line === null) continue;
    bad.set(key, (bad.get(key) ?? new Set()).add(problem.line));
  }
  const held = { ...input.held };
  function keep<R>(
    key: PosSetupSheetKey,
    rows: PosSetupLine<R>[] | null,
    keyOf: (row: R) => SheetMatchKey,
  ): PosSetupLine<R>[] | null {
    if (rows === null) return null;
    const lines = bad.get(key) ?? new Set<number>();
    held[key] = [...held[key], ...rows.filter((entry) => lines.has(entry.line)).map((entry) => keyOf(entry.row))];
    return rows.filter((entry) => !lines.has(entry.line));
  }
  return {
    categories: keep('categories', input.categories, (row: { name: string }) => ({
      code: null,
      name: posSetupNameKey(row.name),
    })),
    orderTypes: keep('orderTypes', input.orderTypes, (row: { name: string }) => ({
      code: null,
      name: posSetupNameKey(row.name),
    })),
    items: keep('items', input.items, (row: { code: string | null; name: string }) => ({
      code: row.code,
      name: posSetupNameKey(row.name),
    })),
    variants: keep('variants', input.variants, (row: { code: string | null }) => ({ code: row.code, name: '' })),
    references: keep('references', input.references, () => ({ code: null, name: '' })),
    held,
  };
}

/** The store's setup as it is, archived rows included, read inside the import's transaction. */
async function readStore(tx: PosTransaction, scope: InScope): Promise<PosSetupStore> {
  const byOrder = [{ sortOrder: 'asc' as const }, { name: 'asc' as const }, { id: 'asc' as const }];
  const [categories, orderTypes, items, variants, settings] = await Promise.all([
    tx.posCategory.findMany({ where: { ...scope }, orderBy: byOrder, take: POS_CATEGORIES_MAX * 2 }),
    tx.posOrderType.findMany({ where: { ...scope }, orderBy: byOrder, take: POS_ORDER_TYPES_MAX * 2 }),
    tx.posItem.findMany({ where: { ...scope }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: STORE_READ_MAX }),
    tx.posItemVariant.findMany({
      where: { ...scope },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      take: STORE_READ_MAX,
    }),
    tx.posSettings.findUnique({ where: { workspaceId: scope.workspaceId } }),
  ]);
  const options = readReferenceOptions(settings?.referenceOptions ?? null);
  return {
    categories: categories.map((row) => ({
      id: row.id,
      name: row.name,
      sortOrder: row.sortOrder,
      archived: row.archivedAt !== null,
    })),
    orderTypes: orderTypes.map((row) => ({
      id: row.id,
      name: row.name,
      sortOrder: row.sortOrder,
      isDefault: row.isDefault,
      archived: row.archivedAt !== null,
    })),
    items: items.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      kind: row.kind,
      categoryId: row.categoryId,
      description: row.description,
      price: row.price,
      cost: row.cost,
      archived: row.archivedAt !== null,
    })),
    variants: variants.map((row) => ({
      id: row.id,
      itemId: row.itemId,
      code: row.code,
      name: row.name,
      price: row.price,
      cost: row.cost,
      sortOrder: row.sortOrder,
      archived: row.archivedAt !== null,
    })),
    references: { options, defaultReference: readDefaultReference(options, settings?.defaultReference ?? null) },
  };
}

/** The archive stamp for a row whose Archived column says `archived`, or undefined when it does not change. */
function archiveChange(
  archived: boolean,
  was: boolean,
  now: Date,
): { archivedAt: Date | null } | Record<string, never> {
  if (archived === was) return {};
  return { archivedAt: archived ? now : null };
}

/**
 * Writes the plan, in the order rows refer to each other: categories, order
 * types, items (which name categories), sizes (which name items), references.
 * Sequential on purpose: one transaction, and each write may need the last's id.
 */
async function apply(
  tx: PosTransaction,
  scope: InScope,
  actorId: string,
  store: PosSetupStore,
  plan: PosSetupPlan,
): Promise<PosSetupOutcome> {
  const now = new Date();
  const sheets: PosSetupSheetOutcome[] = [];
  const count = (name: string, steps: readonly { kind: string }[], archived: number) =>
    sheets.push({
      name,
      created: steps.filter((step) => step.kind === 'create').length,
      updated: steps.filter((step) => step.kind === 'update').length,
      archived,
    });

  // ── categories ──
  const categoryIds = new Map(store.categories.map((row) => [posSetupNameKey(row.name), row.id]));
  if (plan.categories) {
    for (const step of plan.categories.steps) {
      const { row } = step;
      const fields = { name: row.name, nameKey: row.name.toLowerCase() };
      if (step.kind === 'create') {
        const created = await tx.posCategory.create({ data: { ...scope, ...fields, sortOrder: row.sortOrder ?? 0 } });
        categoryIds.set(posSetupNameKey(row.name), created.id);
        if (row.archived)
          await tx.posCategory.updateMany({ where: { ...scope, id: created.id }, data: { archivedAt: now } });
        continue;
      }
      if (step.kind === 'unchanged') continue;
      await tx.posCategory.updateMany({
        where: { ...scope, id: step.existing.id },
        data: {
          ...fields,
          sortOrder: row.sortOrder ?? step.existing.sortOrder,
          ...archiveChange(row.archived, step.existing.archived, now),
        },
      });
    }
    for (const row of plan.categories.archive) {
      await tx.posCategory.updateMany({ where: { ...scope, id: row.id }, data: { archivedAt: now } });
    }
    count(POS_SETUP_SHEET.categories, plan.categories.steps, plan.categories.archive.length);
  }

  // ── order types, and at most one default ──
  if (plan.orderTypes) {
    const ids = new Map<number, string>();
    for (const step of plan.orderTypes.steps) {
      const { row } = step;
      const fields = { name: row.name, nameKey: row.name.toLowerCase() };
      if (step.kind === 'create') {
        const created = await tx.posOrderType.create({ data: { ...scope, ...fields, sortOrder: row.sortOrder ?? 0 } });
        ids.set(step.line, created.id);
        if (row.archived)
          await tx.posOrderType.updateMany({ where: { ...scope, id: created.id }, data: { archivedAt: now } });
        continue;
      }
      ids.set(step.line, step.existing.id);
      if (step.kind === 'unchanged') continue;
      await tx.posOrderType.updateMany({
        where: { ...scope, id: step.existing.id },
        data: {
          ...fields,
          sortOrder: row.sortOrder ?? step.existing.sortOrder,
          ...archiveChange(row.archived, step.existing.archived, now),
        },
      });
    }
    for (const row of plan.orderTypes.archive) {
      await tx.posOrderType.updateMany({
        where: { ...scope, id: row.id },
        data: { archivedAt: now, isDefault: false },
      });
    }
    await applyDefaultOrderType(tx, scope, store, plan, ids);
    count(POS_SETUP_SHEET.orderTypes, plan.orderTypes.steps, plan.orderTypes.archive.length);
  }

  // ── items ──
  const itemIds = new Map<number, string>();
  if (plan.items) {
    for (const step of plan.items.steps) {
      const { row } = step;
      const categoryId = row.category === null ? null : (categoryIds.get(posSetupNameKey(row.category)) ?? null);
      const fields = {
        categoryId,
        kind: row.kind,
        name: row.name,
        code: row.code,
        description: row.description,
        cost: row.cost,
      };
      if (step.kind === 'create') {
        const created = await tx.posItem.create({
          data: { ...scope, ...fields, price: row.price ?? 0, createdById: actorId, updatedById: actorId },
        });
        itemIds.set(step.line, created.id);
        if (row.archived) {
          await tx.posItem.updateMany({
            where: { ...scope, id: created.id },
            data: { archivedAt: now, updatedById: actorId },
          });
        }
        continue;
      }
      itemIds.set(step.line, step.existing.id);
      if (step.kind === 'unchanged') continue;
      await tx.posItem.updateMany({
        where: { ...scope, id: step.existing.id },
        data: {
          ...fields,
          price: row.price ?? step.existing.price,
          updatedById: actorId,
          ...archiveChange(row.archived, step.existing.archived, now),
        },
      });
    }
    for (const row of plan.items.archive) {
      await tx.posItem.updateMany({ where: { ...scope, id: row.id }, data: { archivedAt: now, updatedById: actorId } });
    }
    count(POS_SETUP_SHEET.items, plan.items.steps, plan.items.archive.length);
  }

  // ── sizes: each joins its item, a new one by the id it was just given ──
  if (plan.variants) {
    const itemIdOf = (ref: PosSetupItemRef | undefined): string | null => {
      if (!ref) return null;
      return ref.kind === 'store' ? ref.id : (itemIds.get(ref.line) ?? null);
    };
    for (const step of plan.variants.steps) {
      const { row } = step;
      const fields = { name: row.name, code: row.code, price: row.price, cost: row.cost };
      if (step.kind === 'create') {
        const itemId = itemIdOf(plan.variantItems.get(step.line));
        // The plan resolved every size's item; one without is a bug, and rolls the import back.
        if (!itemId) throw new Error(`Variants row ${step.line} has no item to join.`);
        const created = await tx.posItemVariant.create({
          data: { ...scope, ...fields, itemId, sortOrder: row.sortOrder ?? 0 },
        });
        if (row.archived) {
          await tx.posItemVariant.updateMany({
            where: { ...scope, id: created.id, itemId },
            data: { archivedAt: now },
          });
        }
        continue;
      }
      if (step.kind === 'unchanged') continue;
      await tx.posItemVariant.updateMany({
        where: { ...scope, id: step.existing.id, itemId: step.existing.itemId },
        data: {
          ...fields,
          sortOrder: row.sortOrder ?? step.existing.sortOrder,
          ...archiveChange(row.archived, step.existing.archived, now),
        },
      });
    }
    for (const row of plan.variants.archive) {
      await tx.posItemVariant.updateMany({
        where: { ...scope, id: row.id, itemId: row.itemId },
        data: { archivedAt: now },
      });
    }
    count(POS_SETUP_SHEET.variants, plan.variants.steps, plan.variants.archive.length);
  }

  // ── references: the whole list, as the Settings save writes it ──
  if (plan.references) {
    const { options, defaultReference, counts, changed } = plan.references;
    // Unchanged is not rewritten: the settings' version and its live event mean "somebody changed this".
    if (changed)
      await tx.posSettings.upsert({
        where: { workspaceId: scope.workspaceId },
        create: { ...scope, referenceOptions: options, defaultReference, updatedById: actorId },
        update: { referenceOptions: options, defaultReference, updatedById: actorId, version: { increment: 1 } },
      });
    sheets.push({
      name: POS_SETUP_SHEET.references,
      created: counts.create,
      updated: counts.update,
      archived: counts.archive,
    });
  }
  return { sheets };
}

/**
 * The default order type after the import: the row marked Default, or — when
 * the store's default is on the sheet marked No and no row is marked — none.
 * Otherwise unchanged. ⚠ At most one, the old one cleared in the same write.
 */
async function applyDefaultOrderType(
  tx: PosTransaction,
  scope: InScope,
  store: PosSetupStore,
  plan: PosSetupPlan,
  ids: ReadonlyMap<number, string>,
): Promise<void> {
  const steps = plan.orderTypes?.steps ?? [];
  const chosen = steps.find((step) => step.row.isDefault);
  const current = store.orderTypes.find((type) => type.isDefault && !type.archived);
  const currentStep = current
    ? steps.find((step) => step.kind !== 'create' && step.existing.id === current.id)
    : undefined;
  let wanted: string | null | undefined;
  if (chosen) wanted = ids.get(chosen.line) ?? null;
  else if (currentStep) wanted = null;
  if (wanted === undefined || wanted === (current?.id ?? null)) return;
  await tx.posOrderType.updateMany({ where: { ...scope, isDefault: true }, data: { isDefault: false } });
  if (wanted) await tx.posOrderType.updateMany({ where: { ...scope, id: wanted }, data: { isDefault: true } });
}
