import {
  matchSheets,
  planSheetImport,
  readSheet,
  type SheetImportMode,
  type SheetMatchKey,
  type SheetPlan,
  type SheetProblem,
  type SheetRowInput,
  type SheetSpec,
  type SheetValue,
} from '@kwtech/module-kit';
import type { PosItemKind } from '../types.js';
import { checkPosCost, checkPosPrice, POS_PRICE_MAX } from './money.js';
import { posReferenceKey, readDefaultReference, validateReferenceOptions } from './references.js';
import {
  POS_CODE_MAX,
  POS_DESCRIPTION_MAX,
  POS_NAME_MAX,
  preparePosCode,
  preparePosDescription,
  preparePosName,
} from './text.js';

/**
 * A store's SETUP to and from Excel (issue #35): one workbook, a tab for each
 * part of the Items tab — Items, Variants (the sizes), Categories, Order types
 * and References — and a Read me. How a store gets its POS set up and starts
 * selling quickly: fill in the template, or import another store's export.
 *
 * ⚠ ONE SET OF RULES FOR BOTH SIDES. The browser reads the file and plans it
 * to show the preview; the server receives the typed rows and plans them
 * AGAIN, against the store as it is inside its transaction, before writing a
 * thing. Both call `planPosSetup`, so the preview and the import cannot
 * disagree about a row.
 *
 * ⚠ SETUP ONLY: no orders, customers or history, and not "Not available"
 * (#37) — that is today's state, not setup; everything imports available.
 * A store's stock links and its "most ordered" ranking (#47) point at item
 * ids, which a file does not carry, so they do not travel.
 */

// ── the sheets ──────────────────────────────────────────────────────────────

export const POS_SETUP_SHEET = {
  items: 'Items',
  variants: 'Variants',
  categories: 'Categories',
  orderTypes: 'Order types',
  references: 'References',
} as const;

export type PosSetupSheetKey = keyof typeof POS_SETUP_SHEET;

/** The tabs in the file's order: what each row refers to comes before it in Excel too. */
export const POS_SETUP_SHEET_ORDER: readonly PosSetupSheetKey[] = [
  'categories',
  'orderTypes',
  'items',
  'variants',
  'references',
];

const ARCHIVED = {
  key: 'archived',
  header: 'Archived',
  kind: 'yes_no',
  example: 'No',
  help: 'Yes keeps it out of sight without deleting it. Blank is No.',
} as const;
const SORT_ORDER = {
  key: 'sortOrder',
  header: 'Sort order',
  kind: 'integer',
  example: 0,
  help: 'Lower comes first. Blank keeps the current one (0 for a new row).',
} as const;

export const POS_SETUP_SPECS = {
  categories: {
    name: POS_SETUP_SHEET.categories,
    help: 'One row per category: the tabs on the till.',
    columns: [
      {
        key: 'name',
        header: 'Name',
        kind: 'text',
        required: true,
        maxLength: POS_NAME_MAX,
        example: 'Drinks',
        help: 'How rows are matched: the same name, any case, updates that category.',
      },
      SORT_ORDER,
      ARCHIVED,
    ],
  },
  orderTypes: {
    name: POS_SETUP_SHEET.orderTypes,
    help: 'One row per way an order is served: Dine-in, Takeout.',
    columns: [
      {
        key: 'name',
        header: 'Name',
        kind: 'text',
        required: true,
        maxLength: POS_NAME_MAX,
        example: 'Dine-in',
        help: 'How rows are matched: the same name, any case, updates that order type.',
      },
      SORT_ORDER,
      {
        key: 'isDefault',
        header: 'Default',
        kind: 'yes_no',
        example: 'Yes',
        help: 'Yes on at most one row: what a new order starts with.',
      },
      ARCHIVED,
    ],
  },
  items: {
    name: POS_SETUP_SHEET.items,
    help: 'One row per item the store sells. Sizes go on the Variants sheet.',
    columns: [
      {
        key: 'code',
        header: 'Code',
        kind: 'text',
        textFormat: true,
        maxLength: POS_CODE_MAX,
        example: 'LAT',
        help: 'Optional. Letters, digits, - _ . / only, unique across items and sizes. With a code, rows are matched by it; without one, by the name.',
      },
      {
        key: 'name',
        header: 'Name',
        kind: 'text',
        required: true,
        maxLength: POS_NAME_MAX,
        example: 'Latte',
        help: 'Required.',
      },
      {
        key: 'kind',
        header: 'Kind',
        kind: 'choice',
        choices: ['product', 'service'],
        example: 'product',
        help: 'product or service. Blank is product.',
      },
      {
        key: 'category',
        header: 'Category',
        kind: 'text',
        listFrom: { sheet: POS_SETUP_SHEET.categories, header: 'Name' },
        example: 'Drinks',
        help: 'A category on the Categories sheet or already in the store. Blank for none.',
      },
      {
        key: 'description',
        header: 'Description',
        kind: 'text',
        maxLength: POS_DESCRIPTION_MAX,
        example: 'Hot or iced.',
        help: 'Optional. One line, shown under the name on the till.',
      },
      {
        key: 'price',
        header: 'Price',
        kind: 'money',
        example: 120,
        help: 'In pesos, like 12.50. May be blank for an item whose sizes have their own prices.',
      },
      {
        key: 'cost',
        header: 'Cost',
        kind: 'money',
        example: 45,
        help: 'Optional, in pesos: what one costs the store. Only managers see it.',
      },
      ARCHIVED,
    ],
  },
  variants: {
    name: POS_SETUP_SHEET.variants,
    help: 'One row per size or type of an item, each with its own price: Small, Large, A4.',
    columns: [
      {
        key: 'itemCode',
        header: 'Item code',
        kind: 'text',
        textFormat: true,
        example: 'LAT',
        help: 'The item it belongs to, by its code. Or leave it blank and give the Item name.',
      },
      {
        key: 'itemName',
        header: 'Item name',
        kind: 'text',
        example: 'Latte',
        help: 'The item it belongs to, by name, when the item has no code.',
      },
      {
        key: 'code',
        header: 'Code',
        kind: 'text',
        textFormat: true,
        maxLength: POS_CODE_MAX,
        example: 'LAT-L',
        help: 'Optional, unique across items and sizes. Without one, the size is matched by its name within its item.',
      },
      {
        key: 'name',
        header: 'Name',
        kind: 'text',
        required: true,
        maxLength: POS_NAME_MAX,
        example: 'Large',
        help: 'Required.',
      },
      {
        key: 'price',
        header: 'Price',
        kind: 'money',
        required: true,
        example: 140,
        help: 'In pesos, like 12.50.',
      },
      { key: 'cost', header: 'Cost', kind: 'money', example: 55, help: 'Optional, in pesos.' },
      SORT_ORDER,
      ARCHIVED,
    ],
  },
  references: {
    name: POS_SETUP_SHEET.references,
    help: 'The order references the Reference and Hold dialogs offer: Table 1, Table 2.',
    columns: [
      { key: 'option', header: 'Option', kind: 'text', required: true, example: 'Table 1', help: 'Required.' },
      {
        key: 'isDefault',
        header: 'Default',
        kind: 'yes_no',
        example: 'No',
        help: 'Yes on at most one row: the reference a new order starts with.',
      },
    ],
  },
} as const satisfies Record<PosSetupSheetKey, SheetSpec>;

