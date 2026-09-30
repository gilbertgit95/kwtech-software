import { POS_KEY_ACTIONS } from '../src/domain/keymap.js';
import type { PosCategoryView, PosItemView } from '../src/react/pos-client.js';
import {
  actionsByZone,
  categoryReorder,
  filterItems,
  itemForm,
  itemInput,
  itemKeyTarget,
  moveEntry,
  orderActions,
  orderStatusChip,
  orderTitle,
  whenText,
} from '../src/react/view/manage.js';

const LAMINATION: PosItemView = {
  id: 'lam',
  kind: 'service',
  name: 'Lamination',
  code: 'LAM',
  description: 'Per piece',
  price: 0,
  cost: null,
  categoryId: 'c-lam',
  archivedAt: null,
  variants: [
    {
      id: 'v1',
      itemId: 'lam',
      name: '125 mic · A4',
      code: 'L1',
      price: 4000,
      cost: 900,
      sortOrder: 0,
      archivedAt: null,
    },
    {
      id: 'v-old',
      itemId: 'lam',
      name: 'Old',
      code: null,
      price: 1,
      cost: null,
      sortOrder: 1,
      archivedAt: '2026-01-01',
    },
  ],
};

const MAGNET: PosItemView = {
  id: 'mag',
  kind: 'product',
  name: 'Ref magnet',
  code: 'MAG',
  description: null,
  price: 16000,
  cost: null,
  categoryId: null,
  archivedAt: null,
  variants: [],
};

const CATEGORIES: PosCategoryView[] = [
  { id: 'c-lam', name: 'Lamination', sortOrder: 0, archivedAt: null },
  { id: 'c-print', name: 'Printing', sortOrder: 0, archivedAt: null },
  { id: 'c-photo', name: 'Photo', sortOrder: 2, archivedAt: null },
];

describe('the item form', () => {
  it('round-trips an item: prices as pesos to type, back to centavos, live variants only', () => {
    const form = itemForm(LAMINATION);
    expect(form.variants.map((variant) => [variant.name, variant.price, variant.cost])).toEqual([
      ['125 mic · A4', '40.00', '9.00'],
    ]);
    const prepared = itemInput(form);
    expect(prepared).toEqual({
      input: {
        id: 'lam',
        kind: 'service',
        name: 'Lamination',
        code: 'LAM',
        description: 'Per piece',
        price: 0,
        cost: null,
        categoryId: 'c-lam',
        variants: [{ id: 'v1', name: '125 mic · A4', code: 'L1', price: 4000, cost: 900 }],
      },
    });
  });

  it('⚠ sends an empty cost as "not entered", never ₱0, and empty text fields as null', () => {
    const prepared = itemInput({ ...itemForm(MAGNET), cost: ' ', code: '', description: '  ' });
    expect(prepared).toMatchObject({ input: { cost: null, code: null, description: null, categoryId: null } });
  });

  it('says what is wrong before anything is sent', () => {
    expect(itemInput({ ...itemForm(MAGNET), name: ' ' })).toEqual({ problem: 'An item needs a name.' });
    expect(itemInput({ ...itemForm(MAGNET), price: 'abc' })).toMatchObject({
      problem: expect.stringContaining('price'),
    });
    expect(itemInput({ ...itemForm(MAGNET), cost: '1.234' })).toMatchObject({
      problem: expect.stringContaining('cost'),
    });
    const blankVariant = { ...itemForm(LAMINATION) };
    blankVariant.variants = [{ id: null, key: 'k', name: '', code: '', price: '1', cost: '' }];
    expect(itemInput(blankVariant)).toEqual({ problem: 'Variant 1 needs a name.' });
  });

  it('does not ask for the item’s own price once it has variants', () => {
    const form = { ...itemForm(LAMINATION), price: '' };
    expect(itemInput(form)).toMatchObject({ input: { price: 0 } });
  });
});

describe('lists', () => {
  it('moves an entry up or down, and leaves the list alone at the ends', () => {
    expect(moveEntry(['a', 'b', 'c'], 2, 'up')).toEqual(['a', 'c', 'b']);
    expect(moveEntry(['a', 'b', 'c'], 0, 'down')).toEqual(['b', 'a', 'c']);
    expect(moveEntry(['a', 'b'], 0, 'up')).toEqual(['a', 'b']);
  });

  it('⚠ saves only the categories whose position changed, and splits equal sort orders', () => {
    expect(categoryReorder(CATEGORIES)).toEqual([{ id: 'c-print', name: 'Printing', sortOrder: 1 }]);
  });

  it('searches items by name, code, category and variant, words in any order', () => {
    const items = [LAMINATION, MAGNET];
    expect(filterItems(items, CATEGORIES, 'a4 125', false).map((item) => item.id)).toEqual(['lam']);
    expect(filterItems(items, CATEGORIES, 'mag', false).map((item) => item.id)).toEqual(['mag']);
    expect(filterItems(items, CATEGORIES, '', false).map((item) => item.id)).toEqual(['lam', 'mag']);
    const archived = { ...MAGNET, archivedAt: '2026-01-01' };
    expect(filterItems([archived], CATEGORIES, '', false)).toEqual([]);
    expect(filterItems([archived], CATEGORIES, '', true)).toHaveLength(1);
  });
});

