import { readPosSetup } from '../src/domain/setup.js';
import { PosWriteError } from '../src/server/pos.errors.js';
import { capAt, harness, OTHER_STORE, SCOPE } from './harness.js';
import { tab } from './setup-tabs.js';

const ANA = 'user-ana';

async function refusal(promise: Promise<unknown>): Promise<{ reason: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PosWriteError) return { reason: error.reason, message: error.message };
    throw error;
  }
  return { reason: 'no refusal', message: '' };
}

/** The setup a new café fills in, read as the browser reads it. */
function cafe() {
  const reading = readPosSetup([
    tab('categories', [{ name: 'Drinks' }, { name: 'Food', sortOrder: 2 }]),
    tab('orderTypes', [{ name: 'Dine-in', isDefault: true }, { name: 'Takeout' }]),
    tab('items', [
      { code: 'LAT', name: 'Latte', category: 'Drinks', price: 12000, cost: 4500 },
      { name: 'Tea', category: 'Drinks', price: null },
      { name: 'Cake', category: 'Food', price: 9500 },
    ]),
    tab('variants', [
      { itemName: 'Tea', name: 'Small', price: 6000, sortOrder: 0 },
      { itemName: 'Tea', name: 'Large', code: 'TEA-L', price: 8000, sortOrder: 1 },
    ]),
    tab('references', [{ option: 'Table 1' }, { option: 'Table 2', isDefault: true }]),
  ]);
  expect(reading.problems).toEqual([]);
  return reading.input;
}

