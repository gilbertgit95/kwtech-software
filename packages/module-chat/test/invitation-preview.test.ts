import { ChatService } from '../src/server/chat.service.js';
import { ChatWriteService } from '../src/server/chat-write.service.js';
import { emptyState, fakeClient } from './fake-client.js';

/**
 * ── WHAT AN INVITED PERSON SEES BEFORE THEY ACCEPT ─────────────────────────
 *
 * §12.51, decided 2026-09-13: the FIRST `kind: user` message, never the thread.
 *
 * ⚠ This is the only place in the product where message content reaches a
 * NON-PARTICIPANT, which is the class of thing C1 was. So it gets the tests
 * that prove the boundary rather than the ones that prove the feature:
 * `canAccessConversation` is NOT widened, the preview is one message, and it
 * does not leak differently for a blocked sender than an unknown one.
 */

const harness = () => {
  const { client, state } = fakeClient(emptyState());
  return { reads: new ChatService(client), writes: new ChatWriteService(client), state };
};

const invite = async (writes: ChatWriteService) => {
  const conversation = await writes.startGroup('ann', { title: 'Team', userIds: ['bob'] });
  return conversation;
};

const invitationOf = async (reads: ChatService, userId: string, conversationId: string) =>
  (await reads.listConversations(userId)).find((one) => one.conversation.id === conversationId);

describe('the invitation preview', () => {
  it('shows the first message to somebody who has not accepted yet', async () => {
    const { reads, writes } = harness();
    const conversation = await invite(writes);
    await writes.send('ann', { conversationId: conversation.id, body: 'can you join this?' });

    const row = await invitationOf(reads, 'bob', conversation.id);
    expect(row?.preview?.body).toBe('can you join this?');
  });

  /**
   * ⚠ THE OLDEST, NOT THE LATEST. The latest would turn an unanswered
   * invitation into a live feed of a conversation the viewer never joined.
   */
  it('⚠ shows the FIRST message, not the most recent', async () => {
    const { reads, writes } = harness();
    const conversation = await invite(writes);
    await writes.send('ann', { conversationId: conversation.id, body: 'first' });
    await writes.send('ann', { conversationId: conversation.id, body: 'second' });
    await writes.send('ann', { conversationId: conversation.id, body: 'third' });

    const row = await invitationOf(reads, 'bob', conversation.id);
    expect(row?.preview?.body).toBe('first');
  });

  /** A system message is from nobody, and tells an invitee nothing. */
  it('skips a system message to find the first thing a person said', async () => {
    const { reads, writes, state } = harness();
    const conversation = await invite(writes);
    state.messages.push({
      id: 'sys-1',
      conversationId: conversation.id,
      kind: 'system',
      authorId: null,
      body: 'Ann created the group',
      clientMessageId: null,
      replyToMessageId: null,
      createdAt: new Date('2020-01-01T00:00:00Z'),
      editedAt: null,
      deletedAt: null,
      deletedById: null,
    });
    await writes.send('ann', { conversationId: conversation.id, body: 'a real message' });

    const row = await invitationOf(reads, 'bob', conversation.id);
    expect(row?.preview?.body).toBe('a real message');
  });

  /**
   * ⚠ THE BOUNDARY. An ACCEPTED participant reads the thread; a second copy of
   * one message travelling beside it is a second thing to keep in step, and
   * `canAccessConversation` was not widened to produce it.
   */
  it('⚠ carries NO preview once the person has accepted', async () => {
    const { reads, writes } = harness();
    const conversation = await invite(writes);
    await writes.send('ann', { conversationId: conversation.id, body: 'hello' });

    expect((await invitationOf(reads, 'bob', conversation.id))?.preview).not.toBeNull();
    await writes.respondToInvitation('bob', conversation.id, true);
    expect((await invitationOf(reads, 'bob', conversation.id))?.preview).toBeNull();
  });

  /** The sender is a participant, so their own row never carries one either. */
  it('carries no preview for the person who sent the invitation', async () => {
    const { reads, writes } = harness();
    const conversation = await invite(writes);
    await writes.send('ann', { conversationId: conversation.id, body: 'hello' });

    expect((await invitationOf(reads, 'ann', conversation.id))?.preview).toBeNull();
  });

  it('is null for an invitation nobody has written in yet', async () => {
    const { reads, writes } = harness();
    const conversation = await invite(writes);

    expect((await invitationOf(reads, 'bob', conversation.id))?.preview).toBeNull();
  });

  /**
   * ⚠ §12.51 STATES THIS REQUIREMENT EXPLICITLY: whatever is chosen, it must
   * not leak differently for a blocked sender than an unknown one. A preview
   * that was absent for a blocked inviter and present otherwise would answer
   * "has this person blocked you" to anybody who could get themselves invited —
   * the exact oracle the blocking design refuses everywhere else.
   *
   * It is met by the preview containing no block check at all, and this is what
   * would fail if somebody added one.
   */
  it('⚠ looks identical whether or not a block exists between the two people', async () => {
    const { reads, writes, state } = harness();
    const conversation = await invite(writes);
    await writes.send('ann', { conversationId: conversation.id, body: 'identical either way' });

    const before = await invitationOf(reads, 'bob', conversation.id);

    // A block created AFTER the invitation — the only way to reach this state,
    // since `startGroup` skips blocked invitees outright.
    state.blocks.push({ blockerId: 'bob', blockedId: 'ann', createdAt: new Date() });
    const after = await invitationOf(reads, 'bob', conversation.id);

    expect(after?.preview?.body).toBe(before?.preview?.body);
    expect(after?.preview?.body).toBe('identical either way');
  });

  /**
   * A DELETED first message still resolves, and the UI drops it — the tombstone
   * holds its place in the ordering, so skipping it here would show the SECOND
   * message to somebody whose invitation is about the first.
   */
  it('resolves a deleted first message rather than falling through to the next', async () => {
    const { reads, writes } = harness();
    const conversation = await invite(writes);
    const first = await writes.send('ann', { conversationId: conversation.id, body: 'gone' });
    await writes.send('ann', { conversationId: conversation.id, body: 'still here' });
    await writes.delete('ann', first.id, { mayModerate: false });

    const row = await invitationOf(reads, 'bob', conversation.id);
    expect(row?.preview?.id).toBe(first.id);
    expect(row?.preview?.deletedAt).not.toBeNull();
  });
});
