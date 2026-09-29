import { type PosSearchItem, parseQuantityPrefix, searchItems } from '../src/domain/search.js';

function variant(id: string, name: string, code: string | null, price: number, archived = false) {
  return { id, name, code, price, archived };
}

const CATALOGUE: PosSearchItem[] = [
  {
    id: 'lam',
    name: 'Lamination',
    code: null,
    categoryName: 'Lamination',
    price: 0,
    archived: false,
    variants: [
      variant('l1-id', '125 mic · ID', 'L1-ID', 2000),
      variant('l1-a4', '125 mic · A4', 'L1-A4', 3500),
      variant('l2-a4', '250 mic · A4', 'L2-A4', 4500),
      variant('l2-long', '250 mic · Long', 'L2-LONG', 6000, true),
    ],
  },
  {
    id: 'mag',
    name: 'Ref magnet',
    code: 'MAG',
    categoryName: 'Souvenirs',
    price: 1500,
    archived: false,
    variants: [],
  },
  { id: 'cafe', name: 'Café latte', code: null, categoryName: null, price: 12_000, archived: false, variants: [] },
  { id: 'old', name: 'Old folder', code: 'OLD', categoryName: null, price: 1200, archived: true, variants: [] },
];

describe('searchItems', () => {
  it('finds the item, not every variant, when the words match the item: "lam" opens the picker', () => {
    expect(searchItems(CATALOGUE, 'lam')).toEqual([
      expect.objectContaining({ itemId: 'lam', variantId: null, opensPicker: true, price: { min: 2000, max: 4500 } }),
    ]);
  });

  it('goes straight to the variants when the words need them: "lam a4", in any order', () => {
    const labels = (query: string) => searchItems(CATALOGUE, query).map((result) => result.label);
    expect(labels('lam a4')).toEqual(['Lamination — 125 mic · A4', 'Lamination — 250 mic · A4']);
    expect(labels('a4 250')).toEqual(['Lamination — 250 mic · A4']);
  });

  it('⚠ puts an exact code first, alone, so Enter adds exactly that — and later a scanner does too', () => {
    expect(searchItems(CATALOGUE, 'l2-a4')[0]).toMatchObject({ variantId: 'l2-a4', opensPicker: false });
    expect(searchItems(CATALOGUE, 'MAG')[0]).toMatchObject({ itemId: 'mag', variantId: null });
  });

  it('matches partial words, and ignores case and accents', () => {
    expect(searchItems(CATALOGUE, 'magn')[0]?.itemId).toBe('mag');
    expect(searchItems(CATALOGUE, 'CAFE')[0]?.itemId).toBe('cafe');
    expect(searchItems(CATALOGUE, 'souv')[0]?.itemId).toBe('mag');
  });

  it('ranks word starts above matches inside a word', () => {
    const catalogue: PosSearchItem[] = [
      { id: 'a', name: 'Premium ink', code: null, categoryName: null, price: 1, archived: false, variants: [] },
      { id: 'b', name: 'Ink refill', code: null, categoryName: null, price: 1, archived: false, variants: [] },
      { id: 'c', name: 'Pink paper', code: null, categoryName: null, price: 1, archived: false, variants: [] },
    ];
    expect(searchItems(catalogue, 'ink').map((result) => result.itemId)).toEqual(['b', 'a', 'c']);
  });

  it('never shows archived items or variants, and guesses nothing when nothing matches', () => {
    expect(searchItems(CATALOGUE, 'old')).toEqual([]);
    expect(searchItems(CATALOGUE, 'lam long')).toEqual([]);
    expect(searchItems(CATALOGUE, 'lamx')).toEqual([]);
    expect(searchItems(CATALOGUE, '   ')).toEqual([]);
  });
});

describe('parseQuantityPrefix', () => {
  it('reads the grocery habit "100*" and leaves the rest to search', () => {
    expect(parseQuantityPrefix('100*ref')).toEqual({ quantity: 100, text: 'ref' });
    expect(parseQuantityPrefix('100 * ')).toEqual({ quantity: 100, text: '' });
    expect(parseQuantityPrefix('ref magnet')).toEqual({ quantity: 1, text: 'ref magnet' });
  });

  it('says so instead of quietly adding one when the quantity is not allowed', () => {
    expect(parseQuantityPrefix('0*ref')).toEqual({ refused: 'invalid_quantity' });
    expect(parseQuantityPrefix('99999*')).toEqual({ refused: 'invalid_quantity' });
  });
});
