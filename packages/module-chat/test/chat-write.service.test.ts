import type { LimitChecker } from '@kwtech/module-kit';
import { CHAT_DEFAULT, type ChatDefaultReader } from '../src/defaults.js';
import type { ChatWriteError } from '../src/server/chat.errors.js';
import { ChatWriteService } from '../src/server/chat-write.service.js';
import { emptyState, type FakeState, fakeClient } from './fake-client.js';

/**
 * The write path, against a literal rather than a database.
 *
 * ⚠ Every test here is about the SECOND half of an authorisation. The guard has
 * already said the caller may use chat; these assert that the conversation is
 * somewhere they may be — which is the half C1 was missing.
 */

const capOf = (limit: number | null): LimitChecker => ({
  async check({ current }) {
    return {
      allowed: limit === null || current < limit,
      limit,
      current,
      remaining: limit === null ? null : Math.max(0, limit - current),
    };
  },
});

function harness(limit: number | null = null) {
  const { client, state } = fakeClient(emptyState());
  return { svc: new ChatWriteService(client, capOf(limit)), state };
}

const reason = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    throw new Error('expected a refusal');
  } catch (error) {
    return (error as ChatWriteError).reason;
  }
};

const statusOf = (state: FakeState, conversationId: string, userId: string) =>
  state.participants.find((row) => row.conversationId === conversationId && row.userId === userId)?.status;

describe('startDirect', () => {
  it('creates one conversation with the creator active and the other invited', async () => {
    const { svc, state } = harness();
    const conversation = await svc.startDirect('ann', 'bob');

    expect(conversation.directKey).toBe('ann:bob');
    expect(statusOf(state, conversation.id, 'ann')).toBe('active');
    expect(statusOf(state, conversation.id, 'bob')).toBe('invited');
  });

  it('⚠ returns the SAME conversation whichever way round it is opened', async () => {
    // Two simultaneous "message Bob" clicks must not produce two threads.
    const { svc, state } = harness();
    const first = await svc.startDirect('ann', 'bob');
    const second = await svc.startDirect('bob', 'ann');

    expect(second.id).toBe(first.id);
    expect(state.conversations).toHaveLength(1);
  });

  it('⚠ refuses when either side has blocked the other', async () => {
    const { svc, state } = harness();
    state.blocks.push({ blockerId: 'bob', blockedId: 'ann', createdAt: new Date() });

    // The caller turns this into the same sentence an unknown address gets.
    expect(await reason(svc.startDirect('ann', 'bob'))).toBe('blocked');
  });

  it('re-invites into an existing thread rather than inserting a second row', async () => {
    const { svc, state } = harness();
    const conversation = await svc.startDirect('ann', 'bob');
    await svc.respondToInvitation('bob', conversation.id, false);
    await svc.startDirect('ann', 'bob');

    expect(statusOf(state, conversation.id, 'bob')).toBe('invited');
    expect(state.participants.filter((row) => row.userId === 'bob')).toHaveLength(1);
  });
});