/** The specs in the file's order. */
export const POS_SETUP_SHEET_SPECS: readonly SheetSpec[] = POS_SETUP_SHEET_ORDER.map((key) => POS_SETUP_SPECS[key]);

// ── typed rows ──────────────────────────────────────────────────────────────

export interface PosSetupCategoryRow {
  name: string;
  /** Null: keep the current one, or 0 for a new row. */
  sortOrder: number | null;
  archived: boolean;
}

export interface PosSetupOrderTypeRow {
  name: string;
  sortOrder: number | null;
  isDefault: boolean;
  archived: boolean;
}

export interface PosSetupItemRow {
  code: string | null;
  name: string;
  kind: PosItemKind;
  /** A category's name, or null for none. */
  category: string | null;
  description: string | null;
  /** Centavos. Null only for an item whose sizes carry the prices. */
  price: number | null;
  cost: number | null;
  archived: boolean;
}

export interface PosSetupVariantRow {
  /** The item it belongs to: by code, else by name. */
  itemCode: string | null;
  itemName: string | null;
  code: string | null;
  name: string;
  price: number;
  cost: number | null;
  sortOrder: number | null;
  archived: boolean;
}

export interface PosSetupReferenceRow {
  option: string;
  isDefault: boolean;
}

/** A row and the row number Excel shows for it, so a problem found on the server still points at it. */
export interface PosSetupLine<R> {
  line: number;
  row: R;
}

/**
 * What a file holds, typed: per sheet, its good rows — or NULL when the tab is
 * not in the file, which leaves that part of the store alone (⚠ never read as
 * "empty", which Replace would read as "archive everything"). `held` is the
 * keys of rows that did not read, so Replace never archives what they meant.
 */
export interface PosSetupInput {
  categories: PosSetupLine<PosSetupCategoryRow>[] | null;
  orderTypes: PosSetupLine<PosSetupOrderTypeRow>[] | null;
  items: PosSetupLine<PosSetupItemRow>[] | null;
  variants: PosSetupLine<PosSetupVariantRow>[] | null;
  references: PosSetupLine<PosSetupReferenceRow>[] | null;
  held: Record<PosSetupSheetKey, SheetMatchKey[]>;
}

/** What `readPosSetup` found: the typed rows, and every problem, each on its sheet, row and column. */
export interface PosSetupReading {
  input: PosSetupInput;
  problems: SheetProblem[];
  /** Wrong with a whole tab (a heading missing): nothing imports until fixed. */
  fatal: SheetProblem[];
  /** Tabs not in the file, by name. */
  missing: string[];
}

/** One of the file's tabs, as `@kwtech/web-ui`'s `readWorkbook` gives it. */
export interface PosSetupTab {
  name: string;
  rows: readonly SheetRowInput[];
}

const NAME_MESSAGE = `At most ${POS_NAME_MAX} characters, and no hidden or control characters.`;
const CODE_MESSAGE = `Letters, digits, - _ . / only, at most ${POS_CODE_MAX} characters.`;

/** A name as rows are matched by it: case- and spacing-blind, as the store's own `nameKey`s are. */
export function posSetupNameKey(name: string): string {
  return posReferenceKey(name);
}

/**
 * A workbook's tabs → typed rows, every problem on its row and column. The
 * BROWSER's half; the server receives `input` and plans it again.
 */
