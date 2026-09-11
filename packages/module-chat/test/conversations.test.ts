import { countsTowardCap, directKeyFor, groupCapAllows, isDirect } from '../src/domain/conversations.js';
import type { ConversationView, ParticipantStatus, ParticipantView } from '../src/types.js';

const conversation = (over: Partial<ConversationView> = {}): ConversationView => ({
  id: 'c1',
  directKey: null,
  createdById: 'me',
  archivedAt: null,
  ...over,
});

const participant = (status: ParticipantStatus, userId = 'me'): ParticipantView => ({
  conversationId: 'c1',
  userId,
  status,
});

describe('directKeyFor', () => {
  it('is the same string whichever way round it is asked', () => {
    // The unique constraint depends on this: without it, two simultaneous
    // "message Bob" clicks produce two threads.
    expect(directKeyFor('bob', 'alice')).toBe(directKeyFor('alice', 'bob'));
  });

  it('sorts, so the key is derivable rather than remembered', () => {
    expect(directKeyFor('bob', 'alice')).toBe('alice:bob');
  });

  it('⚠ allows a self-DM deliberately, rather than producing one by accident', () => {
    expect(directKeyFor('me', 'me')).toBe('me:me');
  });
});

describe('isDirect', () => {
  it('reads the key rather than counting participants', () => {
    expect(isDirect(conversation({ directKey: 'a:b' }))).toBe(true);
    expect(isDirect(conversation({ directKey: null }))).toBe(false);
  });
});

describe('countsTowardCap', () => {
  it('counts a live conversation I created and am still in', () => {
    expect(countsTowardCap(conversation(), participant('active'), 'me')).toBe(true);
  });

  it('does not count one somebody else created — a cap others can spend is a griefing tool', () => {
    expect(countsTowardCap(conversation({ createdById: 'them' }), participant('active'), 'me')).toBe(false);
  });

  it('stops counting once archived, which is what makes the cap clearable', () => {
    expect(countsTowardCap(conversation({ archivedAt: new Date() }), participant('active'), 'me')).toBe(false);
  });

  it('⚠ stops counting once I LEAVE — otherwise create-twenty-and-leave is unlimited', () => {
    expect(countsTowardCap(conversation(), participant('left'), 'me')).toBe(false);
    expect(countsTowardCap(conversation(), participant('removed'), 'me')).toBe(false);
    expect(countsTowardCap(conversation(), undefined, 'me')).toBe(false);
  });
});

describe('groupCapAllows', () => {
  it('passes the host checker’s decision through', () => {
    expect(groupCapAllows({ allowed: true })).toBe(true);
    expect(groupCapAllows({ allowed: false })).toBe(false);
  });
});
