import type { PosCatalogueView, PosOrderLineView, PosOrderView } from '../src/react/pos-client.js';
import { formatPercent, formatPeso, parsePercent, parsePeso, pesoInputValue } from '../src/react/view/money.js';
import { previewPayment } from '../src/react/view/payment.js';
import { receiptHtml } from '../src/react/view/receipt.js';
import { gridCategories, gridItems, itemCount, lineLabel, priceNow, searchCatalogue } from '../src/react/view/till.js';

describe('money on screen', () => {
  it('prints pesos with two decimals', () => {
    expect(formatPeso(150_000)).toBe('₱1,500.00');
    expect(formatPeso(5)).toBe('₱0.05');
  });

  it('⚠ parses what the cashier typed from the TEXT — 0.29 is 29 centavos, never 28', () => {
    expect(parsePeso('0.29')).toBe(29);
    expect(parsePeso('₱1,500.5')).toBe(150_050);
    expect(parsePeso(' 15 ')).toBe(1500);
    expect(parsePeso('1500.')).toBe(150_000);
  });

  it('refuses what is not an amount rather than rounding it', () => {
    expect(parsePeso('1.234')).toBeNull();
    expect(parsePeso('-5')).toBeNull();
    expect(parsePeso('abc')).toBeNull();
    expect(parsePeso('')).toBeNull();
  });

  it('reads and prints percentages as basis points', () => {
    expect(parsePercent('12.5')).toBe(1250);
    expect(parsePercent('100')).toBe(10_000);
    expect(parsePercent('101')).toBeNull();
    expect(formatPercent(1250)).toBe('12.5%');
    expect(formatPercent(1000)).toBe('10%');
    expect(pesoInputValue(150_050)).toBe('1500.50');
  });
});

const CATALOGUE: PosCatalogueView = {
  costsVisible: false,
  categories: [
    { id: 'c-lam', name: 'Lamination', sortOrder: 0, archivedAt: null },
    { id: 'c-empty', name: 'Empty', sortOrder: 1, archivedAt: null },
  ],
  items: [
    {
      id: 'lam',
      kind: 'service',
      name: 'Lamination',
      code: null,
      description: null,
      price: 0,
      cost: null,
      categoryId: 'c-lam',
      archivedAt: null,
      variants: [
        { id: 'a4', itemId: 'lam', name: 'A4', code: 'L-A4', price: 4500, cost: null, sortOrder: 0, archivedAt: null },
        {
          id: 'old',
          itemId: 'lam',
          name: 'Old',
          code: null,
          price: 1,
          cost: null,
          sortOrder: 1,
          archivedAt: '2026-01-01',
        },
      ],
    },
    {
      id: 'mag',
      kind: 'product',
      name: 'Magnet',
      code: 'MAG',
      description: null,
      price: 1500,
      cost: null,
      categoryId: null,
      archivedAt: null,
      variants: [],
    },
    {
      id: 'gone',
      kind: 'product',
      name: 'Gone',
      code: null,
      description: null,
      price: 1,
      cost: null,
      categoryId: null,
      archivedAt: '2026-01-01',
      variants: [],
    },
  ],
};

const line = (overrides: Partial<PosOrderLineView>): PosOrderLineView => ({
  id: 'l1',
  itemId: 'mag',
  variantId: null,
  name: 'Magnet',
  kind: 'product',
  variantName: null,
  code: 'MAG',
  categoryName: null,
  unitPrice: 1500,
  unitCost: null,
  quantity: 2,
  note: null,
  discount: null,
  discountAmount: 0,
  gross: 3000,
  total: 3000,
  net: 3000,
  refundedQuantity: 0,
  ...overrides,
});

describe('the till’s view rules', () => {
  it('feeds the search the catalogue with category names and archived flags', () => {
    const lamination = searchCatalogue(CATALOGUE)[0];
    expect(lamination).toMatchObject({
      categoryName: 'Lamination',
      variants: [{ archived: false }, { archived: true }],
    });
  });

  it('shows live items in the grid, and only categories with something to sell', () => {
    expect(gridItems(CATALOGUE, null).map((item) => item.id)).toEqual(['lam', 'mag']);
    expect(gridItems(CATALOGUE, 'c-lam').map((item) => item.id)).toEqual(['lam']);
    expect(gridCategories(CATALOGUE).map((category) => category.id)).toEqual(['c-lam']);
  });

  it('⚠ says a held line’s price has moved — and says nothing when it has not', () => {
    const moved = {
      ...CATALOGUE,
      items: CATALOGUE.items.map((item) => (item.id === 'mag' ? { ...item, price: 2000 } : item)),
    };
    expect(priceNow(line({}), moved)).toBe(2000);
    expect(priceNow(line({}), CATALOGUE)).toBeNull();
    expect(priceNow(line({ itemId: 'gone' }), CATALOGUE)).toBeNull();
  });

  it('counts items and names lines as the receipt does', () => {
    expect(itemCount([{ quantity: 100 }, { quantity: 2 }])).toBe(102);
    expect(lineLabel({ name: 'Lamination', variantName: '250 mic · A4' })).toBe('Lamination — 250 mic · A4');
  });
});