export function readPosSetup(tabs: readonly PosSetupTab[]): PosSetupReading {
  const { found, missing } = matchSheets(
    POS_SETUP_SHEET_SPECS,
    tabs.map((tab) => tab.name),
  );
  const tabFor = (spec: SheetSpec) => {
    const hit = found.find((entry) => entry.spec === spec);
    return hit ? tabs.find((tab) => tab.name === hit.tab) : undefined;
  };
  const problems: SheetProblem[] = [];
  const fatal: SheetProblem[] = [];
  const held = emptyHeld();

  function read<K extends string, R>(
    key: PosSetupSheetKey,
    spec: SheetSpec<K>,
    toRow: (values: Record<K, SheetValue>, problem: (column: string, message: string) => void) => R | null,
    keyOf: (values: Record<K, SheetValue>) => SheetMatchKey | null,
  ): PosSetupLine<R>[] | null {
    const tab = tabFor(spec);
    if (!tab) return null;
    const reading = readSheet(spec, tab.rows);
    if (reading.fatal) {
      fatal.push(reading.fatal);
      return [];
    }
    const rows: PosSetupLine<R>[] = [];
    for (const parsed of reading.rows) {
      const own: SheetProblem[] = [...parsed.problems];
      const row = toRow(parsed.values, (column, message) =>
        own.push({ sheet: spec.name, line: parsed.line, column, message }),
      );
      if (row !== null && own.length === 0) {
        rows.push({ line: parsed.line, row });
        continue;
      }
      problems.push(...own);
      const heldKey = keyOf(parsed.values);
      if (heldKey) held[key].push(heldKey);
    }
    return rows;
  }

  const text = (value: SheetValue): string => (typeof value === 'string' ? value : '');
  const nameOf = (value: SheetValue, problem: (column: string, message: string) => void): string | null => {
    const prepared = preparePosName(text(value));
    if ('refused' in prepared) {
      problem('Name', NAME_MESSAGE);
      return null;
    }
    return prepared.name;
  };
  const codeOf = (value: SheetValue, column: string, problem: (column: string, message: string) => void) => {
    const prepared = preparePosCode(text(value));
    if ('refused' in prepared) {
      problem(column, CODE_MESSAGE);
      return undefined;
    }
    return prepared.code;
  };
  const codeKey = (value: SheetValue): string | null => {
    const prepared = preparePosCode(text(value));
    return 'code' in prepared ? prepared.code : null;
  };
  const nameKeyOf = (value: SheetValue) => posSetupNameKey(text(value));

  const categories = read(
    'categories',
    POS_SETUP_SPECS.categories,
    (values, problem): PosSetupCategoryRow | null => {
      const name = nameOf(values.name, problem);
      if (name === null) return null;
      return { name, sortOrder: numberOrNull(values.sortOrder), archived: values.archived === true };
    },
    (values) => (text(values.name) ? { code: null, name: nameKeyOf(values.name) } : null),
  );

  const orderTypes = read(
    'orderTypes',
    POS_SETUP_SPECS.orderTypes,
    (values, problem): PosSetupOrderTypeRow | null => {
      const name = nameOf(values.name, problem);
      if (name === null) return null;
      return {
        name,
        sortOrder: numberOrNull(values.sortOrder),
        isDefault: values.isDefault === true,
        archived: values.archived === true,
      };
    },
    (values) => (text(values.name) ? { code: null, name: nameKeyOf(values.name) } : null),
  );

  const items = read(
    'items',
    POS_SETUP_SPECS.items,
    (values, problem): PosSetupItemRow | null => {
      const name = nameOf(values.name, problem);
      const code = codeOf(values.code, 'Code', problem);
      const description = preparePosDescription(text(values.description));
      if ('refused' in description) problem('Description', `One line, at most ${POS_DESCRIPTION_MAX} characters.`);
      const price = numberOrNull(values.price);
      const cost = numberOrNull(values.cost);
      if (price !== null && checkPosPrice(price)) problem('Price', priceMessage());
      if (checkPosCost(cost)) problem('Cost', priceMessage());
      const category = text(values.category).trim();
      if (name === null || code === undefined || 'refused' in description) return null;
      return {
        code,
        name,
        kind: values.kind === 'service' ? 'service' : 'product',
        category: category === '' ? null : category,
        description: description.description,
        price,
        cost,
        archived: values.archived === true,
      };
    },
    (values) =>
      text(values.name) || codeKey(values.code) ? { code: codeKey(values.code), name: nameKeyOf(values.name) } : null,
  );

  const variants = read(
    'variants',
    POS_SETUP_SPECS.variants,
    (values, problem): PosSetupVariantRow | null => {
      const name = nameOf(values.name, problem);
      const code = codeOf(values.code, 'Code', problem);
      const itemCode = codeOf(values.itemCode, 'Item code', problem);
      const itemName = text(values.itemName).trim();
      if (itemCode === null && itemName === '') problem('Item code', 'Give the Item code, or the Item name.');
      const price = numberOrNull(values.price);
      const cost = numberOrNull(values.cost);
      if (price !== null && checkPosPrice(price)) problem('Price', priceMessage());
      if (checkPosCost(cost)) problem('Cost', priceMessage());
      if (name === null || code === undefined || itemCode === undefined || price === null) return null;
      if (itemCode === null && itemName === '') return null;
      return {
        itemCode,
        itemName: itemName === '' ? null : itemName,
        code,
        name,
        price,
        cost,
        sortOrder: numberOrNull(values.sortOrder),
        archived: values.archived === true,
      };
    },
    // A size that did not read keeps only its code: its name means nothing without its item.
    (values) => (codeKey(values.code) ? { code: codeKey(values.code), name: '' } : null),
  );

  const references = read(
    'references',
    POS_SETUP_SPECS.references,
    (values): PosSetupReferenceRow => ({ option: text(values.option).trim(), isDefault: values.isDefault === true }),
    () => null,
  );

  return {
    input: { categories, orderTypes, items, variants, references, held },
    problems,
    fatal,
    missing: missing.map((spec) => spec.name),
  };
}

function numberOrNull(value: SheetValue): number | null {
  return typeof value === 'number' ? value : null;
}

function priceMessage(): string {
  return `From ₱0 to ₱${(POS_PRICE_MAX / 100).toLocaleString('en-PH')}.`;
}

function emptyHeld(): Record<PosSetupSheetKey, SheetMatchKey[]> {
  return { categories: [], orderTypes: [], items: [], variants: [], references: [] };
}

// ── the store, and the plan ─────────────────────────────────────────────────

