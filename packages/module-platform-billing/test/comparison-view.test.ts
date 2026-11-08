import { capCell, featureGroups, priceCell } from '../src/react/view/comparison-view.js';

/** #101: the plan comparison's cells, in words. */
describe('the plan comparison’s cells', () => {
  it('says a cap as a number, "No limit", or a dash when the plan says nothing', () => {
    expect(capCell(5000)).toBe('5,000');
    expect(capCell(null)).toBe('No limit');
    expect(capCell(undefined)).toBe('—');
  });

  it('says a price, Free, or why there is none', () => {
    expect(priceCell({ monthly: 50_000, offered: true }, 'PHP')).toMatch(/500\.00 a month$/);
    expect(priceCell({ monthly: 0, offered: true }, 'PHP')).toBe('Free');
    expect(priceCell({ monthly: null, offered: true }, 'PHP')).toBe('No price set');
    // The organization's own Custom plan: listed, never for sale.
    expect(priceCell({ monthly: 90_000, offered: false }, 'PHP')).toBe('Not on offer');
  });

  it('groups the features by module, in the order they come', () => {
    const groups = featureGroups({
      features: [
        { key: 'pos:sell', label: 'Sell', module: 'pos' },
        { key: 'note:read', label: 'Notes', module: 'note' },
        { key: 'pos:refund', label: 'Refund', module: 'pos' },
      ],
    });
    expect(groups.map((g) => [g.module, g.features.map((f) => f.key)])).toEqual([
      ['pos', ['pos:sell', 'pos:refund']],
      ['note', ['note:read']],
    ]);
  });
});
