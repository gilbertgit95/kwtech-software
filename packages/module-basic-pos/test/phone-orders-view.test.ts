import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { orderRowDetail, ordersListEmptyText, otherDaysLine } from '../src/react/view/manage.js';
import { phoneOrderNextStep } from '../src/react/view/phone-orders.js';

/** Orders on a phone (issue #72): what the screen draws, and that it only looks. */
describe('phoneOrderNextStep', () => {
  const order = { status: 'paid', changeOwed: 0, changeSettlement: null };

  it('sends a held order to Cashier, for somebody who may take payment', () => {
    expect(phoneOrderNextStep({ ...order, status: 'open' }, { takePayment: true })).toEqual({
      text: 'Waiting for payment. Take it in Cashier.',
      go: 'cashier',
    });
  });

  it('⚠ offers no way to Cashier to somebody who may not take payment there', () => {
    expect(phoneOrderNextStep({ ...order, status: 'open' }, { takePayment: false })).toEqual({
      text: 'Waiting for payment at the cashier.',
      go: null,
    });
  });

  it('points an unpaid order to the full screen, whoever is looking', () => {
    for (const takePayment of [true, false]) {
      expect(phoneOrderNextStep({ ...order, status: 'unpaid' }, { takePayment })).toEqual({
        text: 'To be paid later. Take the payment on the full screen’s Orders tab.',
        go: null,
      });
    }
  });

  it('says change is owed only while it is unsettled', () => {
    expect(phoneOrderNextStep({ ...order, changeOwed: 500 }, { takePayment: true })?.text).toBe(
      'Change is still owed to the customer. Settle it on the full screen’s Orders tab.',
    );
    expect(phoneOrderNextStep({ ...order, changeOwed: 500, changeSettlement: 'given' }, { takePayment: true })).toBe(
      null,
    );
    expect(phoneOrderNextStep({ ...order, changeOwed: 500, changeSettlement: 'tip' }, { takePayment: true })).toBe(
      null,
    );
  });

  it('asks nothing of a settled, cancelled, voided or unknown order', () => {
    for (const status of ['paid', 'cancelled', 'voided', 'something_new']) {
      expect(phoneOrderNextStep({ ...order, status }, { takePayment: true })).toBe(null);
    }
  });
});

describe('orderRowDetail', () => {
  const row = {
    number: 12,
    customerName: 'Ana',
    label: 'T5',
    itemCount: 3,
    paidAt: '2026-09-30T15:30:00Z',
    finalisedAt: '2026-09-30T15:00:00Z',
    createdAt: '2026-09-30T14:00:00Z',
  };

  it('names the customer, the items and when it was paid, in the workspace’s zone', () => {
    const text = orderRowDetail(row, 'Asia/Manila');
    expect(text.startsWith('Ana · 3 items · ')).toBe(true);
    // 15:30Z is 11:30 PM in Manila, the same day; 4:30 PM in London.
    expect(text).toContain('11:30');
    expect(orderRowDetail(row, 'Europe/London')).toContain('4:30');
  });

  it('falls back to the reference, and says "1 item"', () => {
    expect(
      orderRowDetail({ ...row, customerName: null, itemCount: 1 }, 'Asia/Manila').startsWith('T5 · 1 item · '),
    ).toBe(true);
  });

  it('does not repeat the name when it is already the title (no number yet)', () => {
    expect(orderRowDetail({ ...row, number: null }, 'Asia/Manila').startsWith('3 items · ')).toBe(true);
  });

  it('takes the moment that matters: paid, else finalised, else started', () => {
    const finalised = orderRowDetail({ ...row, paidAt: null }, 'UTC');
    expect(finalised).toContain('3:00');
    const started = orderRowDetail({ ...row, paidAt: null, finalisedAt: null }, 'UTC');
    expect(started).toContain('2:00');
  });
});

describe('otherDaysLine', () => {
  const settled = {
    counting: true,
    filter: 'unpaid' as const,
    listed: 0,
    listLoading: false,
    count: { data: { filter: 'unpaid' as const, count: 1 }, loading: false, error: null },
  };

  it('says how many more there are on other days once both reads are current', () => {
    expect(otherDaysLine(settled)).toBe('1 more unpaid order on other days');
  });

  it('⚠ says nothing while the count reads again, though it still holds its last answer', () => {
    expect(otherDaysLine({ ...settled, count: { ...settled.count, loading: true } })).toBe(null);
  });

  it('⚠ says nothing once the count failed, rather than the count before it', () => {
    expect(
      otherDaysLine({ ...settled, count: { ...settled.count, error: 'Could not count the orders on other days.' } }),
    ).toBe(null);
  });

  it('says nothing while the list reads, for another filter’s count, or when not counting', () => {
    expect(otherDaysLine({ ...settled, listLoading: true })).toBe(null);
    expect(otherDaysLine({ ...settled, filter: 'pending' })).toBe(null);
    expect(otherDaysLine({ ...settled, counting: false })).toBe(null);
    expect(otherDaysLine({ ...settled, count: { data: null, loading: false, error: null } })).toBe(null);
  });
});

describe('ordersListEmptyText', () => {
  const base = { loading: false, problem: null, searching: false, filter: 'all' as const, days: null };

  it('says why, in order: a range not finished, loading, a search, then none', () => {
    expect(ordersListEmptyText({ ...base, problem: 'Pick the last day.', loading: true, searching: true })).toBe(
      'Pick the last day.',
    );
    expect(ordersListEmptyText({ ...base, loading: true, searching: true })).toBe('Loading…');
    expect(ordersListEmptyText({ ...base, searching: true })).toBe('No orders match that search.');
    expect(ordersListEmptyText(base)).toBe('No orders yet.');
  });
});

/**
 * The wiring. There are no React render tests here (testing rules), so it is
 * checked by reading the source, as `live-status.test.ts` does.
 * ⚠ `__dirname`: this suite compiles to CommonJS.
 */
const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

describe('the phone’s Orders section', () => {
  const phone = read('src/react/components/phone-orders.tsx');

  it('lists through the same hook as the full screen’s Orders tab', () => {
    expect(phone).toMatch(/useOrderList\(state\)/);
    expect(read('src/react/components/orders-section.tsx')).toMatch(/useOrderList\(state, openOrderId\)/);
  });

  it('⚠ only looks: it never writes an order', () => {
    expect(phone).not.toMatch(/state\.(act|resume|clear)\(/);
    // The one read it makes of its own is the order in the sheet; the list is the hook's, which only reads.
    const calls = [...phone.matchAll(/client\.(\w+)\(/g)].map((match) => match[1]);
    expect(new Set(calls)).toEqual(new Set(['order']));
    const hook = read('src/react/use-order-list.ts');
    expect(new Set([...hook.matchAll(/client\.(\w+)\(/g)].map((match) => match[1]))).toEqual(new Set(['orders']));
  });

  it('prints the full screen’s reprint, marked with the date', () => {
    expect(phone).toMatch(/printHtml\(receiptHtml\(order, \{ timeZone, reprintedAt: new Date\(\) \}\)\)/);
  });

  it('is drawn by the phone app for its section key', () => {
    const app = read('src/mobile/pos-mobile-app.tsx');
    expect(app).toMatch(/shown === POS_MOBILE_SECTION\.orders \? <PhoneOrders state=\{state\} \/> : null/);
  });
});