/** The store's setup as it is: what the plan compares the file with. Archived rows included. */
export interface PosSetupStore {
  categories: { id: string; name: string; sortOrder: number; archived: boolean }[];
  orderTypes: { id: string; name: string; sortOrder: number; isDefault: boolean; archived: boolean }[];
  items: {
    id: string;
    code: string | null;
    name: string;
    kind: PosItemKind;
    categoryId: string | null;
    description: string | null;
    price: number;
    cost: number | null;
    archived: boolean;
  }[];
  variants: {
    id: string;
    itemId: string;
    code: string | null;
    name: string;
    price: number;
    cost: number | null;
    sortOrder: number;
    archived: boolean;
  }[];
  references: { options: readonly string[]; defaultReference: string | null };
}

type StoreCategory = PosSetupStore['categories'][number];
type StoreOrderType = PosSetupStore['orderTypes'][number];
type StoreItem = PosSetupStore['items'][number];
type StoreVariant = PosSetupStore['variants'][number];

/**
 * Where a size's item is: one already in the store, or a NEW one on a row of
 * the Items sheet (created first, so its sizes can join it).
 */
export type PosSetupItemRef = { kind: 'store'; id: string } | { kind: 'file'; line: number };

/** What one import will do, sheet by sheet, and everything wrong with it. */
export interface PosSetupPlan {
  categories: SheetPlan<PosSetupCategoryRow, StoreCategory> | null;
  orderTypes: SheetPlan<PosSetupOrderTypeRow, StoreOrderType> | null;
  items: SheetPlan<PosSetupItemRow, StoreItem> | null;
  variants: SheetPlan<PosSetupVariantRow, StoreVariant> | null;
  /** Each planned size's item, by the size's row number. */
  variantItems: Map<number, PosSetupItemRef>;
  /**
   * The reference list after the import, or null when the tab is not in the
   * file. ⚠ `changed` false: the list and its default are what the store has —
   * nothing is written, so importing a file twice changes nothing.
   */
  references: {
    options: string[];
    defaultReference: string | null;
    counts: PosSetupReferenceCounts;
    changed: boolean;
  } | null;
  /** Every problem: the file's rows against each other and against the store. */
  problems: SheetProblem[];
  /** Live items plus live sizes after the import: what `pos:items` counts. */
  liveAfter: number;
}

export interface PosSetupReferenceCounts {
  create: number;
  unchanged: number;
  archive: number;
  update: number;
}

/** How many categories and order types a store may keep, archived ones included (the catalogue's caps). */
export const POS_SETUP_CAPS = { categories: 200, orderTypes: 20, variantsPerItem: 100 } as const;

/**
 * The file against the store → what the import would do. Pure, and the SAME
 * on both sides: the browser plans to preview, the server plans again inside
 * its transaction and writes exactly this.
 *
 * Matching (`module-kit`'s planner): categories and order types by name;
 * items and sizes by code, else by name — a size's name within its item.
 * Never a guess: an ambiguous name or one thing twice in the file is an error
 * on the row. Replace archives what each sheet in the file leaves out, never
 * deletes, and never what a row with an error meant.
 */
