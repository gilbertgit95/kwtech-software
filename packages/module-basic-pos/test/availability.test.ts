import {
  availableFirst,
  checkPosAvailable,
  isPosItemAvailable,
  isPosVariantAvailable,
  POS_AVAILABILITY_BATCH_MAX,
  preparePosAvailabilityTargets,
} from '../src/domain/availability.js';
import { type PosSearchItem, searchItems } from '../src/domain/search.js';
import type { PosCatalogueView, PosItemView, PosVariantView } from '../src/react/pos-client.js';
import {
  availabilityDone,
  availabilityGroups,
  itemKey,
  POS_AVAILABILITY_OTHER,
  selectAllState,
  selectionKeys,
  selectionTarget,
  toggleAll,
  variantKey,
} from '../src/react/view/availability.js';
import { itemGroups } from '../src/react/view/take-orders.js';
import { gridCategories, gridItems, pickerVariants, sellOrder } from '../src/react/view/till.js';
import { PosWriteError } from '../src/server/pos.errors.js';
import type { PosOrderRow } from '../src/server/pos.repository.js';
import { ANA, BEN, harness, OTHER_STORE, SCOPE } from './harness.js';

const OFF = '2026-10-31T03:00:00.000Z';

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PosWriteError) return error.reason;
    throw error;
  }
  return 'no refusal';
}

const ref = (order: Pick<PosOrderRow, 'id' | 'version'>) => ({ orderId: order.id, version: order.version });

// ── the rule ────────────────────────────────────────────────────────────────

describe('availability, the rule (issue #37)', () => {
  const on = { unavailableAt: null, archivedAt: null };
  const off = { unavailableAt: OFF, archivedAt: null };

  it('counts an item with every live size off as not available, and archived sizes not at all', () => {
    expect(isPosItemAvailable({ unavailableAt: null, variants: [] })).toBe(true);
    expect(isPosItemAvailable({ unavailableAt: null, variants: [off, on] })).toBe(true);
    expect(isPosItemAvailable({ unavailableAt: null, variants: [off, off] })).toBe(false);
    expect(isPosItemAvailable({ unavailableAt: null, variants: [off, { unavailableAt: null, archivedAt: OFF }] })).toBe(
      false,
    );
  });

  it('⚠ lets the item’s own switch win over a size that is still on', () => {
    expect(isPosItemAvailable({ unavailableAt: OFF, variants: [on] })).toBe(false);
    expect(isPosVariantAvailable({ unavailableAt: OFF }, on)).toBe(false);
    expect(checkPosAvailable({ unavailableAt: OFF }, on)).toBe('item_unavailable');
    expect(checkPosAvailable({ unavailableAt: null }, off)).toBe('item_unavailable');
    expect(checkPosAvailable({ unavailableAt: null }, null)).toBeNull();
  });

  it('puts the available ones first and keeps the order inside each half', () => {
    expect(availableFirst(['a1', 'b0', 'c1', 'd0'], (row) => row.endsWith('1'))).toEqual(['a1', 'c1', 'b0', 'd0']);
  });

  it('deduplicates a selection, refuses an empty one and one past the cap', () => {
    expect(preparePosAvailabilityTargets({ itemIds: ['a', 'a'], variantIds: ['v'] })).toEqual({
      itemIds: ['a'],
      variantIds: ['v'],
    });
    expect(preparePosAvailabilityTargets({ itemIds: [], variantIds: [] })).toEqual({ refused: 'empty_selection' });
    const many = Array.from({ length: POS_AVAILABILITY_BATCH_MAX + 1 }, (_, index) => `i${index}`);
    expect(preparePosAvailabilityTargets({ itemIds: many, variantIds: [] })).toEqual({ refused: 'limit_reached' });
  });
});

// ── the server ──────────────────────────────────────────────────────────────

/** A kitchen: bulalo, and a drink in two sizes. */
async function kitchen() {
  const h = harness();
  const bulalo = await h.catalogue.saveItem(SCOPE, ANA, { kind: 'product', name: 'Bulalo', price: 25_000 });
  const tea = await h.catalogue.saveItem(SCOPE, ANA, {
    kind: 'product',
    name: 'Iced tea',
    price: 0,
    variants: [
      { name: 'Regular', price: 4000 },
      { name: 'Large', price: 6000 },
    ],
  });
  const [regular, large] = tea.variants;
  if (!regular || !large) throw new Error('the kitchen has two sizes of tea');
  h.pubsub.sent.length = 0;
  return { ...h, bulalo, tea, regular, large };
}

