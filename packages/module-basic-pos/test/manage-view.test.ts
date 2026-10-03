import { POS_KEY_ACTIONS } from '../src/domain/keymap.js';
import { POS_ORDERS_READ_MAX } from '../src/domain/orders.js';
import type { PosCategoryView, PosItemView } from '../src/react/pos-client.js';
import {
  actionsByZone,
  categoryReorder,
  customerInitials,
  customerSummary,
  emailHref,
  filterItems,
  itemForm,
  itemInput,
  itemKeyTarget,
  listNeighbours,
  moveEntry,
  orderActions,
  orderListTotal,
  orderStatusChip,
  orderTitle,
  phoneHref,
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

  it('adds up the list: how many orders, and the amounts on their rows', () => {
    const rows = [PAID, { ...PAID, total: 2500 }, { ...PAID, status: 'unpaid', total: 400 }];
    expect(orderListTotal(rows, 'today')).toEqual({ count: 3, total: 3900, refunded: 0, leftOut: 0, cut: false });
    expect(orderListTotal([], 'today')).toEqual({ count: 0, total: 0, refunded: 0, leftOut: 0, cut: false });
  });

  it('⚠ leaves cancelled and voided orders out of the total, and says how many — they are not money', () => {
    const rows = [PAID, { ...PAID, status: 'cancelled', total: 700 }, { ...PAID, status: 'voided', total: 50 }];
    expect(orderListTotal(rows, 'today')).toMatchObject({ count: 1, total: 1000, leftOut: 2 });
    // On the Cancelled tab every row is one: the sum is what was cancelled.
    expect(orderListTotal(rows.slice(1), 'cancelled')).toMatchObject({ count: 2, total: 750, leftOut: 0 });
  });

  it('⚠ shows refunds beside the total, never taken off it, and says when the list was cut', () => {
    expect(orderListTotal([{ ...PAID, refunded: 300 }, PAID], 'all')).toMatchObject({ total: 2000, refunded: 300 });
    const full = Array.from({ length: POS_ORDERS_READ_MAX }, () => PAID);
    expect(orderListTotal(full, 'all').cut).toBe(true);
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

describe('customers', () => {
  it('draws initials from the first and last words, whatever the name is made of', () => {
    expect(customerInitials('Juan Dela Cruz')).toBe('JC');
    expect(customerInitials('  maria ')).toBe('M');
    expect(customerInitials('Élodie (suki) Ñera')).toBe('ÉÑ');
    expect(customerInitials('— —')).toBe('?');
    expect(customerInitials('')).toBe('?');
  });

  it('⚠ dials only the number at the start of a phone, and nothing that is not one', () => {
    expect(phoneHref('0917 123 4567')).toBe('tel:09171234567');
    expect(phoneHref('+63 (917) 123-4567 loc 2')).toBe('tel:+639171234567');
    expect(phoneHref('ask for 0917')).toBeNull();
    expect(phoneHref('123')).toBeNull();
    expect(phoneHref(null)).toBeNull();
  });

  it('⚠ makes a mailto that can only ever be the address', () => {
    expect(emailHref('juan@example.com')).toBe('mailto:juan@example.com');
    expect(emailHref('juan@example.com?subject=hi&cc=x@y.ph')).toBeNull();
    expect(emailHref('a&b@example.com')).toBe('mailto:a%26b@example.com');
    expect(emailHref('not an address')).toBeNull();
    expect(emailHref(null)).toBeNull();
  });

  it('sums a customer’s history: visits, what they paid less refunds, what they owe, when they last came', () => {
    const row = { status: 'paid', total: 1000, refunded: 0, paidAt: null, finalisedAt: null };
    const summary = customerSummary([
      { ...row, paidAt: '2026-09-30T02:00:00.000Z', createdAt: '2026-09-30T01:00:00.000Z' },
      { ...row, total: 500, refunded: 200, paidAt: '2026-10-01T05:00:00.000Z', createdAt: '2026-10-01T04:00:00.000Z' },
      {
        ...row,
        status: 'unpaid',
        total: 300,
        finalisedAt: '2026-10-02T03:00:00.000Z',
        createdAt: '2026-10-02T02:00:00.000Z',
      },
      { ...row, status: 'cancelled', total: 9000, createdAt: '2026-10-03T00:00:00.000Z' },
    ]);
    expect(summary).toEqual({ orders: 3, spent: 1300, owed: 300, lastAt: '2026-10-02T03:00:00.000Z' });
    expect(customerSummary([])).toEqual({ orders: 0, spent: 0, owed: 0, lastAt: null });
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

describe('listNeighbours', () => {
  const ids = ['a', 'b', 'c'];

  it('gives the rows either side and the place in the list', () => {
    expect(listNeighbours(ids, 'b')).toEqual({ previous: 'a', next: 'c', position: '2 of 3' });
  });

  it('has no previous at the top and no next at the bottom', () => {
    expect(listNeighbours(ids, 'a')).toEqual({ previous: null, next: 'b', position: '1 of 3' });
    expect(listNeighbours(ids, 'c')).toEqual({ previous: 'b', next: null, position: '3 of 3' });
  });

  it('steps nowhere from something that is not in the list', () => {
    const nowhere = { previous: null, next: null, position: null };
    expect(listNeighbours(ids, 'new')).toEqual(nowhere);
    expect(listNeighbours(ids, null)).toEqual(nowhere);
    expect(listNeighbours([], 'a')).toEqual(nowhere);
  });
});
