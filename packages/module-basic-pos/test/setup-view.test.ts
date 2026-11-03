import { planPosSetup, readPosSetup } from '../src/domain/setup.js';
import type { PosCatalogueView, PosItemView } from '../src/react/pos-client.js';
import {
  SETUP_SHEET_NAMES,
  setupExport,
  setupMutationInput,
  setupPreview,
  setupStore,
  setupTemplate,
} from '../src/react/view/setup.js';
import { tab } from './setup-tabs.js';

function item(id: string, name: string, patch: Partial<PosItemView> = {}): PosItemView {
  return {
    id,
    kind: 'product',
    name,
    code: null,
    description: null,
    price: 1000,
    cost: null,
    categoryId: null,
    archivedAt: null,
    unavailableAt: null,
    variants: [],
    ...patch,
  };
}

const CATALOGUE: PosCatalogueView = {
  costsVisible: true,
  categories: [{ id: 'c1', name: 'Drinks', sortOrder: 0, archivedAt: null }],
  orderTypes: [{ id: 't1', name: 'Dine-in', sortOrder: 0, isDefault: true, archivedAt: null }],
  items: [
    item('i1', 'Latte', { code: 'LAT', categoryId: 'c1', price: 12000, cost: 4500 }),
    item('i2', 'Tea', {
      variants: [
        {
          id: 'v1',
          itemId: 'i2',
          name: 'Large',
          code: 'TEA-L',
          price: 8000,
          cost: null,
          sortOrder: 0,
          archivedAt: null,
          unavailableAt: null,
        },
      ],
    }),
  ],
};
const SETTINGS = { referenceOptions: ['Table 1'], defaultReference: null };

describe('the Items tab’s Excel import and export (issue #35)', () => {
  it('reads the store from the catalogue as Items loads it, archived rows included', () => {
    const store = setupStore(CATALOGUE, SETTINGS);
    expect(store.items.map((row) => [row.id, row.code, row.archived])).toEqual([
      ['i1', 'LAT', false],
      ['i2', null, false],
    ]);
    expect(store.variants).toEqual([
      { id: 'v1', itemId: 'i2', code: 'TEA-L', name: 'Large', price: 8000, cost: null, sortOrder: 0, archived: false },
    ]);
    expect(store.references).toEqual({ options: ['Table 1'], defaultReference: null });
  });

  it('previews per tab: counts, each problem on its row, Replace’s archive by name, and the tabs left alone', () => {
    const store = setupStore(CATALOGUE, SETTINGS);
    const read = readPosSetup([
      tab('items', [
        { code: 'LAT', name: 'Latte', category: 'Drinks', price: 12500, cost: 4500 },
        { name: 'Cake', price: 'free' },
      ]),
    ]);
    const preview = setupPreview(read, planPosSetup(read.input, store, 'replace'), store);
    expect(preview.fatal).toEqual([]);
    const items = preview.sheets.find((sheet) => sheet.name === 'Items');
    expect(items).toEqual({
      name: 'Items',
      missing: false,
      counts: { create: 0, update: 1, unchanged: 0, archive: 1, errors: 1 },
      problems: [{ line: 3, column: 'Price', message: 'Write an amount in pesos, like 12.50.' }],
      archived: ['Tea'],
    });
    expect(preview.sheets.filter((sheet) => sheet.missing).map((sheet) => sheet.name)).toEqual([
      'Categories',
      'Order types',
      'Variants',
      'References',
    ]);
  });

  it('⚠ makes a problem with a whole tab fatal: a heading missing, or a cap', () => {
    const store = setupStore(CATALOGUE, SETTINGS);
    const read = readPosSetup([{ name: 'Items', rows: [{ line: 1, cells: ['Code'] }] }]);
    const preview = setupPreview(read, planPosSetup(read.input, store, 'merge'), store);
    expect(preview.fatal).toEqual(['Items: Missing heading(s): Name.']);
  });

  it('names an archived size by its item', () => {
    const store = setupStore(CATALOGUE, SETTINGS);
    const read = readPosSetup([tab('variants', [])]);
    const preview = setupPreview(read, planPosSetup(read.input, store, 'replace'), store);
    expect(preview.sheets.find((sheet) => sheet.name === 'Variants')?.archived).toEqual(['Tea — Large']);
  });

  it('flattens the rows for the mutation, a tab not in the file sent as null', () => {
    const read = readPosSetup([tab('categories', [{ name: 'Drinks', sortOrder: 1 }])]);
    expect(setupMutationInput(read.input, 'merge', true)).toEqual({
      mode: 'merge',
      skipErrorRows: true,
      categories: [{ line: 2, name: 'Drinks', sortOrder: 1, archived: false }],
      orderTypes: null,
      items: null,
      variants: null,
      references: null,
      held: { categories: [], orderTypes: [], items: [], variants: [], references: [] },
    });
  });

  it('writes the template with every tab, in the file’s order, and a Read me', () => {
    const template = setupTemplate();
    expect(template.sheets.map((entry) => entry.sheet.name)).toEqual([...SETUP_SHEET_NAMES]);
    expect(template.sheets.every((entry) => entry.rows === undefined)).toBe(true);
    expect(template.readMe[0]?.[0]).toMatch(/Point of sale setup/);
  });

  it('exports only the chosen tabs, with the store’s rows', () => {
    const exported = setupExport(setupStore(CATALOGUE, SETTINGS), {
      sheets: ['Variants', 'Items'],
      includeArchived: true,
    });
    expect(exported.sheets.map((entry) => entry.sheet.name)).toEqual(['Items', 'Variants']);
    expect(exported.sheets[1]?.rows).toEqual([
      {
        itemCode: null,
        itemName: 'Tea',
        code: 'TEA-L',
        name: 'Large',
        price: 8000,
        cost: null,
        sortOrder: 0,
        archived: false,
      },
    ]);
  });
});
