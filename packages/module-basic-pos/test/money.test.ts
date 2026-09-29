import {
  allocateByWeight,
  checkPosDiscount,
  checkPosPrice,
  checkPosQuantity,
  computeOrderTotals,
  discountAmount,
  discountSurvivesEdit,
  POS_PRICE_MAX,
  POS_QUANTITY_MAX,
  percentOf,
} from '../src/domain/money.js';

describe('prices, costs and quantities', () => {
  it('takes whole centavos from ₱0 to the cap', () => {
    expect(checkPosPrice(0)).toBeNull();
    expect(checkPosPrice(1250)).toBeNull();
    expect(checkPosPrice(12.5)).toBe('invalid_price');
    expect(checkPosPrice(-1)).toBe('invalid_price');
    expect(checkPosPrice(POS_PRICE_MAX + 1)).toBe('invalid_price');
  });

  it('⚠ takes whole quantities from 1 — a negative quantity would be a hidden refund', () => {
    expect(checkPosQuantity(1)).toBeNull();
    expect(checkPosQuantity(POS_QUANTITY_MAX)).toBeNull();
    expect(checkPosQuantity(0)).toBe('invalid_quantity');
    expect(checkPosQuantity(-2)).toBe('invalid_quantity');
    expect(checkPosQuantity(1.5)).toBe('invalid_quantity');
  });

  it('refuses a zero discount and a percentage over 100%', () => {
    expect(checkPosDiscount({ kind: 'amount', value: 10_000 })).toBeNull();
    expect(checkPosDiscount({ kind: 'percent', value: 10_000 })).toBeNull();
    expect(checkPosDiscount({ kind: 'amount', value: 0 })).toBe('invalid_discount');
    expect(checkPosDiscount({ kind: 'percent', value: 10_001 })).toBe('invalid_discount');
  });
});

describe('discounts', () => {
  it('rounds a percentage half up to the centavo', () => {
    expect(percentOf(1005, 1000)).toBe(101); // 100.5 → 101
    expect(percentOf(1004, 1000)).toBe(100); // 100.4 → 100
  });

  it('⚠ stays exact where a Number product would overflow', () => {
    const dearest = POS_PRICE_MAX * POS_QUANTITY_MAX;
    expect(percentOf(dearest, 3333)).toBe(Number((BigInt(dearest) * 3333n + 5000n) / 10000n));
  });

  it('⚠ never takes more than the line: ₱100 off a ₱15 line takes ₱15', () => {
    expect(discountAmount(1500, { kind: 'amount', value: 10_000 })).toBe(1500);
  });
});

describe('computeOrderTotals', () => {
  it('takes a fixed ₱100 off the WHOLE line: 100 magnets at ₱15 come to ₱1,400', () => {
    const totals = computeOrderTotals(
      [{ unitPrice: 1500, quantity: 100, discount: { kind: 'amount', value: 10_000 } }],
      null,
    );
    expect(totals).toMatchObject({ gross: 150_000, lineDiscounts: 10_000, subtotal: 140_000, total: 140_000 });
  });

  it('applies the order discount after line discounts, and spreads it over the lines exactly', () => {
    const totals = computeOrderTotals(
      [
        { unitPrice: 1500, quantity: 100, discount: { kind: 'amount', value: 10_000 } }, // 1,400
        { unitPrice: 4500, quantity: 2, discount: null }, // 90
      ],
      { kind: 'amount', value: 10_000 },
    );
    expect(totals.subtotal).toBe(149_000);
    expect(totals.orderDiscount).toBe(10_000);
    expect(totals.total).toBe(139_000);
    expect(totals.lines.reduce((sum, line) => sum + line.net, 0)).toBe(totals.total);
  });

  it('never goes below ₱0', () => {
    const totals = computeOrderTotals([{ unitPrice: 700, quantity: 1, discount: null }], {
      kind: 'amount',
      value: 5000,
    });
    expect(totals.total).toBe(0);
  });

  it('adds up an empty order to ₱0', () => {
    expect(computeOrderTotals([], null)).toMatchObject({ gross: 0, subtotal: 0, total: 0, lines: [] });
  });
});

describe('allocateByWeight', () => {
  it('⚠ sums to the amount exactly — three lines sharing ₱1.00 get 34 + 33 + 33, not 99', () => {
    expect(allocateByWeight(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });

  it('shares in proportion, and gives nothing to a ₱0 line', () => {
    expect(allocateByWeight(1000, [3000, 1000, 0])).toEqual([750, 250, 0]);
  });
});

describe('discountSurvivesEdit', () => {
  it('⚠ drops a FIXED discount when somebody who may not discount edits — 7 magnets must not be free', () => {
    expect(discountSurvivesEdit({ kind: 'amount', value: 10_000 }, false)).toBe(false);
  });

  it('keeps a percentage, which scales, and keeps anything when the editor may discount', () => {
    expect(discountSurvivesEdit({ kind: 'percent', value: 1000 }, false)).toBe(true);
    expect(discountSurvivesEdit({ kind: 'amount', value: 10_000 }, true)).toBe(true);
    expect(discountSurvivesEdit(null, false)).toBe(true);
  });
});
