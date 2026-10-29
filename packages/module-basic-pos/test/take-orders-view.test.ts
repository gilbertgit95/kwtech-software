import type { PosCatalogueView, PosItemView } from '../src/react/pos-client.js';
import {
  canLeaveOrder,
  countOnOrder,
  hasMoreToRead,
  heldOrderDetail,
  heldOrderTitle,
  initiallyOpenGroups,
  itemGroups,
  liveOrderTypes,
  POS_UNGROUPED,
  sellModeFor,
  waitMinutes,
  waitText,
  waitUrgency,
} from '../src/react/view/take-orders.js';

function item(id: string, name: string, categoryId: string | null, extra: Partial<PosItemView> = {}): PosItemView {
  return {
    id,
    kind: 'product',
    name,
    code: null,
    description: null,
    price: 10_000,
    cost: null,
    categoryId,
    archivedAt: null,
    variants: [],
    ...extra,
  };
}

const category = (id: string, name: string, sortOrder: number, archivedAt: string | null = null) => ({
  id,
  name,
  sortOrder,
  archivedAt,
});

const CATALOGUE: PosCatalogueView = {
  costsVisible: false,
  orderTypes: [],
  categories: [category('pork', 'Pork', 2), category('beef', 'Beef', 1), category('fish', 'Fish', 3)],
  items: [
    item('hinalang', 'Hinalang', 'beef'),
    item('bulalo', 'Bulalo', 'beef', {
      variants: [
        {
          id: 'small',
          itemId: 'bulalo',
          name: 'Small serving',
          code: null,
          price: 25_000,
          cost: null,
          sortOrder: 0,
          archivedAt: null,
        },
        {
          id: 'big',
          itemId: 'bulalo',
          name: 'Big serving',
          code: null,
          price: 45_000,
          cost: null,
          sortOrder: 1,
          archivedAt: null,
        },
      ],
    }),
    item('adobo', 'Adobo', 'pork'),
    item('rice', 'Rice', null),
    item('old', 'Old dish', 'beef', { archivedAt: '2026-10-01T00:00:00Z' }),
  ],
};

describe('the Take orders groups (issue #23)', () => {
  it('groups items by category, in the store’s order, each by name, uncategorised last as Other', () => {
    expect(itemGroups(CATALOGUE).map((group) => [group.name, group.items.map((one) => one.id)])).toEqual([
      ['Beef', ['bulalo', 'hinalang']],
      ['Pork', ['adobo']],
      ['Other', ['rice']],
    ]);
  });

  it('leaves out a group with nothing to sell, and archived items', () => {
    const names = itemGroups(CATALOGUE).map((group) => group.name);
    expect(names).not.toContain('Fish');
    expect(itemGroups(CATALOGUE).flatMap((group) => group.items.map((one) => one.id))).not.toContain('old');
  });

  it('⚠ keeps an archived category’s items on the till, under Other', () => {
    const catalogue = { ...CATALOGUE, categories: [category('beef', 'Beef', 1, '2026-10-01T00:00:00Z')] };
    const other = itemGroups(catalogue).find((group) => group.id === POS_UNGROUPED);
    expect(other?.items.map((one) => one.id)).toEqual(['adobo', 'bulalo', 'hinalang', 'rice']);
  });

  it('calls the one group "Items" when the store has no categories', () => {
    expect(itemGroups({ ...CATALOGUE, categories: [] }).map((group) => group.name)).toEqual(['Items']);
  });

  it('opens a lone group at once, and none when there are several', () => {
    expect([...initiallyOpenGroups([{ id: 'a' }])]).toEqual(['a']);
    expect([...initiallyOpenGroups([{ id: 'a' }, { id: 'b' }])]).toEqual([]);
  });
});

