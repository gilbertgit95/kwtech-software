import {
  phoneCashierSheet,
  quickCashAmounts,
  settledElsewhereText,
  waitingSummary,
} from '../src/react/view/phone-cashier.js';

describe('waitingSummary', () => {
  const now = new Date('2026-11-05T15:00:00Z');

  it('counts the waiting orders, adds up what they come to, and times the oldest', () => {
    expect(
      waitingSummary(
        [
          { total: 25_000, createdAt: '2026-11-05T14:40:00Z' },
          { total: 12_050, createdAt: '2026-11-05T14:00:00Z' },
        ],
        now,
      ),
    ).toEqual({ count: 2, total: 37_050, oldestMinutes: 60 });
  });

  it('times the earliest even when the list is not in order', () => {
    const summary = waitingSummary(
      [
        { total: 100, createdAt: '2026-11-05T14:50:00Z' },
        { total: 100, createdAt: '2026-11-05T13:00:00Z' },
      ],
      now,
    );
    expect(summary.oldestMinutes).toBe(120);
  });

  it('has no oldest with nothing waiting, or before the clock is read', () => {
    expect(waitingSummary([], now)).toEqual({ count: 0, total: 0, oldestMinutes: null });
    expect(waitingSummary([{ total: 10, createdAt: '2026-11-05T14:00:00Z' }], null).oldestMinutes).toBeNull();
  });
});

describe('phoneCashierSheet', () => {
  it('shows an open order to pay', () => {
    expect(phoneCashierSheet({ id: 'o1', status: 'open' }, null)).toBe('order');
  });

  it('shows the receipt only for the order this phone settled', () => {
    expect(phoneCashierSheet({ id: 'o1', status: 'paid' }, 'o1')).toBe('receipt');
    expect(phoneCashierSheet({ id: 'o1', status: 'unpaid' }, 'o1')).toBe('receipt');
  });

  it('⚠ never shows another till’s payment as this phone’s receipt', () => {
    expect(phoneCashierSheet({ id: 'o1', status: 'paid' }, null)).toBe('settled_elsewhere');
    expect(phoneCashierSheet({ id: 'o1', status: 'cancelled' }, 'o2')).toBe('settled_elsewhere');
  });

  it('has nothing to show on a clear till', () => {
    expect(phoneCashierSheet(null, 'o1')).toBe('none');
  });
});

describe('settledElsewhereText', () => {
  it('says what happened, by status', () => {
    expect(settledElsewhereText('paid')).toBe('This order was paid at another till.');
    expect(settledElsewhereText('cancelled')).toBe('This order was cancelled at another till.');
    expect(settledElsewhereText('voided')).toBe('This order was settled at another till.');
  });
});

describe('quickCashAmounts', () => {
  it('offers the exact total, then the total rounded up to the next bills', () => {
    // ₱645 → exact, then ₱650 (fifties), ₱660 (twenties), ₱700 (hundreds): smallest first, three of them.
    expect(quickCashAmounts(64_500)).toEqual([64_500, 65_000, 66_000, 70_000]);
  });

  it('never repeats an amount or offers one that is not above the total', () => {
    // ₱100 exactly: ₱20, ₱50 and ₱100 bills all round to ₱100, which is the total itself.
    expect(quickCashAmounts(10_000)).toEqual([10_000, 20_000, 50_000, 100_000]);
  });

  it('offers nothing for an empty order', () => {
    expect(quickCashAmounts(0)).toEqual([]);
  });
});
