import { leftOf, stockBadge, stockKey, stockMap, stockWarning, tileLeft } from '../src/react/view/stock.js';

/** The till's view of the stock app's counts (INVENTORY-PLAN §6). */
describe('the till’s stock counts', () => {
  const view = {
    counts: true,
    levels: [
      { itemId: 'mug', variantId: null, left: 3 },
      { itemId: 'sintra', variantId: 'a4', left: 0 },
      { itemId: 'sintra', variantId: 'a3', left: 0 },
      { itemId: 'layout', variantId: null, left: null },
    ],
  };

  it('shows nothing when no stock app is connected, or for a product nobody counts', () => {
    expect(stockMap({ counts: false, levels: view.levels })).toBeNull();
    const map = stockMap(view);
    expect(leftOf(map, 'layout', null)).toBeNull();
    expect(leftOf(map, 'mug', null)).toBe(3);
    expect(stockKey('sintra', 'a4')).toBe('sintra:a4');
  });

  it('labels a count, low and out', () => {
    expect(stockBadge(null)).toBeNull();
    expect(stockBadge(12)).toEqual({ text: '12 left', tone: 'muted' });
    expect(stockBadge(3)).toEqual({ text: '3 left', tone: 'warning' });
    expect(stockBadge(-1)).toEqual({ text: 'Out of stock', tone: 'danger' });
  });

  it('marks a tile out only when every counted variant is out', () => {
    const map = stockMap(view);
    const variant = (id: string) => ({ id, archivedAt: null });
    expect(tileLeft(map, { id: 'sintra', variants: [variant('a4'), variant('a3')] } as never)).toBe(0);
    expect(tileLeft(map, { id: 'mug', variants: [] } as never)).toBe(3);
  });

  it('⚠ warns past what is left, and never refuses', () => {
    expect(stockWarning('Mug', 3, 3)).toBeNull();
    expect(stockWarning('Mug', 3, 4)).toContain('Only 3 Mug left');
    expect(stockWarning('Mug', 0, 1)).toContain('out of stock');
    expect(stockWarning('Layout fee', null, 50)).toBeNull();
  });
});