export function planPosSetup(input: PosSetupInput, store: PosSetupStore, mode: SheetImportMode): PosSetupPlan {
  const problems: SheetProblem[] = [];
  const problem = (sheet: string, line: number | null, column: string | null, message: string) =>
    problems.push({ sheet, line, column, message });

  // ── categories and order types: by name ──
  const categories =
    input.categories === null
      ? null
      : planSheetImport({
          sheet: POS_SETUP_SHEET.categories,
          rows: input.categories,
          existing: store.categories,
          rowKey: (row) => ({ code: null, name: posSetupNameKey(row.name) }),
          existingKey: (row) => ({ code: null, name: posSetupNameKey(row.name) }),
          isUnchanged: (row, existing) =>
            row.name === existing.name &&
            (row.sortOrder === null || row.sortOrder === existing.sortOrder) &&
            row.archived === existing.archived,
          isArchived: (existing) => existing.archived,
          mode,
          held: input.held.categories,
        });

  const orderTypes =
    input.orderTypes === null
      ? null
      : planSheetImport({
          sheet: POS_SETUP_SHEET.orderTypes,
          rows: input.orderTypes,
          existing: store.orderTypes,
          rowKey: (row) => ({ code: null, name: posSetupNameKey(row.name) }),
          existingKey: (row) => ({ code: null, name: posSetupNameKey(row.name) }),
          isUnchanged: (row, existing) =>
            row.name === existing.name &&
            (row.sortOrder === null || row.sortOrder === existing.sortOrder) &&
            row.isDefault === existing.isDefault &&
            row.archived === existing.archived,
          isArchived: (existing) => existing.archived,
          mode,
          held: input.held.orderTypes,
        });
  if (input.orderTypes) {
    const defaults = input.orderTypes.filter((entry) => entry.row.isDefault);
    if (defaults.length > 1) {
      for (const entry of defaults) {
        problem(
          POS_SETUP_SHEET.orderTypes,
          entry.line,
          'Default',
          `Yes on more than one row (rows ${defaults.map((d) => d.line).join(', ')}).`,
        );
      }
    }
    for (const entry of defaults) {
      if (entry.row.archived)
        problem(POS_SETUP_SHEET.orderTypes, entry.line, 'Default', 'An archived order type cannot be the default.');
    }
  }

  // The categories that will exist, by name key: the store's, and the file's new ones.
  const categoryNames = new Set(store.categories.map((row) => posSetupNameKey(row.name)));
  for (const step of categories?.steps ?? []) categoryNames.add(posSetupNameKey(step.row.name));
  const categoryById = new Map(store.categories.map((row) => [row.id, row]));

  // ── items: by code, else by name ──
  const items =
    input.items === null
      ? null
      : planSheetImport({
          sheet: POS_SETUP_SHEET.items,
          rows: input.items,
          existing: store.items,
          rowKey: (row) => ({ code: row.code, name: posSetupNameKey(row.name) }),
          existingKey: (row) => ({ code: row.code, name: posSetupNameKey(row.name) }),
          isUnchanged: (row, existing) => {
            const category = existing.categoryId ? categoryById.get(existing.categoryId) : undefined;
            return (
              row.code === existing.code &&
              row.name === existing.name &&
              row.kind === existing.kind &&
              (row.category === null
                ? existing.categoryId === null
                : posSetupNameKey(row.category) === posSetupNameKey(category?.name ?? '')) &&
              row.description === existing.description &&
              (row.price === null || row.price === existing.price) &&
              row.cost === existing.cost &&
              row.archived === existing.archived
            );
          },
          isArchived: (existing) => existing.archived,
          mode,
          held: input.held.items,
        });
  for (const entry of input.items ?? []) {
    if (entry.row.category !== null && !categoryNames.has(posSetupNameKey(entry.row.category))) {
      problem(
        POS_SETUP_SHEET.items,
        entry.line,
        'Category',
        `No category named “${entry.row.category}”. Add it on the Categories sheet.`,
      );
    }
  }

  // Where each item of the file ends up: a store item (matched) or a new one (its row).
  const fileItemRef = new Map<number, PosSetupItemRef>();
  for (const step of items?.steps ?? []) {
    fileItemRef.set(
      step.line,
      step.kind === 'create' ? { kind: 'file', line: step.line } : { kind: 'store', id: step.existing.id },
    );
  }

  // ── sizes: their item first, then by code, else by name within the item ──
  const variantItems = new Map<number, PosSetupItemRef>();
  const resolvable: PosSetupLine<PosSetupVariantRow>[] = [];
  for (const entry of input.variants ?? []) {
    const found = findItem(entry.row, input.items ?? [], store.items, fileItemRef);
    if ('problem' in found) {
      problem(POS_SETUP_SHEET.variants, entry.line, entry.row.itemCode ? 'Item code' : 'Item name', found.problem);
      continue;
    }
    variantItems.set(entry.line, found.ref);
    resolvable.push(entry);
  }
  const refKey = (ref: PosSetupItemRef) => (ref.kind === 'store' ? `store:${ref.id}` : `file:${ref.line}`);
  const lineOf = new Map(resolvable.map((entry) => [entry.row, entry.line]));
  const variants =
    input.variants === null
      ? null
      : planSheetImport({
          sheet: POS_SETUP_SHEET.variants,
          rows: resolvable,
          existing: store.variants,
          rowKey: (row) => {
            const ref = variantItems.get(lineOf.get(row) ?? -1);
            return { code: row.code, name: `${ref ? refKey(ref) : '?'}\u0000${posSetupNameKey(row.name)}` };
          },
          existingKey: (row) => ({ code: row.code, name: `store:${row.itemId}\u0000${posSetupNameKey(row.name)}` }),
          isUnchanged: (row, existing) =>
            row.code === existing.code &&
            row.name === existing.name &&
            row.price === existing.price &&
            row.cost === existing.cost &&
            (row.sortOrder === null || row.sortOrder === existing.sortOrder) &&
            row.archived === existing.archived,
          isArchived: (existing) => existing.archived,
          mode,
          held: input.held.variants,
        });
  // A planned size must stay with the item it was found under: moving a size between items is not setup.
  for (const step of variants?.steps ?? []) {
    if (step.kind === 'create') continue;
    const ref = variantItems.get(step.line);
    if (ref?.kind === 'store' && ref.id !== step.existing.itemId) {
      problem(POS_SETUP_SHEET.variants, step.line, 'Code', 'This code belongs to a size of another item.');
    }
  }

  // ── an item's price may be blank only when it has sizes ──
  const itemsWithSizes = new Set<string>();
  for (const ref of variantItems.values()) itemsWithSizes.add(refKey(ref));
  for (const variant of store.variants) if (!variant.archived) itemsWithSizes.add(`store:${variant.itemId}`);
  for (const entry of input.items ?? []) {
    if (entry.row.price !== null) continue;
    const ref = fileItemRef.get(entry.line);
    if (!ref || !itemsWithSizes.has(refKey(ref))) {
      problem(POS_SETUP_SHEET.items, entry.line, 'Price', 'Price is required for an item without sizes.');
    }
  }

  checkCodes(input, store, items, variants, problem);
  checkCaps(store, categories, orderTypes, variants, variantItems, problem);

  const references =
    input.references === null ? null : planReferences(input.references, store.references, mode, problem);

  return {
    categories,
    orderTypes,
    items,
    variants,
    variantItems,
    references,
    problems: [
      ...(categories?.problems ?? []),
      ...(orderTypes?.problems ?? []),
      ...(items?.problems ?? []),
      ...(variants?.problems ?? []),
      ...problems,
    ],
    liveAfter: liveAfter(store, items, variants),
  };
}

