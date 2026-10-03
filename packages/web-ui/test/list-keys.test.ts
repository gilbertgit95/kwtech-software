import { nextListIndex } from '../src/react/list-keys.js';

/** ↑ ↓ through a list's choices: the arithmetic every list shares. */
describe('nextListIndex', () => {
  const all = [true, true, true];

  it('takes the first on ↓ and the last on ↑ when nothing is focused yet', () => {
    expect(nextListIndex(all, null, 'down')).toBe(0);
    expect(nextListIndex(all, null, 'up')).toBe(2);
  });

  it('moves one and wraps at both ends, so a short list is never a dead end', () => {
    expect(nextListIndex(all, 0, 'down')).toBe(1);
    expect(nextListIndex(all, 2, 'down')).toBe(0);
    expect(nextListIndex(all, 0, 'up')).toBe(2);
  });

  it('goes to the first and last on Home and End', () => {
    expect(nextListIndex(all, 1, 'first')).toBe(0);
    expect(nextListIndex(all, 1, 'last')).toBe(2);
  });

  it('⚠ skips a choice that cannot be taken — the held order already on the till', () => {
    expect(nextListIndex([false, true, true], null, 'down')).toBe(1);
    expect(nextListIndex([true, false, true], 0, 'down')).toBe(2);
    expect(nextListIndex([true, true, false], 1, 'down')).toBe(0);
    expect(nextListIndex([false, true, false], null, 'first')).toBe(1);
    expect(nextListIndex([false, true, false], null, 'last')).toBe(1);
  });

  it('answers nothing for an empty list, or one with nothing to take', () => {
    expect(nextListIndex([], null, 'down')).toBeNull();
    expect(nextListIndex([false, false], 0, 'down')).toBeNull();
  });
});