describe('orders', () => {
  const PAID = { status: 'paid', total: 1000, refunded: 0, changeOwed: 0, changeSettlement: null };

  it('names an order by its number, or by its label or customer before it has one', () => {
    expect(orderTitle({ number: 12, label: 'x', customerName: 'Juan' })).toBe('#12');
    expect(orderTitle({ number: null, label: 'table 3', customerName: 'Juan' })).toBe('table 3');
    expect(orderTitle({ number: null, label: null, customerName: null })).toBe('Walk-in');
  });

  it('shows what still needs doing ahead of "Paid"', () => {
    expect(orderStatusChip(PAID)).toEqual({ label: 'Paid', tone: 'success' });
    expect(orderStatusChip({ ...PAID, changeOwed: 100 }).label).toBe('Change owed');
    expect(orderStatusChip({ ...PAID, changeOwed: 100, changeSettlement: 'given' }).label).toBe('Paid');
    expect(orderStatusChip({ ...PAID, refunded: 300 }).label).toBe('Partly refunded');
    expect(orderStatusChip({ ...PAID, refunded: 1000 }).label).toBe('Refunded');
    expect(orderStatusChip({ ...PAID, status: 'unpaid' }).label).toBe('Unpaid');
  });

  it('⚠ offers each act only on the status it applies to, and only to who holds its key', () => {
    const everyone = { sell: true, refund: true };
    expect(orderActions({ ...PAID, status: 'open' }, everyone)).toMatchObject({ resume: true, refund: false });
    expect(orderActions({ ...PAID, status: 'unpaid' }, everyone)).toMatchObject({
      takePayment: true,
      voidOrder: true,
      reprint: true,
    });
    expect(orderActions({ ...PAID, status: 'unpaid' }, { sell: true, refund: false }).voidOrder).toBe(false);
    expect(orderActions(PAID, { sell: true, refund: false }).refund).toBe(false);
    expect(orderActions({ ...PAID, refunded: 1000 }, everyone).refund).toBe(false);
    expect(orderActions({ ...PAID, changeOwed: 100 }, everyone).settleChange).toBe(true);
    expect(orderActions({ ...PAID, changeOwed: 100, changeSettlement: 'tip' }, everyone).settleChange).toBe(false);
    expect(orderActions({ ...PAID, status: 'cancelled' }, everyone)).toEqual({
      resume: false,
      takePayment: false,
      voidOrder: false,
      refund: false,
      settleChange: false,
      reprint: false,
    });
  });

  it('⚠ prints times in the workspace’s zone, not the machine’s', () => {
    // 15:30Z is 11:30 PM in Manila — and the 30th there, the 30th in London too, but not the same hour.
    expect(whenText('2026-09-30T15:30:00Z', 'Asia/Manila')).toContain('11:30');
    expect(whenText('2026-09-30T15:30:00Z', 'Europe/London')).toContain('4:30');
    expect(whenText(null, 'Asia/Manila')).toBe('');
  });
});

describe('hot keys', () => {
  it('lists every action exactly once, grouped by where it works', () => {
    const listed = actionsByZone().flatMap((group) => group.actions.map((entry) => entry.action));
    expect(listed.sort()).toEqual(Object.keys(POS_KEY_ACTIONS).sort());
  });

  it('⚠ marks an item key broken once its item or variant is archived or gone', () => {
    const items = [LAMINATION, { ...MAGNET, archivedAt: '2026-01-01' }];
    expect(itemKeyTarget({ itemId: 'lam', variantId: 'v1' }, items)).toEqual({
      label: 'Lamination — 125 mic · A4',
      broken: false,
    });
    expect(itemKeyTarget({ itemId: 'lam', variantId: 'v-old' }, items).broken).toBe(true);
    expect(itemKeyTarget({ itemId: 'mag', variantId: null }, items).broken).toBe(true);
    expect(itemKeyTarget({ itemId: 'gone', variantId: null }, items).broken).toBe(true);
    expect(itemKeyTarget({ itemId: 'lam', variantId: 'nope' }, items).broken).toBe(true);
  });
});
