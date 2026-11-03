import {
  POS_SETUP_SHEET,
  type PosSetupInput,
  type PosSetupStore,
  type PosSetupTab,
  planPosSetup,
  posSetupExportRows,
  readPosSetup,
} from '../src/domain/setup.js';
import { tab } from './setup-tabs.js';

const EMPTY: PosSetupStore = {
  categories: [],
  orderTypes: [],
  items: [],
  variants: [],
  references: { options: [], defaultReference: null },
};

function inputOf(tabs: PosSetupTab[]): PosSetupInput {
  const reading = readPosSetup(tabs);
  expect(reading.fatal).toEqual([]);
  expect(reading.problems).toEqual([]);
  return reading.input;
}

const kinds = (plan: { steps: { kind: string }[] } | null) => (plan?.steps ?? []).map((step) => step.kind);

/** The setup a new café fills in. */
const CAFE_TABS = [
  tab('categories', [{ name: 'Drinks' }, { name: 'Food', sortOrder: 2 }]),
  tab('orderTypes', [{ name: 'Dine-in', isDefault: true }, { name: 'Takeout' }]),
  tab('items', [
    { code: 'lat', name: 'Latte', kind: 'product', category: 'drinks', price: 12000, cost: 4500 },
    { name: 'Tea', category: 'Drinks', price: null },
    { name: 'Cake', kind: 'Product', category: 'Food', price: 9500 },
  ]),
  tab('variants', [
    { itemName: 'Tea', name: 'Small', price: 6000, sortOrder: 0 },
    { itemName: 'tea', name: 'Large', code: 'tea-l', price: 8000, sortOrder: 1 },
    { itemCode: 'LAT', name: 'Iced', price: 13000 },
  ]),
  tab('references', [{ option: 'Table 1' }, { option: 'Table 2', isDefault: true }]),
];

describe('reading a setup file (issue #35)', () => {
  it('types every row: pesos to centavos, codes upper-cased, choices and yes/no read', () => {
    const { input, missing } = readPosSetup(CAFE_TABS);
    expect(missing).toEqual([]);
    expect(input.items?.[0]).toEqual({
      line: 2,
      row: {
        code: 'LAT',
        name: 'Latte',
        kind: 'product',
        category: 'drinks',
        description: null,
        price: 12000,
        cost: 4500,
        archived: false,
      },
    });
    expect(input.items?.[2]?.row.kind).toBe('product');
    expect(input.variants?.[1]?.row).toMatchObject({ itemName: 'tea', code: 'TEA-L', price: 8000, sortOrder: 1 });
    expect(input.orderTypes?.[0]?.row).toEqual({ name: 'Dine-in', sortOrder: null, isDefault: true, archived: false });
    expect(input.references?.map((entry) => entry.row)).toEqual([
      { option: 'Table 1', isDefault: false },
      { option: 'Table 2', isDefault: true },
    ]);
  });

  it('⚠ reads a tab missing from the file as LEFT ALONE (null), never as empty', () => {
    const reading = readPosSetup([tab('items', [{ name: 'Latte', price: 100 }])]);
    expect(reading.input.categories).toBeNull();
    expect(reading.input.items).toHaveLength(1);
    expect(reading.missing).toEqual([
      POS_SETUP_SHEET.categories,
      POS_SETUP_SHEET.orderTypes,
      POS_SETUP_SHEET.variants,
      POS_SETUP_SHEET.references,
    ]);
  });

  it('puts each problem on its sheet, row and column, keeps the good rows, and holds the bad rows’ keys', () => {
    const reading = readPosSetup([
      tab('items', [
        { code: 'OK', name: 'Fine', price: 100 },
        { code: 'BAD CODE!', name: 'Broken', price: 100 },
        { code: 'C2', name: 'Pricey', price: 'lots' },
      ]),
      tab('variants', [{ name: 'Orphan', price: 100 }]),
    ]);
    expect(reading.input.items?.map((entry) => entry.row.name)).toEqual(['Fine']);
    expect(reading.problems.map((problem) => [problem.sheet, problem.line, problem.column])).toEqual([
      ['Items', 3, 'Code'],
      ['Items', 4, 'Price'],
      ['Variants', 2, 'Item code'],
    ]);
    // Row 4's code read, so Replace will not archive the item it meant.
    expect(reading.input.held.items).toContainEqual({ code: 'C2', name: 'pricey' });
  });

  it('refuses a whole tab whose required heading is missing', () => {
    const broken: PosSetupTab = { name: 'Items', rows: [{ line: 1, cells: ['Code', 'Price'] }] };
    expect(readPosSetup([broken]).fatal.map((problem) => problem.message)).toEqual(['Missing heading(s): Name.']);
  });
});