describe('setAvailability', () => {
  it('switches an item off with who and since when, and leaves its name, price and editor alone', async () => {
    const { catalogue, bulalo, prisma } = await kitchen();
    await catalogue.setAvailability(SCOPE, BEN, { itemIds: [bulalo.item.id], variantIds: [], available: false });
    const row = prisma.state.posItem.find((item) => item.id === bulalo.item.id);
    expect(row).toMatchObject({ unavailableById: BEN, name: 'Bulalo', price: 25_000, updatedById: ANA });
    expect(row?.unavailableAt).toBeInstanceOf(Date);

    await catalogue.setAvailability(SCOPE, ANA, { itemIds: [bulalo.item.id], variantIds: [], available: true });
    expect(prisma.state.posItem.find((item) => item.id === bulalo.item.id)).toMatchObject({
      unavailableAt: null,
      unavailableById: null,
    });
  });

  it('⚠ keeps the time an item already off went off when it is switched off again', async () => {
    const { catalogue, bulalo, prisma } = await kitchen();
    await catalogue.setAvailability(SCOPE, BEN, { itemIds: [bulalo.item.id], variantIds: [], available: false });
    const first = prisma.state.posItem.find((item) => item.id === bulalo.item.id)?.unavailableAt;
    await catalogue.setAvailability(SCOPE, ANA, { itemIds: [bulalo.item.id], variantIds: [], available: false });
    expect(prisma.state.posItem.find((item) => item.id === bulalo.item.id)).toMatchObject({
      unavailableAt: first,
      unavailableById: BEN,
    });
  });

  it('switches items and sizes together in ONE transaction and announces it ONCE', async () => {
    const { catalogue, bulalo, large, prisma, pubsub } = await kitchen();
    const before = prisma.transactions;
    const change = await catalogue.setAvailability(SCOPE, BEN, {
      itemIds: [bulalo.item.id],
      variantIds: [large.id],
      available: false,
    });
    expect(change).toEqual({ items: 1, variants: 1 });
    expect(prisma.transactions - before).toBe(1);
    expect(pubsub.sent).toEqual([{ ...SCOPE, change: 'catalogue', orderId: null, actorId: BEN }]);
    expect(prisma.state.posItemVariant.find((variant) => variant.id === large.id)?.unavailableById).toBe(BEN);
  });

  it('⚠ is all or nothing: one id from another store refuses the whole selection and changes nothing', async () => {
    const { catalogue, bulalo, prisma, pubsub } = await kitchen();
    const elsewhere = await catalogue.saveItem(OTHER_STORE, ANA, { kind: 'product', name: 'Sinigang', price: 1 });
    pubsub.sent.length = 0;
    expect(
      await refusal(
        catalogue.setAvailability(SCOPE, BEN, {
          itemIds: [bulalo.item.id, elsewhere.item.id],
          variantIds: [],
          available: false,
        }),
      ),
    ).toBe('not_found');
    expect(prisma.state.posItem.every((item) => item.unavailableAt === null)).toBe(true);
    expect(pubsub.sent).toEqual([]);
    expect(
      await refusal(catalogue.setAvailability(SCOPE, BEN, { itemIds: [], variantIds: [], available: false })),
    ).toBe('empty_selection');
  });

  it('keeps a not-available item in the catalogue, flagged, and counting toward the item cap', async () => {
    const { catalogue, resolver, bulalo } = await kitchen();
    await catalogue.setAvailability(SCOPE, BEN, { itemIds: [bulalo.item.id], variantIds: [], available: false });
    const read = await resolver.posCatalogue({ req: { userId: BEN } }, SCOPE.organizationId, SCOPE.workspaceId);
    expect(read.items.find((item) => item.id === bulalo.item.id)?.unavailableAt).toEqual(expect.any(String));
    expect(read.items.find((item) => item.id === bulalo.item.id)?.archivedAt).toBeNull();
  });
});

