import { clampCopies } from '../src/react/components/output-bar.js';

describe('the number of copies', () => {
  it('stays a whole number between 1 and 99, whatever is typed or stepped to', () => {
    expect([0, 1, 2.9, 99, 100, -4, Number.NaN].map(clampCopies)).toEqual([1, 1, 2, 99, 99, 1, 1]);
  });
});