function findItem(
  row: PosSetupVariantRow,
  fileItems: readonly PosSetupLine<PosSetupItemRow>[],
  storeItems: readonly StoreItem[],
  fileItemRef: ReadonlyMap<number, PosSetupItemRef>,
): { ref: PosSetupItemRef } | { problem: string } {
  // The file's own items first: a row there is the item as it is about to be.
  const inFile = row.itemCode
    ? fileItems.filter((entry) => entry.row.code === row.itemCode)
    : fileItems.filter((entry) => posSetupNameKey(entry.row.name) === posSetupNameKey(row.itemName ?? ''));
  if (inFile.length > 1) return { problem: 'More than one row on the Items sheet matches. Use the Item code.' };
  const fileEntry = inFile[0];
  if (fileEntry) {
    const ref = fileItemRef.get(fileEntry.line);
    return ref ? { ref } : { problem: `Its item, on Items row ${fileEntry.line}, has an error.` };
  }
  const inStore = row.itemCode
    ? storeItems.filter((item) => item.code === row.itemCode)
    : storeItems.filter((item) => posSetupNameKey(item.name) === posSetupNameKey(row.itemName ?? ''));
  if (inStore.length > 1) return { problem: 'More than one item in the store has this name. Use the Item code.' };
  const storeItem = inStore[0];
  if (storeItem) return { ref: { kind: 'store', id: storeItem.id } };
  return {
    problem: row.itemCode
      ? `No item with the code ${row.itemCode} on the Items sheet or in the store.`
      : `No item named “${row.itemName}” on the Items sheet or in the store.`,
  };
}

/**
 * ⚠ CODES ARE UNIQUE ACROSS ITEMS AND SIZES TOGETHER (a scan finds one thing).
 * The planner already refuses one code twice on one sheet; this refuses an
 * item's code on a size, in the file or in the store, and the reverse.
 */
function checkCodes(
  input: PosSetupInput,
  store: PosSetupStore,
  items: PosSetupPlan['items'],
  variants: PosSetupPlan['variants'],
  problem: (sheet: string, line: number | null, column: string | null, message: string) => void,
): void {
  const itemCodes = new Map<string, number>();
  for (const entry of input.items ?? []) if (entry.row.code) itemCodes.set(entry.row.code, entry.line);
  const variantCodes = new Map<string, number>();
  for (const entry of input.variants ?? []) if (entry.row.code) variantCodes.set(entry.row.code, entry.line);

  for (const [code, line] of itemCodes) {
    const sizeLine = variantCodes.get(code);
    if (sizeLine !== undefined) {
      problem(POS_SETUP_SHEET.items, line, 'Code', `Variants row ${sizeLine} has this code too.`);
      problem(POS_SETUP_SHEET.variants, sizeLine, 'Code', `Items row ${line} has this code too.`);
    }
  }
  // Against the store: a code another table already holds, on a row that is not being renamed away.
  const updatedVariantIds = new Set(
    (variants?.steps ?? []).flatMap((step) => (step.kind === 'create' ? [] : [step.existing.id])),
  );
  const updatedItemIds = new Set(
    (items?.steps ?? []).flatMap((step) => (step.kind === 'create' ? [] : [step.existing.id])),
  );
  for (const [code, line] of itemCodes) {
    if (variantCodes.has(code)) continue;
    const held = store.variants.find((variant) => variant.code === code);
    if (held && !(updatedVariantIds.has(held.id) && !variantCodesAfter(input, held.id, variants).has(code))) {
      problem(POS_SETUP_SHEET.items, line, 'Code', 'A size in the store already has this code.');
    }
  }
  for (const [code, line] of variantCodes) {
    if (itemCodes.has(code)) continue;
    const held = store.items.find((item) => item.code === code);
    if (held && !(updatedItemIds.has(held.id) && !itemCodesAfter(input, held.id, items).has(code))) {
      problem(POS_SETUP_SHEET.variants, line, 'Code', 'An item in the store already has this code.');
    }
  }
}

function variantCodesAfter(input: PosSetupInput, id: string, variants: PosSetupPlan['variants']): Set<string> {
  const step = variants?.steps.find((one) => one.kind !== 'create' && one.existing.id === id);
  const code = step ? input.variants?.find((entry) => entry.line === step.line)?.row.code : null;
  return new Set(code ? [code] : []);
}

function itemCodesAfter(input: PosSetupInput, id: string, items: PosSetupPlan['items']): Set<string> {
  const step = items?.steps.find((one) => one.kind !== 'create' && one.existing.id === id);
  const code = step ? input.items?.find((entry) => entry.line === step.line)?.row.code : null;
  return new Set(code ? [code] : []);
}

/** The caps the catalogue holds on every save, held here for the whole file. */
function checkCaps(
  store: PosSetupStore,
  categories: PosSetupPlan['categories'],
  orderTypes: PosSetupPlan['orderTypes'],
  variants: PosSetupPlan['variants'],
  variantItems: ReadonlyMap<number, PosSetupItemRef>,
  problem: (sheet: string, line: number | null, column: string | null, message: string) => void,
): void {
  const created = (plan: { steps: { kind: string }[] } | null) =>
    (plan?.steps ?? []).filter((step) => step.kind === 'create').length;
  if (store.categories.length + created(categories) > POS_SETUP_CAPS.categories) {
    problem(
      POS_SETUP_SHEET.categories,
      null,
      null,
      `A store keeps at most ${POS_SETUP_CAPS.categories} categories, archived ones included.`,
    );
  }
  if (store.orderTypes.length + created(orderTypes) > POS_SETUP_CAPS.orderTypes) {
    problem(
      POS_SETUP_SHEET.orderTypes,
      null,
      null,
      `A store keeps at most ${POS_SETUP_CAPS.orderTypes} order types, archived ones included.`,
    );
  }
  if (!variants) return;
  // Sizes per item after the import: the store's, plus the file's new ones.
  const perItem = new Map<string, number>();
  const key = (ref: PosSetupItemRef) => (ref.kind === 'store' ? `store:${ref.id}` : `file:${ref.line}`);
  for (const variant of store.variants)
    perItem.set(`store:${variant.itemId}`, (perItem.get(`store:${variant.itemId}`) ?? 0) + 1);
  for (const step of variants.steps) {
    if (step.kind !== 'create') continue;
    const ref = variantItems.get(step.line);
    if (ref) perItem.set(key(ref), (perItem.get(key(ref)) ?? 0) + 1);
  }
  for (const step of variants.steps) {
    const ref = variantItems.get(step.line);
    if (ref && (perItem.get(key(ref)) ?? 0) > POS_SETUP_CAPS.variantsPerItem) {
      problem(
        POS_SETUP_SHEET.variants,
        step.line,
        null,
        `An item has at most ${POS_SETUP_CAPS.variantsPerItem} sizes.`,
      );
    }
  }
}

