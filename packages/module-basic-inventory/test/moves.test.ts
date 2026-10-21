import { checkReceive, costAfterReceipt, prepareAdjustment, prepareWaste, proposeWaste } from '../src/domain/moves.js';
import { orderLineOfKey, posLineKey, posRefundKey, posVoidKey } from '../src/domain/sources.js';
import { prepareStockCode, prepareStockName } from '../src/domain/text.js';
import type { StockUnit, StockUseLine } from '../src/types.js';

describe('receiving', () => {
  it('takes a positive quantity at a cost entered or not', () => {
    expect(checkReceive({ quantity: 500_000, unitCost: 420 }, 'sheet')).toBeNull();
    expect(checkReceive({ quantity: 500_000, unitCost: null }, 'sheet')).toBeNull();
    expect(checkReceive({ quantity: -1000, unitCost: 420 }, 'sheet')).toBe('invalid_quantity');
    expect(checkReceive({ quantity: 1000, unitCost: -1 }, 'sheet')).toBe('invalid_cost');
  });

  it('makes the latest cost the item’s, and leaves it when none was typed (I16)', () => {
    expect(costAfterReceipt(400, 420)).toBe(420);
    expect(costAfterReceipt(400, null)).toBe(400);
  });
});

describe('prepareAdjustment', () => {
  it('needs a note for “other”, and none for a named reason', () => {
    expect(prepareAdjustment({ quantity: -1000, reason: 'other' }, 'piece')).toEqual({ refused: 'note_required' });
    expect(prepareAdjustment({ quantity: -1000, reason: 'other', note: '  fell behind the shelf ' }, 'piece')).toEqual({
      quantity: -1000,
      reason: 'other',
      note: 'fell behind the shelf',
    });
    expect(prepareAdjustment({ quantity: 2000, reason: 'found' }, 'piece')).toEqual({
      quantity: 2000,
      reason: 'found',
      note: null,
    });
  });
});

describe('waste (I15)', () => {
  const uses: StockUseLine[] = [
    { refKind: 'item', refId: 'sintra', stockItemId: 'hook', quantityPerUnit: 1000 },
    { refKind: 'variant', refId: 'a3', stockItemId: 'board-a3', quantityPerUnit: 1000 },
  ];
  const units: Record<string, StockUnit> = { hook: 'piece', 'board-a3': 'piece', border: 'm' };
  const unitOf = (id: string): StockUnit | null => units[id] ?? null;

  it('proposes the product’s materials from both lists, as positive quantities to edit', () => {
    expect(proposeWaste(uses, { itemId: 'sintra', variantId: 'a3' }, 1)).toEqual([
      { stockItemId: 'board-a3', quantity: 1000 },
      { stockItemId: 'hook', quantity: 1000 },
    ]);
  });

  it('stores the edited lines as negative deltas with their reason', () => {
    expect(prepareWaste({ lines: [{ stockItemId: 'board-a3', quantity: 1000 }], reason: 'misprint' }, unitOf)).toEqual({
      lines: [{ stockItemId: 'board-a3', quantity: -1000 }],
      reason: 'misprint',
      note: null,
    });
  });

  it('refuses nothing to waste, another store’s item, a line twice, and a fraction of a piece', () => {
    expect(prepareWaste({ lines: [], reason: 'misprint' }, unitOf)).toEqual({ refused: 'no_change' });
    expect(prepareWaste({ lines: [{ stockItemId: 'elsewhere', quantity: 1000 }], reason: 'misprint' }, unitOf)).toEqual(
      { refused: 'not_found' },
    );
    expect(
      prepareWaste(
        {
          lines: [
            { stockItemId: 'hook', quantity: 1000 },
            { stockItemId: 'hook', quantity: 1000 },
          ],
          reason: 'misprint',
        },
        unitOf,
      ),
    ).toEqual({ refused: 'duplicate_use' });
    expect(prepareWaste({ lines: [{ stockItemId: 'hook', quantity: 500 }], reason: 'misprint' }, unitOf)).toEqual({
      refused: 'whole_units_only',
    });
  });
});

describe('source keys', () => {
  it('spell one key per event, and read the order line back', () => {
    expect(posLineKey('l1')).toBe('pos:line:l1');
    expect(orderLineOfKey(posLineKey('l1'))).toBe('l1');
    expect(orderLineOfKey(posVoidKey('l1'))).toBe('l1');
    expect(orderLineOfKey(posRefundKey('r1'))).toBeNull();
  });
});

describe('text', () => {
  it('normalises names and codes as the POS does', () => {
    expect(prepareStockName('  Photo   paper 4R ')).toEqual({ name: 'Photo paper 4R' });
    expect(prepareStockName('Pa​per')).toEqual({ refused: 'invalid_name' });
    expect(prepareStockCode(' paper 4r ')).toEqual({ code: 'PAPER4R' });
    expect(prepareStockCode('')).toEqual({ code: null });
  });
});
