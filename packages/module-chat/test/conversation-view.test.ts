import type { ChatConversationView } from '../src/react/chat-client.js';
import {
  conversationTitle,
  countWaiting,
  otherParticipants,
  splitConversations,
} from '../src/react/view/conversation-view.js';

const conversation = (
  over: Partial<ChatConversationView> & Pick<ChatConversationView, 'id'>,
): ChatConversationView => ({
  title: null,
  icon: null,
  isDirect: false,
  createdById: 'ann',
  archived: false,
  lastMessageAt: null,
  myStatus: 'active',
  myUserId: 'ann',
  unread: 0,
  participants: [],
  ...over,
});

const person = (userId: string, displayName: string, status = 'active', role = 'member') => ({
  userId,
  displayName,
  status,
  role,
});

describe('conversationTitle', () => {
  it('⚠ names a direct chat by WHO IS IN IT, which is why title is nullable', () => {
    const direct = conversation({
      id: 'c1',
      isDirect: true,
      participants: [person('ann', 'Ann'), person('bob', 'Bob')],
    });

    expect(conversationTitle(direct)).toBe('Bob');
  });

  it('falls back rather than rendering an unclickable empty row', () => {
    // A deleted account, or a directory that could not answer. "Someone" is a
    // worse name than a real one and a better one than nothing.
    const direct = conversation({ id: 'c1', isDirect: true, participants: [person('ann', 'Ann')] });

    expect(conversationTitle(direct)).toBe('Someone');
  });

  it('uses a group’s own title, and names an untitled one', () => {
    expect(conversationTitle(conversation({ id: 'c1', title: 'Standup' }))).toBe('Standup');
    expect(conversationTitle(conversation({ id: 'c2', title: '   ' }))).toBe('Untitled group');
  });
});

describe('otherParticipants', () => {
  it('leaves you out — you are not news in your own conversation', () => {
    const group = conversation({
      id: 'c1',
      participants: [person('ann', 'Ann'), person('bob', 'Bob'), person('cat', 'Cat')],
    });

    expect(otherParticipants(group)).toEqual(['Bob', 'Cat']);
  });
});

describe('splitConversations', () => {
  const older = conversation({ id: 'older', lastMessageAt: '2026-09-11T10:00:00.000Z' });
  const newer = conversation({ id: 'newer', lastMessageAt: '2026-09-11T11:00:00.000Z' });
  const silent = conversation({ id: 'silent' });
  const invitedEarly = conversation({
    id: 'invited-1',
    myStatus: 'invited',
    lastMessageAt: '2026-09-11T09:00:00.000Z',
  });
  const invitedLate = conversation({ id: 'invited-2', myStatus: 'invited', lastMessageAt: '2026-09-11T12:00:00.000Z' });

  it('⚠ keeps invitations OUT of the list you can open', () => {
    // An invitation is a question addressed to you, not a quieter conversation:
    // you cannot read a word of it until you answer. Sorted in among threads it
    // would be a row that behaves differently from every row around it.
    const { active, requests } = splitConversations([newer, invitedLate]);

    expect(active.map((one) => one.id)).toEqual(['newer']);
    expect(requests.map((one) => one.id)).toEqual(['invited-2']);
  });

  it('orders open conversations by newest activity', () => {
    expect(splitConversations([older, newer]).active.map((one) => one.id)).toEqual(['newer', 'older']);
  });

  it('⚠ puts a conversation nobody has spoken in LAST, not first', () => {
    // A brand-new empty group is less interesting than one with a message in it
    // from last week — and whoever just created it is already looking at it.
    expect(splitConversations([silent, older]).active.map((one) => one.id)).toEqual(['older', 'silent']);
  });

  it('⚠ queues requests OLDEST first, the opposite of the list beside it', () => {
    // A queue is worked through from the top. Newest-first sinks the invitation
    // somebody has been ignoring longest out of sight.
    expect(splitConversations([invitedLate, invitedEarly]).requests.map((one) => one.id)).toEqual([
      'invited-1',
      'invited-2',
    ]);
  });

  it('drops archived conversations from both halves without deleting anything', () => {
    const archived = conversation({ id: 'archived', archived: true });
    const archivedInvite = conversation({ id: 'archived-invite', archived: true, myStatus: 'invited' });

    const { active, requests } = splitConversations([archived, archivedInvite, newer]);

    expect(active.map((one) => one.id)).toEqual(['newer']);
    expect(requests).toEqual([]);
  });
});

describe('countWaiting', () => {
  it('counts unread in open conversations and invitations as their own number', () => {
    const waiting = countWaiting([
      conversation({ id: 'a', unread: 2 }),
      conversation({ id: 'b', unread: 3 }),
      conversation({ id: 'c', myStatus: 'invited' }),
    ]);

    expect(waiting).toEqual({ unread: 5, requests: 1 });
  });

  it('⚠ ignores an archived conversation’s unread count', () => {
    // It is not in the list, so a badge counting it would point at a row
    // nobody can see.
    expect(countWaiting([conversation({ id: 'a', unread: 4, archived: true })])).toEqual({ unread: 0, requests: 0 });
  });
});