describe('selling an item that is not available', () => {
  it('⚠ refuses adding it, a size that is off, and tapping it again onto its line', async () => {
    const { catalogue, writes, bulalo, tea, large, regular } = await kitchen();
    let order = await writes.create(SCOPE, BEN, null);
    order = await writes.addLine(SCOPE, BEN, ref(order), { itemId: bulalo.item.id, quantity: 1 });
    await catalogue.setAvailability(SCOPE, ANA, {
      itemIds: [bulalo.item.id],
      variantIds: [large.id],
      available: false,
    });

    expect(await refusal(writes.addLine(SCOPE, BEN, ref(order), { itemId: bulalo.item.id, quantity: 1 }))).toBe(
      'item_unavailable',
    );
    expect(
      await refusal(writes.addLine(SCOPE, BEN, ref(order), { itemId: tea.item.id, variantId: large.id, quantity: 1 })),
    ).toBe('item_unavailable');
    // The size still on sells as before.
    order = await writes.addLine(SCOPE, BEN, ref(order), { itemId: tea.item.id, variantId: regular.id, quantity: 1 });
    expect(order.total).toBe(25_000 + 4000);
  });

  it('⚠ leaves an order that already has it alone: lower it, refresh it, remove it — but never raise it', async () => {
    const { catalogue, writes, prisma, bulalo } = await kitchen();
    let order = await writes.create(SCOPE, BEN, null);
    order = await writes.addLine(SCOPE, BEN, ref(order), { itemId: bulalo.item.id, quantity: 3 });
    const line = prisma.state.posOrderLine.find((row) => row.orderId === order.id);
    if (!line) throw new Error('the order has its line');
    const lineId = line.id as string;
    await catalogue.setAvailability(SCOPE, ANA, { itemIds: [bulalo.item.id], variantIds: [], available: false });

    expect(await refusal(writes.updateLine(SCOPE, BEN, ref(order), lineId, { quantity: 4 }))).toBe('item_unavailable');
    order = await writes.updateLine(SCOPE, BEN, ref(order), lineId, { quantity: 2 });
    order = await writes.refreshLine(SCOPE, BEN, ref(order), lineId);
    order = await writes.removeLine(SCOPE, BEN, ref(order), lineId);
    expect(prisma.state.posOrderLine.filter((row) => row.orderId === order.id)).toEqual([]);
  });

  it('sells it again once it is switched back on, with nothing else changed', async () => {
    const { catalogue, writes, bulalo } = await kitchen();
    await catalogue.setAvailability(SCOPE, ANA, { itemIds: [bulalo.item.id], variantIds: [], available: false });
    await catalogue.setAvailability(SCOPE, ANA, { itemIds: [bulalo.item.id], variantIds: [], available: true });
    let order = await writes.create(SCOPE, BEN, null);
    order = await writes.addLine(SCOPE, BEN, ref(order), { itemId: bulalo.item.id, quantity: 1 });
    expect(order.total).toBe(25_000);
  });
});

// ── the sell views ──────────────────────────────────────────────────────────

function variant(id: string, itemId: string, name: string, patch: Partial<PosVariantView> = {}): PosVariantView {
  return {
    id,
    itemId,
    name,
    code: null,
    price: 1000,
    cost: null,
    sortOrder: 0,
    archivedAt: null,
    unavailableAt: null,
    ...patch,
  };
}

function item(id: string, name: string, categoryId: string | null, patch: Partial<PosItemView> = {}): PosItemView {
  return {
    id,
    kind: 'product',
    name,
    code: null,
    description: null,
    price: 1000,
    cost: null,
    categoryId,
    archivedAt: null,
    unavailableAt: null,
    variants: [],
    ...patch,
  };
}

/** Beef: bulalo (off), kare-kare. Drinks: iced tea with its only size off. Noodles: pancit, off. */
const MENU: PosCatalogueView = {
  costsVisible: false,
  orderTypes: [],
  categories: [
    { id: 'c-beef', name: 'Beef', sortOrder: 0, archivedAt: null },
    { id: 'c-noodles', name: 'Noodles', sortOrder: 1, archivedAt: null },
    { id: 'c-drinks', name: 'Drinks', sortOrder: 2, archivedAt: null },
  ],
  items: [
    item('bulalo', 'Bulalo', 'c-beef', { unavailableAt: OFF }),
    item('kare', 'Kare-kare', 'c-beef'),
    item('pancit', 'Pancit', 'c-noodles', { unavailableAt: OFF }),
    item('tea', 'Iced tea', 'c-drinks', {
      variants: [
        variant('tea-l', 'tea', 'Large', { sortOrder: 0, unavailableAt: OFF }),
        variant('tea-r', 'tea', 'Regular', { sortOrder: 1 }),
      ],
    }),
    item('water', 'Water', 'c-drinks'),
  ],
};