describe('the order on the Take orders view', () => {
  it('counts an item on the order across its variants', () => {
    const lines = [
      { itemId: 'bulalo', quantity: 2 },
      { itemId: 'bulalo', quantity: 1 },
      { itemId: 'rice', quantity: 4 },
    ];
    expect(countOnOrder(lines, 'bulalo')).toBe(3);
    expect(countOnOrder(lines, 'adobo')).toBe(0);
  });

  it('titles a held order by its reference, then its customer, then its number', () => {
    expect(heldOrderTitle({ label: 'Table 5', customerName: 'Ana', number: 12 })).toBe('Table 5');
    expect(heldOrderTitle({ label: null, customerName: 'Ana', number: 12 })).toBe('Ana');
    expect(heldOrderTitle({ label: null, customerName: null, number: 12 })).toBe('Order 12');
    expect(heldOrderTitle({ label: null, customerName: null, number: null })).toBe('No reference');
  });

  it('⚠ never lets an unheld order with lines be left — it would be listed nowhere', () => {
    const held = [{ id: 'h1' }];
    expect(canLeaveOrder(null, held)).toBe(true);
    expect(canLeaveOrder({ id: 'new', lines: [] }, held)).toBe(true);
    expect(canLeaveOrder({ id: 'h1', lines: [1] }, held)).toBe(true);
    expect(canLeaveOrder({ id: 'new', lines: [1] }, held)).toBe(false);
  });
});

describe('which Sell opens on the full screen', () => {
  it('opens what this device last showed', () => {
    expect(sellModeFor('cashier', true)).toBe('cashier');
    expect(sellModeFor('classic', true)).toBe('classic');
    expect(sellModeFor('classic', false)).toBe('classic');
  });

  it('⚠ never opens Cashier for somebody who may not take payment, whatever was remembered', () => {
    expect(sellModeFor('cashier', false)).toBe('classic');
  });

  it('defaults to Cashier for a cashier and Classic for a seller', () => {
    expect(sellModeFor(null, true)).toBe('cashier');
    expect(sellModeFor(null, false)).toBe('classic');
  });

  it('⚠ reads a remembered Take orders — the full screen’s until it left — as nothing', () => {
    expect(sellModeFor('take_orders', true)).toBe('cashier');
    expect(sellModeFor('take_orders', false)).toBe('classic');
  });
});

describe('how long a held order has waited', () => {
  const now = new Date('2026-10-29T12:00:00Z');

  it('counts whole minutes, never below zero when a device clock is behind', () => {
    expect(waitMinutes('2026-10-29T11:47:30Z', now)).toBe(12);
    expect(waitMinutes('2026-10-29T12:00:20Z', now)).toBe(0);
  });

  it('gets louder with age: calm for a meal, loudest for an order somebody forgot', () => {
    expect(waitUrgency(0)).toBe('new');
    expect(waitUrgency(29)).toBe('new');
    expect(waitUrgency(30)).toBe('waiting');
    expect(waitUrgency(60)).toBe('long');
    expect(waitUrgency(119)).toBe('long');
    expect(waitUrgency(120)).toBe('overdue');
    expect(waitUrgency(3000)).toBe('overdue');
  });

  it('says it to the minute, so two orders can be compared', () => {
    expect(waitText(0)).toBe('just now');
    expect(waitText(12)).toBe('12 min');
    expect(waitText(60)).toBe('1 h');
    expect(waitText(80)).toBe('1 h 20 min');
    expect(waitText(24 * 60)).toBe('1 d');
    expect(waitText(27 * 60 + 5)).toBe('1 d 3 h');
  });
});

describe('order types on the order', () => {
  const type = (id: string, name: string, sortOrder: number, archivedAt: string | null = null) => ({
    id,
    name,
    sortOrder,
    isDefault: false,
    archivedAt,
  });

  it('offers only live types, in the store’s order', () => {
    const orderTypes = [type('t', 'Takeout', 1), type('d', 'Dine-in', 0), type('g', 'Grab', 2, '2026-10-01T00:00:00Z')];
    expect(liveOrderTypes({ orderTypes }).map((one) => one.name)).toEqual(['Dine-in', 'Takeout']);
  });

  it('puts the type first on a held order’s line, and leaves it out when there is none', () => {
    expect(heldOrderDetail({ orderTypeName: 'Dine-in', itemCount: 3 })).toBe('Dine-in · 3 items');
    expect(heldOrderDetail({ orderTypeName: null, itemCount: 1 })).toBe('1 item');
  });
});

describe('ⓘ on an item’s row', () => {
  it('is offered for an item with a description, or a name the row may cut', () => {
    expect(hasMoreToRead({ name: 'Bulalo', description: 'Beef shank soup, slow-cooked' })).toBe(true);
    expect(hasMoreToRead({ name: 'Bulalo special with bone marrow and corn, family size', description: null })).toBe(
      true,
    );
  });

  it('is not offered when the row already shows it all', () => {
    expect(hasMoreToRead({ name: 'Rice', description: null })).toBe(false);
    expect(hasMoreToRead({ name: 'Rice', description: '   ' })).toBe(false);
  });
});
