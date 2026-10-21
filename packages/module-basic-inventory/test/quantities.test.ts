import {
  checkStockQuantity,
  formatStockQuantity,
  parseStockQuantity,
  STOCK_QUANTITY_MAX,
  stockUnitLabel,
  stockValueAtCost,
} from '../src/domain/quantities.js';

describe('parseStockQuantity', () => {
  it('reads whole and decimal quantities as thousandths', () => {
    expect(parseStockQuantity('12', 'sheet')).toEqual({ quantity: 12_000 });
    expect(parseStockQuantity('1.5', 'm')).toEqual({ quantity: 1500 });
    expect(parseStockQuantity('0.25', 'l')).toEqual({ quantity: 250 });
    expect(parseStockQuantity(' 1,250 ', 'ml')).toEqual({ quantity: 1_250_000 });
  });

  it('⚠ never goes through a float — 1.005 is 1005 thousandths, not 1004', () => {
    expect(parseStockQuantity('1.005', 'kg')).toEqual({ quantity: 1005 });
  });

  it('refuses more than three decimals rather than rounding them', () => {
    expect(parseStockQuantity('1.0005', 'm')).toEqual({ refused: 'invalid_quantity' });
  });

  it('keeps piece, sheet and pack whole (I6)', () => {
    expect(parseStockQuantity('0.5', 'sheet')).toEqual({ refused: 'whole_units_only' });
    expect(parseStockQuantity('2.000', 'piece')).toEqual({ quantity: 2000 });
  });

  it('refuses zero, junk, and a negative unless asked for', () => {
    expect(parseStockQuantity('0', 'm')).toEqual({ refused: 'invalid_quantity' });
    expect(parseStockQuantity('abc', 'm')).toEqual({ refused: 'invalid_quantity' });
    expect(parseStockQuantity('-3', 'piece')).toEqual({ refused: 'invalid_quantity' });
    expect(parseStockQuantity('-3', 'piece', { allowNegative: true })).toEqual({ quantity: -3000 });
  });

  it('refuses a quantity past the cap, and a long paste before it reaches a float', () => {
    expect(parseStockQuantity('1000001', 'piece')).toEqual({ refused: 'invalid_quantity' });
    expect(parseStockQuantity('9'.repeat(30), 'piece')).toEqual({ refused: 'invalid_quantity' });
    expect(checkStockQuantity(STOCK_QUANTITY_MAX, 'piece')).toBeNull();
  });
});

describe('formatStockQuantity', () => {
  it('prints what parseStockQuantity reads back', () => {
    for (const quantity of [12_000, 1500, 250, 1005, -3000, 1]) {
      expect(parseStockQuantity(formatStockQuantity(quantity), 'm', { allowNegative: true })).toEqual({ quantity });
    }
    expect(formatStockQuantity(1500)).toBe('1.5');
    expect(formatStockQuantity(-250)).toBe('-0.25');
  });
});

describe('stockUnitLabel', () => {
  it('is singular for exactly one, and symbols never take an s', () => {
    expect(stockUnitLabel('sheet', 1000)).toBe('sheet');
    expect(stockUnitLabel('sheet', 2000)).toBe('sheets');
    expect(stockUnitLabel('m', 1500)).toBe('m');
  });
});

describe('stockValueAtCost', () => {
  it('values thousandths at a cost per whole unit, half up', () => {
    expect(stockValueAtCost(12_000, 420)).toBe(5040);
    expect(stockValueAtCost(1500, 333)).toBe(500);
    expect(stockValueAtCost(1, 499)).toBe(0);
    expect(stockValueAtCost(1, 500)).toBe(1);
  });

  it('is null without a cost, and zero for nothing or a wrong (negative) count', () => {
    expect(stockValueAtCost(5000, null)).toBeNull();
    expect(stockValueAtCost(0, 100)).toBe(0);
    expect(stockValueAtCost(-5000, 100)).toBe(0);
  });

  it('⚠ stays exact past 2⁵³', () => {
    expect(stockValueAtCost(STOCK_QUANTITY_MAX, 100_000_000)).toBe(100_000_000_000_000);
  });
});