describe('startGroup and the cap', () => {
  it('counts only live groups the actor created and is still in', async () => {
    const { svc, state } = harness(2);
    await svc.startGroup('ann', { title: 'One', userIds: ['bob'] });
    const second = await svc.startGroup('ann', { title: 'Two', userIds: [] });

    expect(await reason(svc.startGroup('ann', { title: 'Three', userIds: [] }))).toBe('cap_reached');

    // ⚠ Archiving FREES a slot, which is what makes the cap clearable.
    await svc.setArchived('ann', second.id, true);
    await expect(svc.startGroup('ann', { title: 'Three', userIds: [] })).resolves.toBeDefined();
    expect(state.conversations).toHaveLength(3);
  });

  it('⚠ LEAVING frees a slot too — otherwise create-twenty-and-leave is unlimited', async () => {
    const { svc } = harness(1);
    const first = await svc.startGroup('ann', { title: 'One', userIds: [] });
    await svc.leave('ann', first.id);

    await expect(svc.startGroup('ann', { title: 'Two', userIds: [] })).resolves.toBeDefined();
  });

  it('does not count DIRECT chats — the cap bounds rooms, not who you may talk to', async () => {
    const { svc } = harness(1);
    await svc.startDirect('ann', 'bob');
    await svc.startDirect('ann', 'cara');

    await expect(svc.startGroup('ann', { title: 'One', userIds: [] })).resolves.toBeDefined();
  });

  it('skips blocked invitees silently rather than naming them', async () => {
    const { svc, state } = harness();
    state.blocks.push({ blockerId: 'bob', blockedId: 'ann', createdAt: new Date() });
    const group = await svc.startGroup('ann', { title: 'Team', userIds: ['bob', 'cara'] });

    expect(statusOf(state, group.id, 'bob')).toBeUndefined();
    expect(statusOf(state, group.id, 'cara')).toBe('invited');
  });

  it('is unlimited when the host binds no checker at all', async () => {
    // The null object: chat runs in an app with no permission model.
    const { client } = fakeClient(emptyState());
    const svc = new ChatWriteService(client);
    for (let i = 0; i < 25; i += 1) await svc.startGroup('ann', { title: `G${i}`, userIds: [] });

    await expect(svc.startGroup('ann', { title: 'more', userIds: [] })).resolves.toBeDefined();
  });
});

describe('send', () => {
  const opened = async () => {
    const h = harness();
    const conversation = await h.svc.startDirect('ann', 'bob');
    await h.svc.respondToInvitation('bob', conversation.id, true);
    return { ...h, conversationId: conversation.id };
  };

  it('⚠ refuses somebody who is not in the conversation', async () => {
    const { svc, conversationId } = await opened();
    expect(await reason(svc.send('mallory', { conversationId, body: 'hello' }))).toBe('not_a_participant');
  });

  it('⚠ refuses somebody who LEFT, which is how history keeps being written', async () => {
    const { svc, conversationId } = await opened();
    await svc.leave('bob', conversationId);

    expect(await reason(svc.send('bob', { conversationId, body: 'still here' }))).toBe('not_a_participant');
  });

  it('refuses an invited person who has not accepted', async () => {
    const h = harness();
    const conversation = await h.svc.startDirect('ann', 'bob');
    expect(await reason(h.svc.send('bob', { conversationId: conversation.id, body: 'hi' }))).toBe('not_a_participant');
  });

  it('⚠ is IDEMPOTENT on clientMessageId — a retry must not double-post', async () => {
    const { svc, state, conversationId } = await opened();
    const first = await svc.send('ann', { conversationId, body: 'hello', clientMessageId: 'c1' });
    const retry = await svc.send('ann', { conversationId, body: 'hello', clientMessageId: 'c1' });

    expect(retry.id).toBe(first.id);
    expect(state.messages).toHaveLength(1);
  });

  it('moves lastMessageAt from the MESSAGE’s own createdAt, not a second clock', async () => {
    const { svc, state, conversationId } = await opened();
    const message = await svc.send('ann', { conversationId, body: 'hello' });

    expect(state.conversations[0]?.lastMessageAt).toEqual(message.createdAt);
  });

  it('refuses an empty body and one past the cap', async () => {
    const { svc, conversationId } = await opened();
    expect(await reason(svc.send('ann', { conversationId, body: '   ' }))).toBe('invalid');
    expect(await reason(svc.send('ann', { conversationId, body: 'x'.repeat(4001) }))).toBe('invalid');
  });
});

