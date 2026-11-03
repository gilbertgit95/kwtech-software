import {
  byPopularity,
  compareRanks,
  countPosOrders,
  POS_POPULARITY_DAYS,
  popularityWindow,
  rankPosOrders,
} from '../src/domain/popularity.js';
import { searchItems } from '../src/domain/search.js';
import type { PosCatalogueView, PosItemView, PosVariantView } from '../src/react/pos-client.js';
import { itemRank, rankMap, variantRank } from '../src/react/view/popularity.js';
import { itemGroups } from '../src/react/view/take-orders.js';
import { gridItems, pickerVariants, searchCatalogue, sellOrder } from '../src/react/view/till.js';

// ── the rule ────────────────────────────────────────────────────────────────

describe('the ranking window (issue #47)', () => {
  it('is the 7 whole days before the day it is made, never that day itself', () => {
    expect(POS_POPULARITY_DAYS).toBe(7);
    expect(popularityWindow('2026-11-04')).toEqual({ fromDay: '2026-10-28', toDay: '2026-11-03' });
  });

  it('crosses a month and a year by the calendar', () => {
    expect(popularityWindow('2026-03-02')).toEqual({ fromDay: '2026-02-23', toDay: '2026-03-01' });
    expect(popularityWindow('2027-01-03')).toEqual({ fromDay: '2026-12-27', toDay: '2027-01-02' });
  });
});

describe('counting orders, not units', () => {
  it('⚠ counts an item once per order, however many lines it is on', () => {
    const { items } = countPosOrders([
      { orderId: 'o1', itemId: 'coffee', variantId: null },
      { orderId: 'o1', itemId: 'coffee', variantId: null },
      { orderId: 'o1', itemId: 'coffee', variantId: null },
      { orderId: 'o2', itemId: 'coffee', variantId: null },
      { orderId: 'o2', itemId: 'cake', variantId: null },
    ]);
    expect(items).toEqual([
      { id: 'coffee', orders: 2 },
      { id: 'cake', orders: 1 },
    ]);
  });

  it('counts a variant once per order it is on, and its item once whichever sizes the order had', () => {
    const { items, variants } = countPosOrders([
      { orderId: 'o1', itemId: 'tea', variantId: 'tea-l' },
      { orderId: 'o1', itemId: 'tea', variantId: 'tea-r' },
      { orderId: 'o2', itemId: 'tea', variantId: 'tea-l' },
      { orderId: 'o2', itemId: 'tea', variantId: 'tea-l' },
    ]);
    expect(items).toEqual([{ id: 'tea', orders: 2 }]);
    expect(variants).toEqual([
      { id: 'tea-l', itemId: 'tea', orders: 2 },
      { id: 'tea-r', itemId: 'tea', orders: 1 },
    ]);
  });

  it('counts nothing from nothing', () => {
    expect(countPosOrders([])).toEqual({ items: [], variants: [] });
  });
});

describe('ranks', () => {
  it('gives 1 to the most ordered, and lets a tie share its rank', () => {
    const ranks = rankPosOrders([
      { id: 'c', orders: 3 },
      { id: 'a', orders: 9 },
      { id: 'b', orders: 3 },
      { id: 'd', orders: 1 },
    ]);
    expect(Object.fromEntries(ranks)).toEqual({ a: 1, b: 2, c: 2, d: 4 });
  });

  it('sorts by rank, the unranked last, and ⚠ keeps ties and the unranked in the order they came', () => {
    const rows = ['apple', 'banana', 'cherry', 'date', 'elder'];
    const ranks = new Map([
      ['cherry', 1],
      ['apple', 2],
      ['date', 2],
    ]);
    expect(byPopularity(rows, (row) => ranks.get(row) ?? null)).toEqual(['cherry', 'apple', 'date', 'banana', 'elder']);
    expect(byPopularity(rows, () => null)).toEqual(rows);
  });

  it('compares the unranked as equal, after any rank', () => {
    expect(compareRanks(null, null)).toBe(0);
    expect(compareRanks(5, null)).toBeLessThan(0);
    expect(compareRanks(null, 1)).toBeGreaterThan(0);
  });
});

// ── the sell views ──────────────────────────────────────────────────────────

const OFF = '2026-10-31T03:00:00.000Z';

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

