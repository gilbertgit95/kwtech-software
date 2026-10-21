import { onHandByItem, stockLevel } from '../src/domain/levels.js';
import { planRefundReturn, planVoidReturn } from '../src/domain/returns.js';
import { planTakeDifferences, takeMoves } from '../src/domain/takes.js';
import { canStillMake, checkUseList, overlappingUses, planLineTakes } from '../src/domain/uses.js';
import type { StockUseLine } from '../src/types.js';

/*
 * The operator's example (2026-10-21): a Sintraboard Photo Print uses a hook
 * and 1.2 m of border at any size; A4 adds a board, one vinyl and one photo
 * top; A3 adds its board, two vinyl and two photo tops.
 */
const SINTRA = 'item-sintra';
const A4 = 'variant-a4';
const A3 = 'variant-a3';
const USES: StockUseLine[] = [
  { refKind: 'item', refId: SINTRA, stockItemId: 'hook', quantityPerUnit: 1000 },
  { refKind: 'item', refId: SINTRA, stockItemId: 'border', quantityPerUnit: 1200 },
  { refKind: 'variant', refId: A4, stockItemId: 'board-a4', quantityPerUnit: 1000 },
  { refKind: 'variant', refId: A4, stockItemId: 'vinyl', quantityPerUnit: 1000 },
  { refKind: 'variant', refId: A4, stockItemId: 'phototop', quantityPerUnit: 1000 },
  { refKind: 'variant', refId: A3, stockItemId: 'board-a3', quantityPerUnit: 1000 },
  { refKind: 'variant', refId: A3, stockItemId: 'vinyl', quantityPerUnit: 2000 },
  { refKind: 'variant', refId: A3, stockItemId: 'phototop', quantityPerUnit: 2000 },
];

describe('planLineTakes', () => {
  it('⚠ uses the item’s list AND the variant’s (I14)', () => {
    expect(planLineTakes(USES, { itemId: SINTRA, variantId: A3, quantity: 2 })).toEqual([
      { stockItemId: 'board-a3', quantity: -2000 },
      { stockItemId: 'border', quantity: -2400 },
      { stockItemId: 'hook', quantity: -2000 },
      { stockItemId: 'phototop', quantity: -4000 },
      { stockItemId: 'vinyl', quantity: -4000 },
    ]);
  });

  it('never takes another variant’s materials', () => {
    const takes = planLineTakes(USES, { itemId: SINTRA, variantId: A4, quantity: 1 });
    expect(takes.map((take) => take.stockItemId)).not.toContain('board-a3');
  });

  it('moves nothing for an item nothing uses', () => {
    expect(planLineTakes(USES, { itemId: 'item-untracked', variantId: null, quantity: 5 })).toEqual([]);
  });

  it('adds up a stock item on both lists', () => {
    const both: StockUseLine[] = [
      { refKind: 'item', refId: 'i', stockItemId: 'hook', quantityPerUnit: 1000 },
      { refKind: 'variant', refId: 'v', stockItemId: 'hook', quantityPerUnit: 1000 },
    ];
    expect(planLineTakes(both, { itemId: 'i', variantId: 'v', quantity: 1 })).toEqual([
      { stockItemId: 'hook', quantity: -2000 },
    ]);
    expect(overlappingUses(both)).toEqual(['hook']);
  });
});

describe('canStillMake', () => {
  it('is the fewest over the materials, never below zero', () => {
    const shelf = new Map([
      ['hook', 3000],
      ['border', 100_000],
      ['board-a3', 12_000],
      ['vinyl', 50_000],
      ['phototop', 50_000],
    ]);
    expect(canStillMake(USES, { itemId: SINTRA, variantId: A3 }, shelf)).toBe(3);
    expect(canStillMake(USES, { itemId: SINTRA, variantId: A3 }, new Map([['hook', -2000]]))).toBe(0);
  });

  it('is null — no count shown — when nothing it uses is tracked', () => {
    expect(canStillMake(USES, { itemId: 'item-untracked', variantId: null }, new Map())).toBeNull();
  });
});

describe('checkUseList', () => {
  it('refuses the same material twice on one list, and a quantity that is not positive', () => {
    expect(checkUseList([{ stockItemId: 'a', quantityPerUnit: 1000 }])).toBeNull();
    expect(
      checkUseList([
        { stockItemId: 'a', quantityPerUnit: 1000 },
        { stockItemId: 'a', quantityPerUnit: 500 },
      ]),
    ).toBe('duplicate_use');
    expect(checkUseList([{ stockItemId: 'a', quantityPerUnit: 0 }])).toBe('invalid_quantity');
  });
});

describe('returns', () => {
  const taken = [
    { stockItemId: 'mug', kind: 'for_sale' as const, taken: 2000, returned: 0 },
    { stockItemId: 'paper', kind: 'material' as const, taken: 2000, returned: 0 },
  ];

  it('a void puts back everything the line took, materials too', () => {
    expect(planVoidReturn(taken)).toEqual([
      { stockItemId: 'mug', quantity: 2000 },
      { stockItemId: 'paper', quantity: 2000 },
    ]);
  });

  it('⚠ a refund puts back only for-sale stock — the paper stays used', () => {
    expect(planRefundReturn(taken, 2, 1)).toEqual([{ stockItemId: 'mug', quantity: 1000 }]);
  });

  it('never puts back more than the line took, across refunds and a void', () => {
    const halfBack = [{ stockItemId: 'mug', kind: 'for_sale' as const, taken: 2000, returned: 1000 }];
    expect(planRefundReturn(halfBack, 2, 2)).toEqual([{ stockItemId: 'mug', quantity: 1000 }]);
    expect(planVoidReturn(halfBack)).toEqual([{ stockItemId: 'mug', quantity: 1000 }]);
    expect(planVoidReturn([{ ...halfBack[0], returned: 2000 } as (typeof halfBack)[number]])).toEqual([]);
  });
});

describe('stock takes', () => {
  it('⚠ compares against on hand at confirmation, and writes only what differs', () => {
    const differences = planTakeDifferences(
      [
        { stockItemId: 'a', counted: 10_000 },
        { stockItemId: 'b', counted: 5000 },
        { stockItemId: 'c', counted: null },
      ],
      new Map([
        ['a', 12_000],
        ['b', 5000],
        ['c', 7000],
      ]),
    );
    expect(differences.map((line) => line.stockItemId)).toEqual(['a', 'b']);
    expect(takeMoves(differences)).toEqual([{ stockItemId: 'a', quantity: -2000 }]);
  });
});

describe('levels', () => {
  it('adds up movements per item, and names how each stands', () => {
    const totals = onHandByItem([
      { stockItemId: 'a', quantity: 5000 },
      { stockItemId: 'a', quantity: -2000 },
      { stockItemId: 'b', quantity: -1000 },
    ]);
    expect(totals.get('a')).toBe(3000);
    expect(stockLevel(3000, 3000)).toBe('low');
    expect(stockLevel(3000, null)).toBe('ok');
    expect(stockLevel(0, null)).toBe('out');
    expect(stockLevel(totals.get('b') ?? 0, 1000)).toBe('negative');
  });
});