describe('delete and moderate', () => {
  const withMessage = async () => {
    const h = harness();
    const conversation = await h.svc.startGroup('ann', { title: 'Team', userIds: ['bob'] });
    await h.svc.respondToInvitation('bob', conversation.id, true);
    const message = await h.svc.send('bob', { conversationId: conversation.id, body: 'hello' });
    return { ...h, conversationId: conversation.id, messageId: message.id };
  };

  it('records WHO deleted it, which is not the author', async () => {
    const { svc, messageId } = await withMessage();
    const deleted = await svc.delete('ann', messageId, { mayModerate: true });

    expect(deleted.deletedById).toBe('ann');
    expect(deleted.authorId).toBe('bob');
  });

  it('refuses somebody else’s message without the moderation key', async () => {
    const { svc, messageId } = await withMessage();
    expect(await reason(svc.delete('ann', messageId, { mayModerate: false }))).toBe('not_permitted');
  });

  it('⚠ refuses a moderator who is not IN the conversation', async () => {
    const { svc, messageId } = await withMessage();
    expect(await reason(svc.delete('mallory', messageId, { mayModerate: true }))).toBe('not_a_participant');
  });

  it('refuses a second delete rather than overwriting who did the first', async () => {
    const { svc, messageId } = await withMessage();
    await svc.delete('bob', messageId, { mayModerate: false });
    expect(await reason(svc.delete('ann', messageId, { mayModerate: true }))).toBe('already_deleted');
  });
});

describe('markRead', () => {
  it('⚠ only ever moves FORWARD', async () => {
    const h = harness();
    const conversation = await h.svc.startGroup('ann', { title: 'Team', userIds: ['bob'] });
    await h.svc.respondToInvitation('bob', conversation.id, true);
    const first = await h.svc.send('ann', { conversationId: conversation.id, body: 'one' });
    const second = await h.svc.send('ann', { conversationId: conversation.id, body: 'two' });

    await h.svc.markRead('bob', conversation.id, second.id);
    // A background tab catching up, or a reordered response. Accepting it would
    // resurrect messages as unread and the badge would flicker unreproducibly.
    await h.svc.markRead('bob', conversation.id, first.id);

    const bob = h.state.participants.find((row) => row.userId === 'bob');
    expect(bob?.lastReadMessageId).toBe(second.id);
  });
});

describe('removeParticipant', () => {
  it('⚠ refuses to remove the creator, whoever asks', async () => {
    const h = harness();
    const conversation = await h.svc.startGroup('ann', { title: 'Team', userIds: ['bob'] });
    await h.svc.respondToInvitation('bob', conversation.id, true);

    expect(await reason(h.svc.removeParticipant('bob', conversation.id, 'ann'))).toBe('not_permitted');
  });

  it('refuses a remover who is not in the conversation', async () => {
    const h = harness();
    const conversation = await h.svc.startGroup('ann', { title: 'Team', userIds: ['bob'] });

    expect(await reason(h.svc.removeParticipant('mallory', conversation.id, 'bob'))).toBe('not_a_participant');
  });
});

/**
 * ── WHAT THE OPERATOR CHOSE ────────────────────────────────────────────────
 *
 * Chat DECLARES its two defaults and cannot read them: the value lives in
 * `perm_default`, a table `module-permissions` owns, so it arrives through a
 * port. These assert the three things that can happen to a value coming out of
 * somebody else's table — it is a role chat knows, it is not, or the read
 * fails — and that the group is created in all three.
 */
