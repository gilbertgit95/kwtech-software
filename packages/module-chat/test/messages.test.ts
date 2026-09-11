import {
  canEditMessage,
  countsAsUnread,
  DEFAULT_PAGE_SIZE,
  editPatch,
  MAX_BODY_CODE_POINTS,
  MAX_PAGE_SIZE,
  pageSize,
  prepareBody,
  refuseDelete,
} from '../src/domain/messages.js';
import type { MessageKind, MessageView, ParticipantStatus, ParticipantView } from '../src/types.js';

const message = (over: Partial<MessageView> = {}): MessageView => ({
  id: 'm1',
  conversationId: 'c1',
  kind: 'user' as MessageKind,
  authorId: 'author',
  createdAt: new Date('2026-09-11T10:00:00Z'),
  deletedAt: null,
  ...over,
});

const participant = (status: ParticipantStatus, userId = 'author'): ParticipantView => ({
  conversationId: 'c1',
  userId,
  status,
});

describe('prepareBody', () => {
  it('trims, because a message of spaces is an empty one with extra steps', () => {
    expect(prepareBody('  hello  ')).toEqual({ body: 'hello' });
    expect(prepareBody('   ')).toEqual({ refused: 'empty' });
  });

  it('accepts a body exactly at the cap', () => {
    expect(prepareBody('a'.repeat(MAX_BODY_CODE_POINTS))).toEqual({ body: 'a'.repeat(MAX_BODY_CODE_POINTS) });
  });

  it('refuses one past it', () => {
    expect(prepareBody('a'.repeat(MAX_BODY_CODE_POINTS + 1))).toEqual({ refused: 'too_long' });
  });

  it('⚠ counts CODE POINTS, so emoji are not charged double', () => {
    // '👍' is two UTF-16 units. Counted with .length, a legal message of 2000
    // of them would be refused — and reported as "chat truncates my messages"
    // by exactly the people most likely to use emoji.
    const thumbs = '👍'.repeat(MAX_BODY_CODE_POINTS);
    expect(thumbs.length).toBe(MAX_BODY_CODE_POINTS * 2);
    expect(prepareBody(thumbs)).toEqual({ body: thumbs });
  });

  it('trims BEFORE measuring, so trailing whitespace cannot push a legal body over', () => {
    expect(prepareBody(`${'a'.repeat(MAX_BODY_CODE_POINTS)}   `)).toEqual({ body: 'a'.repeat(MAX_BODY_CODE_POINTS) });
  });
});

describe('pageSize', () => {
  it('defaults when nothing sensible is asked for', () => {
    for (const asked of [undefined, null, 0, -5, 1.5]) {
      expect(pageSize(asked)).toBe(DEFAULT_PAGE_SIZE);
    }
  });

  it('⚠ clamps, because an unbounded page is a request for a hundred thousand rows', () => {
    expect(pageSize(10)).toBe(10);
    expect(pageSize(100_000)).toBe(MAX_PAGE_SIZE);
  });
});

describe('canEditMessage', () => {
  it('is the author’s alone', () => {
    expect(canEditMessage(message(), 'author')).toBe(true);
    expect(canEditMessage(message(), 'somebody-else')).toBe(false);
  });

  it('refuses a deleted message and a system one', () => {
    expect(canEditMessage(message({ deletedAt: new Date() }), 'author')).toBe(false);
    expect(canEditMessage(message({ kind: 'system', authorId: null }), 'author')).toBe(false);
  });
});

describe('editPatch', () => {
  it('⚠ never touches createdAt — an edit must not move a message in the thread', () => {
    const patch = editPatch('new text', new Date('2026-09-11T11:00:00Z'));

    expect(Object.keys(patch).sort()).toEqual(['body', 'editedAt']);
    expect(patch).not.toHaveProperty('createdAt');
  });
});

describe('refuseDelete', () => {
  it('lets an author delete their own without any moderation key', () => {
    expect(refuseDelete(message(), participant('active', 'author'), { mayModerate: false })).toBeNull();
  });

  it('lets a moderator delete somebody else’s, inside a conversation they are IN', () => {
    expect(refuseDelete(message(), participant('active', 'mod'), { mayModerate: true })).toBeNull();
  });

  it('refuses somebody else without the key', () => {
    expect(refuseDelete(message(), participant('active', 'nosy'), { mayModerate: false })).toBe('not_yours');
  });

  it('⚠ refuses a moderator who is not a participant — §12.42 has no delete-anywhere key', () => {
    expect(refuseDelete(message(), participant('left', 'mod'), { mayModerate: true })).toBe('not_a_participant');
    expect(refuseDelete(message(), undefined, { mayModerate: true })).toBe('not_a_participant');
  });

  it('refuses a second delete rather than overwriting who did the first', () => {
    expect(
      refuseDelete(message({ deletedAt: new Date() }), participant('active', 'author'), { mayModerate: true }),
    ).toBe('already_deleted');
  });
});

describe('countsAsUnread', () => {
  it('counts somebody else’s live message', () => {
    expect(countsAsUnread(message(), 'reader')).toBe(true);
  });

  it('never counts your own', () => {
    expect(countsAsUnread(message(), 'author')).toBe(false);
  });

  it('⚠ never counts a SYSTEM message — "X left" is not addressed to anybody', () => {
    expect(countsAsUnread(message({ kind: 'system', authorId: null }), 'reader')).toBe(false);
  });

  it('never counts a tombstone, which is a badge pointing at nothing to read', () => {
    expect(countsAsUnread(message({ deletedAt: new Date() }), 'reader')).toBe(false);
  });
});