/** Live items and live sizes of live items after the import — what `pos:items` counts. */
function liveAfter(store: PosSetupStore, items: PosSetupPlan['items'], variants: PosSetupPlan['variants']): number {
  const itemArchived = new Map(store.items.map((item) => [item.id, item.archived]));
  for (const step of items?.steps ?? []) {
    if (step.kind !== 'create') itemArchived.set(step.existing.id, step.row.archived);
  }
  for (const item of items?.archive ?? []) itemArchived.set(item.id, true);
  let count = [...itemArchived.values()].filter((archived) => !archived).length;
  count += (items?.steps ?? []).filter((step) => step.kind === 'create' && !step.row.archived).length;

  const variantArchived = new Map(store.variants.map((variant) => [variant.id, variant.archived]));
  for (const step of variants?.steps ?? []) {
    if (step.kind !== 'create') variantArchived.set(step.existing.id, step.row.archived);
  }
  for (const variant of variants?.archive ?? []) variantArchived.set(variant.id, true);
  for (const variant of store.variants) {
    if (!variantArchived.get(variant.id) && !itemArchived.get(variant.itemId)) count += 1;
  }
  // New sizes count when they are live; a new size of an archived item is rare enough to count.
  count += (variants?.steps ?? []).filter((step) => step.kind === 'create' && !step.row.archived).length;
  return count;
}

/**
 * The reference list after the import. Add and update keeps the store's
 * options and adds the file's new ones; Replace makes the list the file's.
 * At most one Default; a file with none keeps the store's default while it is
 * still an option.
 */
function planReferences(
  rows: readonly PosSetupLine<PosSetupReferenceRow>[],
  current: PosSetupStore['references'],
  mode: SheetImportMode,
  problem: (sheet: string, line: number | null, column: string | null, message: string) => void,
): PosSetupPlan['references'] {
  const sheet = POS_SETUP_SHEET.references;
  const defaults = rows.filter((entry) => entry.row.isDefault);
  if (defaults.length > 1) {
    for (const entry of defaults)
      problem(
        sheet,
        entry.line,
        'Default',
        `Yes on more than one row (rows ${defaults.map((d) => d.line).join(', ')}).`,
      );
  }
  const currentKeys = new Set(current.options.map(posReferenceKey));
  const fileKeys = new Set(rows.map((entry) => posReferenceKey(entry.row.option)));
  const added = rows.filter((entry) => !currentKeys.has(posReferenceKey(entry.row.option)));
  const options =
    mode === 'replace'
      ? rows.map((entry) => entry.row.option)
      : [...current.options, ...added.map((entry) => entry.row.option)];
  const checked = validateReferenceOptions(options);
  if ('refused' in checked) {
    for (const message of checked.refused) problem(sheet, null, null, message);
    return null;
  }
  const chosen = defaults[0]?.row.option ?? current.defaultReference;
  const defaultReference = readDefaultReference(checked.options, chosen);
  const archive =
    mode === 'replace' ? current.options.filter((option) => !fileKeys.has(posReferenceKey(option))).length : 0;
  const update = defaultReference !== current.defaultReference ? 1 : 0;
  const changed =
    defaultReference !== current.defaultReference ||
    checked.options.length !== current.options.length ||
    checked.options.some((option, index) => option !== current.options[index]);
  return {
    options: [...checked.options],
    defaultReference,
    counts: { create: added.length, unchanged: rows.length - added.length, archive, update },
    changed,
  };
}

// ── export ──────────────────────────────────────────────────────────────────

/** A row as `@kwtech/web-ui`'s `writeWorkbook` takes it, in the module's units (money in centavos). */
export type PosSetupExportRow = Record<string, string | number | boolean | null>;

/**
 * The store → each sheet's rows, for the export. With `includeArchived` off,
 * archived rows — and the sizes of archived items — are left out.
 */
export function posSetupExportRows(
  store: PosSetupStore,
  includeArchived: boolean,
): Record<PosSetupSheetKey, PosSetupExportRow[]> {
  const keep = (row: { archived: boolean }) => includeArchived || !row.archived;
  const categoryName = new Map(store.categories.map((row) => [row.id, row.name]));
  const itemById = new Map(store.items.map((item) => [item.id, item]));
  const bySort = <T extends { sortOrder: number; name: string }>(a: T, b: T) =>
    a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

  return {
    categories: [...store.categories]
      .filter(keep)
      .sort(bySort)
      .map((row) => ({ name: row.name, sortOrder: row.sortOrder, archived: row.archived })),
    orderTypes: [...store.orderTypes]
      .filter(keep)
      .sort(bySort)
      .map((row) => ({ name: row.name, sortOrder: row.sortOrder, isDefault: row.isDefault, archived: row.archived })),
    items: [...store.items]
      .filter(keep)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => ({
        code: item.code,
        name: item.name,
        kind: item.kind,
        category: item.categoryId ? (categoryName.get(item.categoryId) ?? null) : null,
        description: item.description,
        price: item.price,
        cost: item.cost,
        archived: item.archived,
      })),
    variants: [...store.variants]
      .filter((variant) => keep(variant) && (includeArchived || !itemById.get(variant.itemId)?.archived))
      .sort(
        (a, b) =>
          (itemById.get(a.itemId)?.name ?? '').localeCompare(itemById.get(b.itemId)?.name ?? '') ||
          a.sortOrder - b.sortOrder,
      )
      .map((variant) => {
        const item = itemById.get(variant.itemId);
        return {
          itemCode: item?.code ?? null,
          // The name only when the item has no code: a code is how the import finds it.
          itemName: item && !item.code ? item.name : null,
          code: variant.code,
          name: variant.name,
          price: variant.price,
          cost: variant.cost,
          sortOrder: variant.sortOrder,
          archived: variant.archived,
        };
      }),
    references: store.references.options.map((option) => ({
      option,
      isDefault: option === store.references.defaultReference,
    })),
  };
}