describe('planning a setup into an empty store', () => {
  it('creates everything, sizes joining the new items they name', () => {
    const plan = planPosSetup(inputOf(CAFE_TABS), EMPTY, 'merge');
    expect(plan.problems).toEqual([]);
    expect(kinds(plan.categories)).toEqual(['create', 'create']);
    expect(kinds(plan.items)).toEqual(['create', 'create', 'create']);
    expect(kinds(plan.variants)).toEqual(['create', 'create', 'create']);
    expect([...plan.variantItems.values()]).toEqual([
      { kind: 'file', line: 3 },
      { kind: 'file', line: 3 },
      { kind: 'file', line: 2 },
    ]);
    expect(plan.references).toEqual({
      options: ['Table 1', 'Table 2'],
      defaultReference: 'Table 2',
      counts: { create: 2, unchanged: 0, archive: 0, update: 1 },
      changed: true,
    });
    // 3 items and 3 sizes for sale.
    expect(plan.liveAfter).toBe(6);
  });

  it('⚠ refuses a category nobody has, a blank price on an item without sizes, and a size with no item', () => {
    const plan = planPosSetup(
      inputOf([
        tab('items', [
          { name: 'Latte', category: 'Drinks', price: 100 },
          { name: 'Tea', price: null },
        ]),
        tab('variants', [{ itemName: 'Coffee', name: 'Large', price: 100 }]),
      ]),
      EMPTY,
      'merge',
    );
    expect(plan.problems.map((problem) => [problem.sheet, problem.line, problem.message])).toEqual([
      ['Items', 2, 'No category named “Drinks”. Add it on the Categories sheet.'],
      ['Variants', 2, 'No item named “Coffee” on the Items sheet or in the store.'],
      ['Items', 3, 'Price is required for an item without sizes.'],
    ]);
  });

  it('⚠ refuses one code on an item and a size — a scan must find one thing', () => {
    const plan = planPosSetup(
      inputOf([
        tab('items', [{ code: 'X1', name: 'Latte', price: 100 }]),
        tab('variants', [{ itemCode: 'X1', code: 'x1', name: 'Large', price: 100 }]),
      ]),
      EMPTY,
      'merge',
    );
    expect(plan.problems.map((problem) => problem.message)).toEqual([
      'Variants row 2 has this code too.',
      'Items row 2 has this code too.',
    ]);
  });

  it('refuses two default order types, and an archived default', () => {
    const plan = planPosSetup(
      inputOf([
        tab('orderTypes', [
          { name: 'Dine-in', isDefault: true },
          { name: 'Takeout', isDefault: true, archived: true },
        ]),
      ]),
      EMPTY,
      'merge',
    );
    expect(plan.problems.map((problem) => [problem.line, problem.message])).toEqual([
      [2, 'Yes on more than one row (rows 2, 3).'],
      [3, 'Yes on more than one row (rows 2, 3).'],
      [3, 'An archived order type cannot be the default.'],
    ]);
  });

  it('holds the caps: order types, archived ones included', () => {
    const store = {
      ...EMPTY,
      orderTypes: Array.from({ length: 20 }, (_, index) => ({
        id: `t${index}`,
        name: `Type ${index}`,
        sortOrder: index,
        isDefault: false,
        archived: index > 10,
      })),
    };
    const plan = planPosSetup(inputOf([tab('orderTypes', [{ name: 'One more' }])]), store, 'merge');
    expect(plan.problems.map((problem) => problem.message)).toEqual([
      'A store keeps at most 20 order types, archived ones included.',
    ]);
  });
});

// A store that already sells: the shape `PosSetupStore` takes from the catalogue.
const STORE: PosSetupStore = {
  categories: [
    { id: 'c1', name: 'Drinks', sortOrder: 0, archived: false },
    { id: 'c2', name: 'Old', sortOrder: 1, archived: true },
  ],
  orderTypes: [{ id: 't1', name: 'Dine-in', sortOrder: 0, isDefault: true, archived: false }],
  items: [
    {
      id: 'i1',
      code: 'LAT',
      name: 'Latte',
      kind: 'product',
      categoryId: 'c1',
      description: null,
      price: 12000,
      cost: 4500,
      archived: false,
    },
    {
      id: 'i2',
      code: null,
      name: 'Tea',
      kind: 'product',
      categoryId: 'c1',
      description: 'Hot or iced.',
      price: 0,
      cost: null,
      archived: false,
    },
    {
      id: 'i3',
      code: 'MUG',
      name: 'Mug',
      kind: 'product',
      categoryId: null,
      description: null,
      price: 30000,
      cost: null,
      archived: false,
    },
  ],
  variants: [
    { id: 'v1', itemId: 'i2', code: null, name: 'Small', price: 6000, cost: null, sortOrder: 0, archived: false },
    { id: 'v2', itemId: 'i2', code: 'TEA-L', name: 'Large', price: 8000, cost: null, sortOrder: 1, archived: false },
  ],
  references: { options: ['Table 1', 'Table 2'], defaultReference: 'Table 1' },
};

