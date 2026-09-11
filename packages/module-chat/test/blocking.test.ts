import { CONTACT_REFUSED_MESSAGE, isContactBlocked, reachable } from '../src/domain/blocking.js';
import type { BlockView } from '../src/types.js';

const blocks: readonly BlockView[] = [{ blockerId: 'ann', blockedId: 'bob' }];

describe('isContactBlocked', () => {
  it('blocks the direction it was written in', () => {
    expect(isContactBlocked(blocks, 'bob', 'ann')).toBe(true);
  });

  it('⚠ blocks the OTHER direction too — a block is "we are not in contact"', () => {
    // One-way would let the blocker open a conversation with somebody they had
    // blocked, which is the reverse of what they asked for.
    expect(isContactBlocked(blocks, 'ann', 'bob')).toBe(true);
  });

  it('leaves everybody else alone', () => {
    expect(isContactBlocked(blocks, 'ann', 'cara')).toBe(false);
    expect(isContactBlocked([], 'ann', 'bob')).toBe(false);
  });
});

describe('reachable', () => {
  it('filters a group invite list down to who may still be added', () => {
    expect(reachable(blocks, 'ann', ['bob', 'cara'])).toEqual(['cara']);
  });
});

describe('CONTACT_REFUSED_MESSAGE', () => {
  it('⚠ says nothing about blocking, so the block is not a notification', () => {
    expect(CONTACT_REFUSED_MESSAGE).not.toMatch(/block/i);
  });
});