// ── the server's second look ───────────────────────────────────────────────

/** The most rows one sheet of an import may carry: a store's setup is hundreds, not tens of thousands. */
export const POS_SETUP_ROWS_MAX = 10_000;

/**
 * The typed rows a mutation received, checked AGAIN with the rules the reader
 * used — ⚠ the server never trusts that they came from `readPosSetup`. A row
 * that does not survive its own rules (a name with a control character, a code
 * in lower case, a price out of range) is a problem on its line, as in the
 * browser. Empty: the rows are what the reader would have produced.
 */
export function checkPosSetupInput(input: PosSetupInput): SheetProblem[] {
  const problems: SheetProblem[] = [];
  const sheetProblem = (sheet: string, message: string) => problems.push({ sheet, line: null, column: null, message });
  const rowProblem = (sheet: string, line: number, column: string, message: string) =>
    problems.push({ sheet, line, column, message });

  const sheets: [string, readonly PosSetupLine<unknown>[] | null][] = [
    [POS_SETUP_SHEET.categories, input.categories],
    [POS_SETUP_SHEET.orderTypes, input.orderTypes],
    [POS_SETUP_SHEET.items, input.items],
    [POS_SETUP_SHEET.variants, input.variants],
    [POS_SETUP_SHEET.references, input.references],
  ];
  for (const [sheet, rows] of sheets) {
    if (rows === null) continue;
    if (rows.length > POS_SETUP_ROWS_MAX) sheetProblem(sheet, `At most ${POS_SETUP_ROWS_MAX} rows.`);
    const lines = new Set<number>();
    for (const entry of rows) {
      if (!Number.isSafeInteger(entry.line) || entry.line < 2 || lines.has(entry.line)) {
        sheetProblem(sheet, 'The rows are not numbered as a file’s are.');
        break;
      }
      lines.add(entry.line);
    }
  }
  for (const key of Object.keys(input.held) as PosSetupSheetKey[]) {
    if (input.held[key].length > POS_SETUP_ROWS_MAX) sheetProblem(POS_SETUP_SHEET[key], 'Too many rows held back.');
  }

  const sameName = (name: string) => {
    const prepared = preparePosName(name);
    return 'name' in prepared && prepared.name === name;
  };
  const sameCode = (code: string | null) => {
    if (code === null) return true;
    const prepared = preparePosCode(code);
    return 'code' in prepared && prepared.code === code;
  };
  const sortOk = (sortOrder: number | null) => sortOrder === null || Number.isSafeInteger(sortOrder);

  for (const { line, row } of input.categories ?? []) {
    if (!sameName(row.name)) rowProblem(POS_SETUP_SHEET.categories, line, 'Name', NAME_MESSAGE);
    if (!sortOk(row.sortOrder)) rowProblem(POS_SETUP_SHEET.categories, line, 'Sort order', 'Write a whole number.');
  }
  for (const { line, row } of input.orderTypes ?? []) {
    if (!sameName(row.name)) rowProblem(POS_SETUP_SHEET.orderTypes, line, 'Name', NAME_MESSAGE);
    if (!sortOk(row.sortOrder)) rowProblem(POS_SETUP_SHEET.orderTypes, line, 'Sort order', 'Write a whole number.');
  }
  for (const { line, row } of input.items ?? []) {
    const sheet = POS_SETUP_SHEET.items;
    if (!sameName(row.name)) rowProblem(sheet, line, 'Name', NAME_MESSAGE);
    if (!sameCode(row.code)) rowProblem(sheet, line, 'Code', CODE_MESSAGE);
    if (row.kind !== 'product' && row.kind !== 'service') rowProblem(sheet, line, 'Kind', 'Choose product or service.');
    if (row.category !== null && !sameName(row.category)) rowProblem(sheet, line, 'Category', NAME_MESSAGE);
    const description = preparePosDescription(row.description ?? '');
    if (!('description' in description) || description.description !== row.description) {
      rowProblem(sheet, line, 'Description', `One line, at most ${POS_DESCRIPTION_MAX} characters.`);
    }
    if (row.price !== null && checkPosPrice(row.price)) rowProblem(sheet, line, 'Price', priceMessage());
    if (checkPosCost(row.cost)) rowProblem(sheet, line, 'Cost', priceMessage());
  }
  for (const { line, row } of input.variants ?? []) {
    const sheet = POS_SETUP_SHEET.variants;
    if (!sameName(row.name)) rowProblem(sheet, line, 'Name', NAME_MESSAGE);
    if (!sameCode(row.code)) rowProblem(sheet, line, 'Code', CODE_MESSAGE);
    if (!sameCode(row.itemCode)) rowProblem(sheet, line, 'Item code', CODE_MESSAGE);
    if (row.itemCode === null && !row.itemName)
      rowProblem(sheet, line, 'Item code', 'Give the Item code, or the Item name.');
    if (checkPosPrice(row.price)) rowProblem(sheet, line, 'Price', priceMessage());
    if (checkPosCost(row.cost)) rowProblem(sheet, line, 'Cost', priceMessage());
    if (!sortOk(row.sortOrder)) rowProblem(sheet, line, 'Sort order', 'Write a whole number.');
  }
  return problems;
}
