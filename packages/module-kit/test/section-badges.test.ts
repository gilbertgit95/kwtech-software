import { sectionBadgeLabel, withSectionBadge } from '../src/section-badges.js';

describe('withSectionBadge', () => {
  it('sets, changes and clears one section’s count, leaving the others', () => {
    const one = withSectionBadge({}, 'pos', 'cashier', 3);
    expect(one).toEqual({ pos: { cashier: 3 } });
    const two = withSectionBadge(withSectionBadge(one, 'pos', 'sell', 1), 'pos', 'cashier', 5);
    expect(two).toEqual({ pos: { cashier: 5, sell: 1 } });
    expect(withSectionBadge(two, 'pos', 'cashier', null)).toEqual({ pos: { sell: 1 } });
    expect(withSectionBadge(two, 'pos', 'cashier', 0)).toEqual({ pos: { sell: 1 } });
  });

  it('⚠ returns the same object when nothing changed, so the frame does not re-render', () => {
    const badges = withSectionBadge({}, 'pos', 'cashier', 3);
    expect(withSectionBadge(badges, 'pos', 'cashier', 3)).toBe(badges);
    expect(withSectionBadge(badges, 'pos', 'sell', null)).toBe(badges);
  });
});

describe('sectionBadgeLabel', () => {
  it('shows nothing for none, the number, or 99+', () => {
    expect(sectionBadgeLabel(undefined)).toBeNull();
    expect(sectionBadgeLabel(0)).toBeNull();
    expect(sectionBadgeLabel(7)).toBe('7');
    expect(sectionBadgeLabel(140)).toBe('99+');
  });
});