describe("startGroup and the operator's defaults", () => {
  const reader = (values: Record<string, string | null>): ChatDefaultReader => ({
    async read(key) {
      return values[key] ?? null;
    },
  });

  const withDefaults = (defaults: ChatDefaultReader) => {
    const { client, state } = fakeClient(emptyState());
    return { svc: new ChatWriteService(client, undefined, undefined, undefined, defaults), state };
  };

  const roleOf = (state: FakeState, conversationId: string, userId: string) =>
    state.participants.find((row) => row.conversationId === conversationId && row.userId === userId)?.role;

  it('unbound: the creator owns the group and everybody else joins as a member', async () => {
    // The documented fallback, and a working product — the behaviour that
    // existed before the settings did.
    const { svc, state } = harness();
    const group = await svc.startGroup('ann', { title: 'Team', userIds: ['bob'] });

    expect(roleOf(state, group.id, 'ann')).toBe('owner');
    expect(roleOf(state, group.id, 'bob')).toBe('member');
  });

  it('applies both settings when the operator has chosen them', async () => {
    const { svc, state } = withDefaults(
      reader({ [CHAT_DEFAULT.creatorRole]: 'admin', [CHAT_DEFAULT.memberRole]: 'admin' }),
    );
    const group = await svc.startGroup('ann', { title: 'Team', userIds: ['bob'] });

    /*
     * ⚠ A GROUP WITH NO OWNER, which is the operator's decision to make and
     * the setting's description says so in capitals: nothing else mints one.
     * The write path does not second-guess it — refusing here would make a
     * configured platform unable to create a group at all.
     */
    expect(roleOf(state, group.id, 'ann')).toBe('admin');
    expect(roleOf(state, group.id, 'bob')).toBe('admin');
  });

  /**
   * ⚠ VALIDATED, NOT TRUSTED. The value is a string in another module's table:
   * a role renamed out of existence, a typo, a key set before this module
   * declared its choices. It falls back rather than being written, because a
   * participant row carrying a role the enum does not have reads as `member`
   * to every rule anyway, with no error to explain why.
   */
  it('⚠ falls back when the stored value is not a role chat has', async () => {
    const { svc, state } = withDefaults(reader({ [CHAT_DEFAULT.creatorRole]: 'superuser' }));
    const group = await svc.startGroup('ann', { title: 'Team', userIds: ['bob'] });

    expect(roleOf(state, group.id, 'ann')).toBe('owner');
  });

  /**
   * ⚠ A READ THAT THROWS MUST NOT FAIL THE WRITE. The port reaches into
   * another module's service; a default is a convenience and must never become
   * a gate, which is the same reading every default gets on the resolving side.
   */
  it('⚠ creates the group anyway when the port throws', async () => {
    const angry: ChatDefaultReader = {
      async read() {
        throw new Error('permissions is down');
      },
    };
    const { svc, state } = withDefaults(angry);
    const group = await svc.startGroup('ann', { title: 'Team', userIds: ['bob'] });

    expect(roleOf(state, group.id, 'ann')).toBe('owner');
    expect(roleOf(state, group.id, 'bob')).toBe('member');
  });

  it('applies the member default to somebody INVITED later, not just at creation', async () => {
    const { svc, state } = withDefaults(reader({ [CHAT_DEFAULT.memberRole]: 'admin' }));
    const group = await svc.startGroup('ann', { title: 'Team', userIds: [] });
    await svc.invite('ann', group.id, 'bob');

    expect(roleOf(state, group.id, 'bob')).toBe('admin');
  });

  /**
   * ⚠ SOMEBODY COMING BACK KEEPS THE ROLE THEY HAD. A re-invitation is not a
   * demotion: an admin removed by mistake and added again must not quietly
   * return as whatever the default says today.
   */
  it('⚠ does not re-role somebody who was already in the group', async () => {
    const { svc, state } = withDefaults(reader({ [CHAT_DEFAULT.memberRole]: 'member' }));
    const group = await svc.startGroup('ann', { title: 'Team', userIds: ['bob'] });
    await svc.respondToInvitation('bob', group.id, true);
    await svc.setParticipantRole('ann', group.id, 'bob', 'admin');
    await svc.removeParticipant('ann', group.id, 'bob');
    await svc.invite('ann', group.id, 'bob');

    expect(roleOf(state, group.id, 'bob')).toBe('admin');
  });
});

describe('invite', () => {
  it('⚠ refuses to grow a DIRECT chat, whose key names exactly two people', async () => {
    const h = harness();
    const conversation = await h.svc.startDirect('ann', 'bob');

    expect(await reason(h.svc.invite('ann', conversation.id, 'cara'))).toBe('not_permitted');
  });
});