/** The store's own export, as the file a person downloads holds it. */
function exported(store: PosSetupStore, includeArchived = true): PosSetupTab[] {
  const rows = posSetupExportRows(store, includeArchived);
  return (['categories', 'orderTypes', 'items', 'variants', 'references'] as const).map((key) => tab(key, rows[key]));
}

describe('planning against a store that already sells', () => {
  it('⚠ is idempotent: importing the store’s own export changes nothing, even in Replace', () => {
    const plan = planPosSetup(inputOf(exported(STORE)), STORE, 'replace');
    expect(plan.problems).toEqual([]);
    for (const sheet of [plan.categories, plan.orderTypes, plan.items, plan.variants]) {
      expect(sheet?.steps.every((step) => step.kind === 'unchanged')).toBe(true);
      expect(sheet?.archive).toEqual([]);
    }
    expect(plan.references?.counts).toEqual({ create: 0, unchanged: 2, archive: 0, update: 0 });
    expect(plan.references?.changed).toBe(false);
  });

  it('round-trips archived rows: they export as archived and import unchanged', () => {
    const rows = posSetupExportRows(STORE, true);
    expect(rows.categories).toContainEqual({ name: 'Old', sortOrder: 1, archived: true });
    expect(posSetupExportRows(STORE, false).categories.map((row) => row.name)).toEqual(['Drinks']);
  });

  it('updates by code, and by name when there is no code; a size by its name within its item', () => {
    const plan = planPosSetup(
      inputOf([
        tab('items', [
          { code: 'LAT', name: 'Latte', category: 'Drinks', price: 12500, cost: 4500 },
          { name: 'TEA', category: 'drinks', description: 'Hot or iced.', price: null },
        ]),
        tab('variants', [{ itemName: 'Tea', name: 'small', price: 6500, sortOrder: 0 }]),
      ]),
      STORE,
      'merge',
    );
    expect(plan.problems).toEqual([]);
    expect(plan.items?.steps.map((step) => [step.kind, 'existing' in step ? step.existing.id : null])).toEqual([
      ['update', 'i1'],
      ['update', 'i2'],
    ]);
    expect(plan.variants?.steps.map((step) => [step.kind, 'existing' in step ? step.existing.id : null])).toEqual([
      ['update', 'v1'],
    ]);
    expect(plan.items?.archive).toEqual([]);
  });

  it('Replace archives what each sheet in the file leaves out — and ⚠ never touches a sheet not in the file', () => {
    const plan = planPosSetup(
      inputOf([tab('items', [{ code: 'LAT', name: 'Latte', category: 'Drinks', price: 12000, cost: 4500 }])]),
      STORE,
      'replace',
    );
    expect(plan.items?.archive.map((item) => item.id)).toEqual(['i2', 'i3']);
    expect(plan.categories).toBeNull();
    expect(plan.variants).toBeNull();
    // Latte stays; Tea and Mug are archived, and so — counted — are Tea's sizes, being an archived item's.
    expect(plan.liveAfter).toBe(1);
  });

  it('refuses a code a size in the store already holds', () => {
    const plan = planPosSetup(
      inputOf([tab('items', [{ code: 'TEA-L', name: 'Tea latte', price: 100 }])]),
      STORE,
      'merge',
    );
    expect(plan.problems.map((problem) => problem.message)).toEqual(['A size in the store already has this code.']);
  });

  it('refuses a size whose code belongs to another item’s size', () => {
    const plan = planPosSetup(
      inputOf([tab('variants', [{ itemCode: 'LAT', code: 'TEA-L', name: 'Large', price: 100 }])]),
      STORE,
      'merge',
    );
    expect(plan.problems.map((problem) => problem.message)).toEqual(['This code belongs to a size of another item.']);
  });

  it('references: Add and update keeps the store’s options; Replace makes the list the file’s', () => {
    const file = inputOf([tab('references', [{ option: 'Table 3', isDefault: true }])]);
    expect(planPosSetup(file, STORE, 'merge').references).toEqual({
      options: ['Table 1', 'Table 2', 'Table 3'],
      defaultReference: 'Table 3',
      counts: { create: 1, unchanged: 0, archive: 0, update: 1 },
      changed: true,
    });
    expect(planPosSetup(file, STORE, 'replace').references).toEqual({
      options: ['Table 3'],
      defaultReference: 'Table 3',
      counts: { create: 1, unchanged: 0, archive: 2, update: 1 },
      changed: true,
    });
  });
});
