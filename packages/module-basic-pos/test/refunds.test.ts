import { planRefund, refundLineAmount, refundState } from '../src/domain/refunds.js';

const NOTHING_YET = { quantities: {}, amount: 0 };

// Order #41: 2 laminations (₱90) and 3 magnets that came to ₱100 after a discount.
const ORDER = {
  status: 'paid' as const,
  total: 19_000,
  lines: [
    { id: 'lam', quantity: 2, net: 9000 },
    { id: 'mag', quantity: 3, net: 10_000 },
  ],
};

describe('refundLineAmount', () => {
  it('⚠ adds up to the line exactly, unit by unit: ₱33.33, ₱33.33, ₱33.34', () => {
    const line = { id: 'mag', quantity: 3, net: 10_000 };
    const parts = [refundLineAmount(line, 0, 1), refundLineAmount(line, 1, 1), refundLineAmount(line, 2, 1)];
    expect(parts).toEqual([3333, 3333, 3334]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10_000);
  });
});

describe('planRefund', () => {
  it('refunds 1 of 2 laminations for what was paid for it', () => {
    expect(planRefund(ORDER, NOTHING_YET, { kind: 'lines', lines: [{ lineId: 'lam', quantity: 1 }] })).toEqual({
      amount: 4500,
      lines: [{ lineId: 'lam', quantity: 1, amount: 4500 }],
    });
  });

  it('⚠ never refunds more units than were sold, counting earlier refunds', () => {
    const soFar = { quantities: { lam: 1 }, amount: 4500 };
    expect(planRefund(ORDER, soFar, { kind: 'lines', lines: [{ lineId: 'lam', quantity: 2 }] })).toEqual({
      refused: 'exceeds_sold',
    });
  });

  it('⚠ never refunds more money than was paid — by amount and by line draw on the same money', () => {
    const soFar = { quantities: {}, amount: 15_000 };
    expect(planRefund(ORDER, soFar, { kind: 'amount', amount: 5000 })).toEqual({ refused: 'exceeds_paid' });
    expect(planRefund(ORDER, soFar, { kind: 'lines', lines: [{ lineId: 'lam', quantity: 2 }] })).toEqual({
      refused: 'exceeds_paid',
    });
    expect(planRefund(ORDER, soFar, { kind: 'amount', amount: 4000 })).toEqual({ amount: 4000, lines: [] });
  });

  it('refunds only paid orders', () => {
    expect(planRefund({ ...ORDER, status: 'unpaid' }, NOTHING_YET, { kind: 'amount', amount: 100 })).toEqual({
      refused: 'not_paid',
    });
  });

  it('refuses a line not on the order, a line named twice, and a bad quantity or amount', () => {
    const lines = (list: { lineId: string; quantity: number }[]) => ({ kind: 'lines' as const, lines: list });
    expect(planRefund(ORDER, NOTHING_YET, lines([{ lineId: 'x', quantity: 1 }]))).toEqual({ refused: 'unknown_line' });
    expect(
      planRefund(
        ORDER,
        NOTHING_YET,
        lines([
          { lineId: 'lam', quantity: 1 },
          { lineId: 'lam', quantity: 1 },
        ]),
      ),
    ).toEqual({ refused: 'unknown_line' });
    expect(planRefund(ORDER, NOTHING_YET, lines([{ lineId: 'lam', quantity: 0 }]))).toEqual({
      refused: 'invalid_quantity',
    });
    expect(planRefund(ORDER, NOTHING_YET, { kind: 'amount', amount: 0 })).toEqual({ refused: 'invalid_amount' });
  });
});

describe('refundState', () => {
  it('is derived from what was refunded, never stored', () => {
    expect(refundState(19_000, 0)).toBe('none');
    expect(refundState(19_000, 4500)).toBe('partly');
    expect(refundState(19_000, 19_000)).toBe('full');
  });
});