describe('the sell views’ order (issue #37)', () => {
  it('sorts not-available items after the rest in each category, keeping name order in each half', () => {
    expect(sellOrder(gridItems(MENU, 'c-beef')).map((one) => one.id)).toEqual(['kare', 'bulalo']);
    expect(sellOrder(gridItems(MENU, null)).map((one) => one.id)).toEqual(['tea', 'kare', 'water', 'bulalo', 'pancit']);
  });

  it('⚠ sorts a category with nothing to sell after those that still have something — tabs and groups alike', () => {
    expect(gridCategories(MENU).map((one) => one.id)).toEqual(['c-beef', 'c-drinks', 'c-noodles']);
    expect(itemGroups(MENU).map((group) => [group.name, group.items.map((one) => one.id)])).toEqual([
      ['Beef', ['kare', 'bulalo']],
      ['Drinks', ['tea', 'water']],
      ['Noodles', ['pancit']],
    ]);
  });

  it('lists the sizes that are off last in the picker', () => {
    const tea = MENU.items.find((one) => one.id === 'tea');
    if (!tea) throw new Error('the menu has tea');
    expect(pickerVariants(tea).map((one) => one.id)).toEqual(['tea-r', 'tea-l']);
  });

  it('⚠ still finds them, after what can be sold — but an exact code stays on top so a scan never adds the wrong thing', () => {
    const catalogue: PosSearchItem[] = [
      {
        id: 'a',
        name: 'Ink A',
        code: 'INK',
        categoryName: null,
        price: 1,
        archived: false,
        unavailable: true,
        variants: [],
      },
      {
        id: 'b',
        name: 'Ink B',
        code: null,
        categoryName: null,
        price: 1,
        archived: false,
        unavailable: false,
        variants: [],
      },
    ];
    expect(searchItems(catalogue, 'ink b').map((one) => one.itemId)).toEqual(['b']);
    expect(searchItems(catalogue, 'ink a')).toEqual([expect.objectContaining({ itemId: 'a', unavailable: true })]);
    expect(searchItems(catalogue, 'INK').map((one) => [one.itemId, one.unavailable])).toEqual([
      ['a', true],
      ['b', false],
    ]);
    const plain = [{ ...catalogue[0], code: null } as PosSearchItem, catalogue[1] as PosSearchItem];
    expect(searchItems(plain, 'ink').map((one) => one.itemId)).toEqual(['b', 'a']);
  });
});

describe('the availability panel', () => {
  it('groups like the sell views, and filters by text, category and status', () => {
    expect(availabilityGroups(MENU).map((group) => group.id)).toEqual(['c-beef', 'c-noodles', 'c-drinks']);
    const off = availabilityGroups(MENU, { search: '', categoryId: null, status: 'unavailable' });
    // Tea counts as "not available" for the filter: one of its sizes is off, which is where to look.
    expect(off.flatMap((group) => group.rows.map((row) => row.item.id))).toEqual(['bulalo', 'pancit', 'tea']);
    const onSale = availabilityGroups(MENU, { search: '', categoryId: 'c-drinks', status: 'available' });
    expect(onSale.flatMap((group) => group.rows.map((row) => row.item.id))).toEqual(['water']);
    const found = availabilityGroups(MENU, { search: 'large', categoryId: null, status: 'all' });
    expect(found.flatMap((group) => group.rows.map((row) => row.item.id))).toEqual(['tea']);
    expect(availabilityGroups(MENU, { search: '', categoryId: POS_AVAILABILITY_OTHER, status: 'all' })).toEqual([]);
  });

  it('selects a whole category, items and sizes, and lets it go again', () => {
    const drinks = availabilityGroups(MENU).find((group) => group.id === 'c-drinks');
    if (!drinks) throw new Error('drinks are on the menu');
    const keys = selectionKeys(drinks.rows);
    expect(keys).toEqual([itemKey('tea'), variantKey('tea-l'), variantKey('tea-r'), itemKey('water')]);
    const all = toggleAll(new Set([itemKey('bulalo')]), keys);
    expect(selectAllState(all, keys)).toBe(true);
    expect(selectAllState(new Set([itemKey('tea')]), keys)).toBe('mixed');
    expect([...toggleAll(all, keys)]).toEqual([itemKey('bulalo')]);
  });

  it('⚠ sends only what is still on screen', () => {
    const selection = new Set([itemKey('bulalo'), itemKey('tea'), variantKey('tea-l')]);
    const shown = [itemKey('tea'), variantKey('tea-l'), variantKey('tea-r')];
    expect(selectionTarget(selection, shown)).toEqual({ itemIds: ['tea'], variantIds: ['tea-l'] });
  });

  it('says what it did', () => {
    expect(availabilityDone({ items: 3, variants: 1 }, false)).toBe('3 items and 1 size marked not available.');
    expect(availabilityDone({ items: 1, variants: 0 }, true)).toBe('1 item marked available.');
  });
});