describe('importing a store’s setup from Excel (issue #35)', () => {
  it('sets up an empty store in one import: categories, order types, items with their sizes, references', async () => {
    const h = harness();
    const outcome = await h.setup.import(SCOPE, ANA, cafe(), 'merge', false);
    expect(outcome.sheets).toEqual([
      { name: 'Categories', created: 2, updated: 0, archived: 0 },
      { name: 'Order types', created: 2, updated: 0, archived: 0 },
      { name: 'Items', created: 3, updated: 0, archived: 0 },
      { name: 'Variants', created: 2, updated: 0, archived: 0 },
      { name: 'References', created: 2, updated: 1, archived: 0 },
    ]);

    const catalogue = await h.catalogue.catalogue(SCOPE, true);
    const tea = catalogue.items.find((entry) => entry.item.name === 'Tea');
    expect(tea?.variants.map((variant) => [variant.name, variant.code, variant.price])).toEqual([
      ['Small', null, 6000],
      ['Large', 'TEA-L', 8000],
    ]);
    const drinks = catalogue.categories.find((category) => category.name === 'Drinks');
    expect(
      catalogue.items
        .filter((entry) => entry.item.categoryId === drinks?.id)
        .map((entry) => entry.item.name)
        .sort(),
    ).toEqual(['Latte', 'Tea']);
    expect(catalogue.orderTypes.map((type) => [type.name, type.isDefault])).toEqual([
      ['Dine-in', true],
      ['Takeout', false],
    ]);
    const settings = await h.settings.get(SCOPE);
    expect(settings.referenceOptions).toEqual(['Table 1', 'Table 2']);
    expect(settings.defaultReference).toBe('Table 2');
    // One catalogue event and one settings event, after the commit.
    expect(h.pubsub.sent.map((event) => event.change)).toEqual(['catalogue', 'settings']);
    // Nothing of another store's.
    expect((await h.catalogue.catalogue(OTHER_STORE, true)).items).toEqual([]);
  });

  it('⚠ changes nothing when the same file is imported again', async () => {
    const h = harness();
    await h.setup.import(SCOPE, ANA, cafe(), 'merge', false);
    const before = JSON.stringify(h.prisma.state);
    const again = await h.setup.import(SCOPE, ANA, cafe(), 'replace', false);
    expect(again.sheets.every((sheet) => sheet.created + sheet.updated + sheet.archived === 0)).toBe(true);
    expect(JSON.stringify(h.prisma.state)).toBe(before);
  });

  it('⚠ refuses the whole file on a row error, says where, and writes nothing', async () => {
    const h = harness();
    const input = cafe();
    input.items?.push({
      line: 9,
      row: {
        code: null,
        name: 'Mystery',
        kind: 'product',
        category: 'Nowhere',
        description: null,
        price: 100,
        cost: null,
        archived: false,
      },
    });
    const refused = await refusal(h.setup.import(SCOPE, ANA, input, 'merge', false));
    expect(refused.reason).toBe('invalid_setup');
    expect(refused.message).toBe(
      'Nothing was changed. Items · row 9 · Category: No category named “Nowhere”. Add it on the Categories sheet.',
    );
    expect(h.prisma.state.posItem).toEqual([]);
    expect(h.prisma.state.posCategory).toEqual([]);
    expect(h.pubsub.sent).toEqual([]);
  });

  it('imports the rest when the person chose to skip the rows with errors', async () => {
    const h = harness();
    const input = cafe();
    input.items?.push({
      line: 9,
      row: {
        code: null,
        name: 'Mystery',
        kind: 'product',
        category: 'Nowhere',
        description: null,
        price: 100,
        cost: null,
        archived: false,
      },
    });
    const outcome = await h.setup.import(SCOPE, ANA, input, 'merge', true);
    expect(outcome.sheets.find((sheet) => sheet.name === 'Items')).toEqual({
      name: 'Items',
      created: 3,
      updated: 0,
      archived: 0,
    });
    expect(h.prisma.state.posItem.map((row) => row.name)).not.toContain('Mystery');
  });

  it('⚠ never trusts the rows it is sent: a value the reader would not produce is refused', async () => {
    const h = harness();
    const input = cafe();
    const latte = input.items?.[0];
    if (latte) latte.row = { ...latte.row, code: 'lat x', price: -5 };
    const refused = await refusal(h.setup.import(SCOPE, ANA, input, 'merge', false));
    expect(refused.reason).toBe('invalid_setup');
    expect(refused.message).toMatch(/Items · row 2 · Code: Letters, digits/);
    expect(refused.message).toMatch(/Items · row 2 · Price/);
  });

  it('⚠ holds pos:items for the store as the import leaves it, and says how many the file would make', async () => {
    const h = harness({ limits: capAt(4) });
    const refused = await refusal(h.setup.import(SCOPE, ANA, cafe(), 'merge', false));
    expect(refused.reason).toBe('limit_reached');
    expect(refused.message).toMatch(/can have 4 items and sizes for sale here\. This file would make 5\./);
    expect(h.prisma.state.posCategory).toEqual([]);
  });

  it('Replace archives what a sheet in the file leaves out — never a sheet the file does not have', async () => {
    const h = harness();
    await h.setup.import(SCOPE, ANA, cafe(), 'merge', false);
    const onlyLatte = readPosSetup([
      tab('items', [{ code: 'LAT', name: 'Latte', category: 'Drinks', price: 12000, cost: 4500 }]),
    ]);
    const outcome = await h.setup.import(SCOPE, ANA, onlyLatte.input, 'replace', false);
    expect(outcome.sheets).toEqual([{ name: 'Items', created: 0, updated: 0, archived: 2 }]);
    const archived = h.prisma.state.posItem.filter((row) => row.archivedAt !== null).map((row) => row.name);
    expect(archived.sort()).toEqual(['Cake', 'Tea']);
    // Nothing deleted, and the categories — not in this file — untouched.
    expect(h.prisma.state.posItem).toHaveLength(3);
    expect(h.prisma.state.posCategory.every((row) => row.archivedAt === null)).toBe(true);
  });

  it('moves the default order type, clearing the old one in the same import', async () => {
    const h = harness();
    await h.setup.import(SCOPE, ANA, cafe(), 'merge', false);
    const takeout = readPosSetup([tab('orderTypes', [{ name: 'Takeout', isDefault: true }])]);
    await h.setup.import(SCOPE, ANA, takeout.input, 'merge', false);
    expect(h.prisma.state.posOrderType.map((row) => [row.name, row.isDefault])).toEqual([
      ['Dine-in', false],
      ['Takeout', true],
    ]);
  });
});
