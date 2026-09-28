import { rankAfter, rankBetween, rebalancedRanks, TASK_RANK_STEP } from '../src/domain/rank.js';

describe('rankBetween', () => {
  it('starts, prepends and appends a step apart', () => {
    expect(rankBetween(null, null)).toBe(TASK_RANK_STEP);
    expect(rankBetween(null, 1024)).toBe(0);
    expect(rankBetween(1024, null)).toBe(2048);
  });

  it('lands strictly between two neighbours', () => {
    const rank = rankBetween(1024, 2048);
    expect(rank).toBeGreaterThan(1024);
    expect(rank).toBeLessThan(2048);
  });

  it('⚠ says so (null) when there is no room left, rather than colliding', () => {
    let before = 1024;
    const after = 2048;
    let moves = 0;
    for (;;) {
      const next = rankBetween(before, after);
      if (next === null) break;
      expect(next).toBeGreaterThan(before);
      expect(next).toBeLessThan(after);
      before = next;
      moves += 1;
    }
    expect(moves).toBeGreaterThan(20);
    expect(rankBetween(5, 5)).toBeNull();
    expect(rankBetween(6, 5)).toBeNull();
  });
});

describe('rankAfter', () => {
  const list = [
    { id: 'a', rank: 1024 },
    { id: 'b', rank: 2048 },
    { id: 'c', rank: 3072 },
  ];

  it('moves to the top, between two, or to the end', () => {
    expect(rankAfter(list, 'c', null)).toBe(0);
    expect(rankAfter(list, 'c', 'a')).toBe(1536);
    expect(rankAfter(list, 'a', 'c')).toBe(4096);
  });

  it('reads neighbours without the moving item, so moving next to itself is ordinary', () => {
    expect(rankAfter(list, 'b', 'a')).toBe(2048);
  });

  it('refuses an anchor that is not in the list (undefined), never guesses', () => {
    expect(rankAfter(list, 'a', 'gone')).toBeUndefined();
  });

  it('rebalances without changing the order', () => {
    expect(rebalancedRanks([{ id: 'x' }, { id: 'y' }])).toEqual([
      { id: 'x', rank: 1024 },
      { id: 'y', rank: 2048 },
    ]);
  });
});
