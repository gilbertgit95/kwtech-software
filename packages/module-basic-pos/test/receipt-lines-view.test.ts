import type { ReceiptPrinterChoice } from '@kwtech/module-kit';
import type { PosOrderLineView, PosOrderView } from '../src/react/pos-client.js';
import {
  pickedReceiptPrinter,
  receiptLines,
  receiptMoney,
  receiptPrinterDetail,
  receiptTargetText,
} from '../src/react/view/receipt-lines.js';

const LINE: PosOrderLineView = {
  id: 'l1',
  itemId: 'coffee',
  variantId: null,
  name: 'Iced coffee',
  kind: 'product',
  variantName: 'Large',
  code: null,
  categoryName: null,
  unitPrice: 9000,
  unitCost: null,
  quantity: 2,
  note: 'less ice',
  discount: { kind: 'percent', value: 1000, reason: 'Senior', givenById: 'u', givenAt: '2026-10-01T15:01:00Z' },
  discountAmount: 1800,
  gross: 18000,
  total: 16200,
  net: 16200,
  refundedQuantity: 0,
};

const ORDER: PosOrderView = {
  id: 'o1',
  status: 'paid',
  version: 3,
  number: 41,
  label: 'Table 5',
  orderTypeId: 't',
  orderTypeName: 'Dine-in',
  customerId: null,
  customerName: 'Juan',
  customerContact: '0917',
  lines: [LINE],
  gross: 18000,
  lineDiscounts: 1800,
  subtotal: 16200,
  discount: null,
  orderDiscount: 0,
  total: 16200,
  paymentMethod: 'cash',
  received: 20000,
  change: 3800,
  tip: 0,
  paymentReference: null,
  changeOwed: 0,
  changeSettlement: null,
  changeSettledAt: null,
  refunds: [],
  refunded: 0,
  refundState: 'none',
  createdById: 'u',
  createdAt: '2026-10-01T15:00:00Z',
  finalisedAt: '2026-10-01T15:05:00Z',
  finalisedById: 'u',
  releasedUnpaid: false,
  // 23:05 in Manila, the 1st; 15:05 in UTC.
  paidAt: '2026-10-01T15:05:00Z',
  paidById: 'u',
  cancelledAt: null,
  cancelReason: null,
  voidedAt: null,
  voidReason: null,
};

const texts = (lines: ReturnType<typeof receiptLines>) =>
  lines.map((line) => {
    switch (line.kind) {
      case 'text':
        return line.text;
      case 'pair':
        return `${line.left} | ${line.right}`;
      default:
        return `[${line.kind}]`;
    }
  });

describe('a sale as a receipt printer’s lines (#144, R5)', () => {
  it('heads it with the shop, the number and the time in the workspace’s zone, then items, totals and payment', () => {
    const lines = receiptLines(ORDER, { timeZone: 'Asia/Manila', storeName: 'Kape Tayo' });
    expect(lines[0]).toEqual({ kind: 'text', text: 'Kape Tayo', align: 'center', bold: true, size: 'double' });
    expect(texts(lines)).toEqual([
      'Kape Tayo',
      'RECEIPT #41',
      expect.stringMatching(/Oct 1, 2026.*11:05/u),
      'Dine-in',
      'Order ref: Table 5',
      'Juan - 0917',
      '[divider]',
      'Iced coffee — Large | PHP 180.00',
      '  2 x PHP 90.00',
      expect.stringMatching(/^ {2}10% \(Senior\) \| -PHP 18\.00$/u),
      '  Note: less ice',
      '[divider]',
      'Subtotal | PHP 162.00',
      'TOTAL | PHP 162.00',
      'Cash | PHP 200.00',
      'Change | PHP 38.00',
      '[feed]',
      'Thank you!',
      '[cut]',
      '[drawer]',
    ]);
  });

  it('reads the day in the workspace’s zone, not UTC', () => {
    expect(texts(receiptLines(ORDER, { timeZone: 'Europe/London' }))[1]).toMatch(/Oct 1, 2026.*4:05/u);
    expect(texts(receiptLines({ ...ORDER, paidAt: '2026-10-01T16:30:00Z' }, { timeZone: 'Asia/Manila' }))[1]).toMatch(
      /Oct 2, 2026/u,
    );
  });

  it('⚠ marks a reprint, with its time, and never opens the drawer for one', () => {
    const lines = receiptLines(ORDER, { timeZone: 'Asia/Manila', reprintedAt: new Date('2026-10-02T01:00:00Z') });
    expect(texts(lines)).toContainEqual(expect.stringMatching(/^REPRINT - /u));
    expect(lines.some((line) => line.kind === 'drawer')).toBe(false);
  });

  it('opens the drawer only for cash, and shows a card’s reference', () => {
    const card = receiptLines(
      { ...ORDER, paymentMethod: 'card', change: 0, received: 16200, paymentReference: 'AUTH 77' },
      { timeZone: 'Asia/Manila' },
    );
    expect(card.some((line) => line.kind === 'drawer')).toBe(false);
    expect(texts(card)).toContain('Reference | AUTH 77');
  });

  it('prints an unpaid slip as one, with what is still to pay', () => {
    const slip = texts(receiptLines({ ...ORDER, status: 'unpaid', paymentMethod: null }, { timeZone: 'Asia/Manila' }));
    expect(slip).toContain('ORDER SLIP - UNPAID #41');
    expect(slip).toContain('To pay | PHP 162.00');
    expect(slip).not.toContain('[drawer]');
  });

  it('spells the peso out, which a roll’s character table has no sign for', () => {
    expect(receiptMoney(150000)).toBe('PHP 1,500.00');
  });
});

describe('where a receipt prints, as the cashier reads it', () => {
  const PRINTER: ReceiptPrinterChoice = {
    id: 'p1',
    name: 'Counter 2',
    computer: 'Front desk PC',
    paperWidth: 80,
    isDefault: true,
    blocked: null,
    offlineSince: null,
  };
  const NOW = new Date('2026-11-15T06:00:00Z');

  it('says the printer and whether it is online, under the button', () => {
    expect(receiptTargetText(PRINTER)).toBe('on Counter 2 · Online');
    expect(receiptTargetText({ ...PRINTER, blocked: 'offline' })).toBe('on Counter 2 · Offline');
    expect(receiptTargetText(null)).toBe('Choose a receipt printer.');
  });

  it('lists its computer, width and default, and since when it is offline: a time today, a date before', () => {
    expect(receiptPrinterDetail(PRINTER, 'Asia/Manila', NOW)).toBe(
      'Front desk PC · 80 mm · workspace default · Online',
    );
    const today = { ...PRINTER, isDefault: false, blocked: 'off', offlineSince: '2026-11-15T01:02:00Z' };
    expect(receiptPrinterDetail(today, 'Asia/Manila', NOW)).toMatch(/^Front desk PC · 80 mm · Offline since 9:02/u);
    const before = { ...today, offlineSince: '2026-11-13T01:02:00Z' };
    expect(receiptPrinterDetail(before, 'Asia/Manila', NOW)).toMatch(/Offline since Nov 13, 2026/u);
  });

  it('finds the picked printer, or none when it asks', () => {
    expect(pickedReceiptPrinter([PRINTER], { kind: 'printer', printerId: 'p1', because: 'default' })).toBe(PRINTER);
    expect(pickedReceiptPrinter([PRINTER], { kind: 'ask', reason: 'Choose' })).toBeNull();
  });
});