describe('the payment screen', () => {
  const walkIn = { name: null, contact: null };
  const juan = { name: 'Juan', contact: '0917' };

  it('shows the change on cash, and keeps it all as a tip when asked', () => {
    expect(previewPayment(700, { method: 'cash', received: 1000, keepTip: false, owe: false }, walkIn)).toEqual({
      ok: true,
      change: 300,
      tip: 0,
      changeOwed: 0,
    });
    expect(previewPayment(700, { method: 'cash', received: 1000, keepTip: true, owe: false }, walkIn)).toMatchObject({
      change: 0,
      tip: 300,
    });
  });

  it('owes the change only with a customer, and only on cash', () => {
    expect(
      previewPayment(90_000, { method: 'cash', received: 100_000, keepTip: false, owe: true }, walkIn),
    ).toMatchObject({
      ok: false,
    });
    expect(
      previewPayment(90_000, { method: 'cash', received: 100_000, keepTip: false, owe: true }, juan),
    ).toMatchObject({
      ok: true,
      change: 0,
      changeOwed: 10_000,
    });
  });

  it('⚠ refuses change on e-wallet, and too little of anything, in words', () => {
    const ewallet = previewPayment(700, { method: 'ewallet', received: 1000, keepTip: false, owe: false }, walkIn);
    expect(ewallet).toMatchObject({ ok: false, problem: expect.stringContaining('no change') });
    const short = previewPayment(700, { method: 'cash', received: 500, keepTip: false, owe: false }, walkIn);
    expect(short).toMatchObject({ ok: false, problem: expect.stringContaining('less than the total') });
  });
});

describe('the receipt', () => {
  const ORDER: PosOrderView = {
    id: 'o1',
    status: 'paid',
    version: 3,
    number: 41,
    label: null,
    customerId: null,
    customerName: 'Juan <script>',
    customerContact: null,
    lines: [line({ note: 'rush' })],
    gross: 3000,
    lineDiscounts: 0,
    subtotal: 3000,
    discount: null,
    orderDiscount: 0,
    total: 3000,
    paymentMethod: 'cash',
    received: 5000,
    change: 2000,
    tip: 0,
    paymentReference: null,
    changeOwed: 0,
    changeSettlement: null,
    changeSettledAt: null,
    refunds: [],
    refunded: 0,
    refundState: 'none',
    createdById: 'u',
    createdAt: '2026-10-01T02:00:00Z',
    finalisedAt: '2026-10-01T02:05:00Z',
    finalisedById: 'u',
    releasedUnpaid: false,
    paidAt: '2026-10-01T02:05:00Z',
    paidById: 'u',
    cancelledAt: null,
    cancelReason: null,
    voidedAt: null,
    voidReason: null,
  };

  it('prints the number, lines, note, total and change', () => {
    const html = receiptHtml(ORDER, { timeZone: 'Asia/Manila' });
    for (const text of ['RECEIPT #41', 'Magnet', 'Note: rush', '₱30.00', 'Change', '₱20.00']) {
      expect(html).toContain(text);
    }
  });

  it('⚠ escapes what people typed — a name is text, never markup', () => {
    const html = receiptHtml(ORDER, { timeZone: 'Asia/Manila' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('Juan &#60;script&#62;');
  });

  it('⚠ marks a reprint, and an unpaid slip, so neither passes for a paid original', () => {
    expect(receiptHtml(ORDER, { timeZone: 'Asia/Manila', reprintedAt: new Date('2026-10-02T01:00:00Z') })).toContain(
      'REPRINT',
    );
    const slip = receiptHtml({ ...ORDER, status: 'unpaid', paymentMethod: null }, { timeZone: 'Asia/Manila' });
    expect(slip).toContain('UNPAID');
    expect(slip).toContain('To pay');
  });
});