/** Drinks: Americano, Latte, Mocha (off), Tea with three sizes. Food: Cake. */
const MENU: PosCatalogueView = {
  costsVisible: false,
  orderTypes: [],
  categories: [
    { id: 'c-drinks', name: 'Drinks', sortOrder: 0, archivedAt: null },
    { id: 'c-food', name: 'Food', sortOrder: 1, archivedAt: null },
  ],
  items: [
    item('americano', 'Americano', 'c-drinks'),
    item('latte', 'Latte', 'c-drinks'),
    item('mocha', 'Mocha', 'c-drinks', { unavailableAt: OFF }),
    item('tea', 'Tea', 'c-drinks', {
      variants: [
        variant('tea-s', 'tea', 'Small', { sortOrder: 0 }),
        variant('tea-m', 'tea', 'Medium', { sortOrder: 1 }),
        variant('tea-l', 'tea', 'Large', { sortOrder: 2, unavailableAt: OFF }),
      ],
    }),
    item('cake', 'Cake', 'c-food'),
  ],
};

/** Latte sells most, then the sold-out Mocha, then Tea; Large tea most of its sizes, then Medium. */
const RANKS = rankMap({
  items: [
    { id: 'latte', rank: 1 },
    { id: 'mocha', rank: 2 },
    { id: 'tea', rank: 3 },
  ],
  variants: [
    { id: 'tea-l', rank: 1 },
    { id: 'tea-m', rank: 2 },
  ],
});

describe('the sell views, most ordered first (issue #47)', () => {
  it('lists a category’s items by rank, the unranked after them by name', () => {
    expect(sellOrder(gridItems(MENU, 'c-drinks'), RANKS).map((one) => one.id)).toEqual([
      'latte',
      'tea',
      'americano',
      'mocha',
    ]);
  });

  it('⚠ still puts a not-available best seller after everything that can be sold (#37)', () => {
    const order = sellOrder(gridItems(MENU, 'c-drinks'), RANKS).map((one) => one.id);
    expect(order.indexOf('mocha')).toBe(order.length - 1);
  });

  it('keeps the old order — by name — with no ranking yet', () => {
    expect(sellOrder(gridItems(MENU, 'c-drinks'), null).map((one) => one.id)).toEqual([
      'americano',
      'latte',
      'tea',
      'mocha',
    ]);
  });

  it('ranks inside each group on the Take orders view, and keeps the categories in the store’s order', () => {
    expect(itemGroups(MENU, RANKS).map((group) => [group.name, group.items.map((one) => one.id)])).toEqual([
      ['Drinks', ['latte', 'tea', 'americano', 'mocha']],
      ['Food', ['cake']],
    ]);
  });

  it('lists an item’s sizes by rank in the picker, the off ones last, the unranked by the store’s order', () => {
    const tea = MENU.items.find((one) => one.id === 'tea');
    if (!tea) throw new Error('the menu has tea');
    expect(pickerVariants(tea, RANKS).map((one) => one.id)).toEqual(['tea-m', 'tea-s', 'tea-l']);
    expect(pickerVariants(tea, null).map((one) => one.id)).toEqual(['tea-s', 'tea-m', 'tea-l']);
  });

  it('⚠ never ranks a best seller above a better search match', () => {
    // "Tea" starts a word, "Latte" only contains "te": the better MATCH wins, though Latte is ranked 1.
    expect(searchItems(searchCatalogue(MENU, RANKS), 'te').map((one) => one.label)).toEqual(['Tea', 'Latte']);
  });

  it('puts the more ordered first among matches of the same quality', () => {
    const catalogue: PosCatalogueView = {
      ...MENU,
      items: [item('a', 'Iced coffee', null), item('b', 'Iced tea', null)],
    };
    const ranks = rankMap({ items: [{ id: 'b', rank: 1 }], variants: [] });
    expect(searchItems(searchCatalogue(catalogue, ranks), 'iced').map((one) => one.label)).toEqual([
      'Iced tea',
      'Iced coffee',
    ]);
    expect(searchItems(searchCatalogue(catalogue, null), 'iced').map((one) => one.label)).toEqual([
      'Iced coffee',
      'Iced tea',
    ]);
  });

  it('looks a rank up by id, and has none for what is not listed or before the ranking is read', () => {
    expect(itemRank(RANKS, 'latte')).toBe(1);
    expect(itemRank(RANKS, 'cake')).toBeNull();
    expect(variantRank(RANKS, 'tea-m')).toBe(2);
    expect(itemRank(null, 'latte')).toBeNull();
    expect(rankMap(null)).toBeNull();
  });
});
