import { ChatEventPublisher } from '../src/server/chat.events.js';
import {
  CHAT_EVENT,
  type ChatConversationEvent,
  type ChatMessageEvent,
  type ChatPubSub,
  deliverTo,
} from '../src/server/chat.pubsub.js';
import { ChatService } from '../src/server/chat.service.js';
import { ChatWriteService } from '../src/server/chat-write.service.js';
import { emptyState, fakeClient } from './fake-client.js';

/**
 * The realtime half: who an event reaches, and when it is announced.
 *
 * ⚠ The question every test here asks is the one a subscription cannot ask for
 * itself. A subscription is authorised ONCE, at subscribe, and then streams —
 * so "may this person still see this" has to be re-answered by the PUBLISH, and
 * these are the assertions that it is.
 */

function recorder(): ChatPubSub & { sent: { trigger: string; payload: unknown }[] } {
  const sent: { trigger: string; payload: unknown }[] = [];
  return {
    sent,
    async publish(trigger, payload) {
      sent.push({ trigger, payload });
    },
    async *asyncIterableIterator<T>(): AsyncIterableIterator<T> {
      // Nothing subscribes in these tests: the question is what was published.
    },
  };
}

function harness() {
  const { client, state } = fakeClient(emptyState());
  const pubsub = recorder();
  const events = new ChatEventPublisher(client, pubsub);
  return {
    state,
    pubsub,
    reads: new ChatService(client),
    writes: new ChatWriteService(client, undefined, events),
  };
}

const messages = (pubsub: ReturnType<typeof recorder>) =>
  pubsub.sent.filter((one) => one.trigger === CHAT_EVENT.message).map((one) => one.payload as ChatMessageEvent);

const conversations = (pubsub: ReturnType<typeof recorder>) =>
  pubsub.sent
    .filter((one) => one.trigger === CHAT_EVENT.conversation)
    .map((one) => one.payload as ChatConversationEvent);

describe('deliverTo — the per-publish filter', () => {
  it('delivers to somebody in the audience and to nobody else', () => {
    const event = { audience: ['ann', 'bob'] };

    expect(deliverTo(event, 'ann')).toBe(true);
    expect(deliverTo(event, 'cat')).toBe(false);
  });

  it('delivers nothing when the audience is empty', () => {
    expect(deliverTo({ audience: [] }, 'ann')).toBe(false);
  });
});

describe('who a message event reaches', () => {
  it('⚠ reaches ACTIVE participants only — an invited person never sees a body', async () => {
    // The same rule every read enforces, on the one path that pushes rather
    // than answers. Getting it wrong leaks a message to somebody who has not
    // accepted, which is the failure the module was written rules-first about.
    const { writes, pubsub } = harness();
    const group = await writes.startGroup('ann', { title: 'Standup', userIds: ['bob'] });

    await writes.send('ann', { conversationId: group.id, body: 'morning' });

    expect(messages(pubsub)).toHaveLength(1);
    expect(messages(pubsub)[0]?.audience).toEqual(['ann']);
  });

  it('reaches the person who accepted, from the next message on', async () => {
    const { writes, pubsub } = harness();
    const group = await writes.startGroup('ann', { title: 'Standup', userIds: ['bob'] });
    await writes.respondToInvitation('bob', group.id, true);

    await writes.send('ann', { conversationId: group.id, body: 'morning' });

    expect(messages(pubsub)[0]?.audience).toEqual(expect.arrayContaining(['ann', 'bob']));
  });

  it('⚠ stops reaching somebody the moment they are removed', async () => {
    // The property the whole audience design exists for: their socket is still
    // open and still authorised, and the next message is not theirs.
    const { writes, pubsub } = harness();
    const group = await writes.startGroup('ann', { title: 'Standup', userIds: ['bob'] });
    await writes.respondToInvitation('bob', group.id, true);
    await writes.removeParticipant('ann', group.id, 'bob');

    await writes.send('ann', { conversationId: group.id, body: 'after' });

    expect(messages(pubsub).at(-1)?.audience).toEqual(['ann']);
  });

  it('includes the author, because their other tabs are subscribers too', async () => {
    const { writes, pubsub } = harness();
    const direct = await writes.startDirect('ann', 'bob');

    await writes.send('ann', { conversationId: direct.id, body: 'hello' });

    expect(messages(pubsub)[0]?.audience).toContain('ann');
  });
});

describe('what is announced, and when', () => {
  it('announces a sent message once', async () => {
    const { writes, pubsub } = harness();
    const direct = await writes.startDirect('ann', 'bob');

    await writes.send('ann', { conversationId: direct.id, body: 'hello', clientMessageId: 'c1' });

    expect(messages(pubsub)).toHaveLength(1);
    expect(messages(pubsub)[0]?.change).toBe('sent');
  });

  it('⚠ announces NOTHING for a retry of the same clientMessageId', async () => {
    // The first send already published it. A second announcement would append
    // the message twice on every screen but the sender's.
    const { writes, pubsub } = harness();
    const direct = await writes.startDirect('ann', 'bob');

    await writes.send('ann', { conversationId: direct.id, body: 'hello', clientMessageId: 'c1' });
    await writes.send('ann', { conversationId: direct.id, body: 'hello', clientMessageId: 'c1' });

    expect(messages(pubsub)).toHaveLength(1);
  });

  it('announces an edit and a delete as `changed`, not as new messages', async () => {
    const { writes, pubsub } = harness();
    const direct = await writes.startDirect('ann', 'bob');
    const message = await writes.send('ann', { conversationId: direct.id, body: 'hello' });

    await writes.edit('ann', message.id, 'hello again');
    await writes.delete('ann', message.id, { mayModerate: false });

    expect(messages(pubsub).map((event) => event.change)).toEqual(['sent', 'changed', 'changed']);
  });

  it('⚠ announces nothing at all when the write is refused', async () => {
    // The publish is after the commit, so a refusal has nothing to announce —
    // and a client that was told about a message nobody stored is worse than
    // one told nothing.
    const { writes, pubsub } = harness();
    const direct = await writes.startDirect('ann', 'bob');
    pubsub.sent.length = 0;

    await expect(writes.send('cat', { conversationId: direct.id, body: 'intruding' })).rejects.toBeDefined();

    expect(pubsub.sent).toHaveLength(0);
  });

  it('tells the removed person, who is no longer in the audience', async () => {
    const { writes, pubsub } = harness();
    const group = await writes.startGroup('ann', { title: 'Standup', userIds: ['bob'] });
    await writes.respondToInvitation('bob', group.id, true);

    await writes.removeParticipant('ann', group.id, 'bob');

    const removal = conversations(pubsub).at(-1);
    expect(removal?.change).toBe('removed');
    // Their client is the one holding a conversation it may no longer read.
    expect(removal?.audience).toContain('bob');
  });

  it('tells the person who declined, so their other tabs drop the invitation', async () => {
    const { writes, pubsub } = harness();
    const group = await writes.startGroup('ann', { title: 'Standup', userIds: ['bob'] });

    await writes.respondToInvitation('bob', group.id, false);

    const declined = conversations(pubsub).at(-1);
    expect(declined?.change).toBe('declined');
    expect(declined?.audience).toContain('bob');
  });

  it('announces a conversation event to INVITED people as well — the requests inbox is live', async () => {
    const { writes, pubsub } = harness();
    const group = await writes.startGroup('ann', { title: 'Standup', userIds: ['bob'] });

    expect(conversations(pubsub).at(-1)?.audience).toEqual(expect.arrayContaining(['ann', 'bob']));
    expect(group.title).toBe('Standup');
  });

  it('⚠ says nothing when the read mark moves', async () => {
    // Nobody else's view changes, and the viewer's own tabs are stale for a
    // moment rather than wrong. Listed as a decision, not an omission.
    const { writes, pubsub } = harness();
    const direct = await writes.startDirect('ann', 'bob');
    const message = await writes.send('ann', { conversationId: direct.id, body: 'hello' });
    pubsub.sent.length = 0;

    await writes.markRead('ann', direct.id, message.id);

    expect(pubsub.sent).toHaveLength(0);
  });
});

describe('a publish that fails', () => {
  it('⚠ does not fail the write', async () => {
    // The message is saved. Turning a delivered message into a 500 would make
    // the client retry something that already happened.
    const { client, state } = fakeClient(emptyState());
    const broken: ChatPubSub = {
      async publish() {
        throw new Error('the engine is down');
      },
      async *asyncIterableIterator<T>(): AsyncIterableIterator<T> {},
    };
    const writes = new ChatWriteService(client, undefined, new ChatEventPublisher(client, broken));

    const direct = await writes.startDirect('ann', 'bob');
    const message = await writes.send('ann', { conversationId: direct.id, body: 'hello' });

    expect(message.body).toBe('hello');
    expect(state.messages).toHaveLength(1);
  });
});

describe('missedSince — what a reconnecting socket is owed', () => {
  it('returns everything after the cursor, oldest first, across every conversation', async () => {
    const { writes, reads } = harness();
    const one = await writes.startDirect('ann', 'bob');
    const two = await writes.startGroup('ann', { title: 'Standup', userIds: [] });

    const mark = await writes.send('ann', { conversationId: one.id, body: 'first' });
    const second = await writes.send('ann', { conversationId: two.id, body: 'second' });
    const third = await writes.send('ann', { conversationId: one.id, body: 'third' });

    const missed = await reads.missedSince('ann', mark);

    // ⚠ ASCENDING, the opposite of a thread page: a gap is filled forwards from
    // where the client stopped, or it arrives out of order.
    expect(missed.messages.map((row) => row.id)).toEqual([second.id, third.id]);
    expect(missed.truncated).toBe(false);
  });

  it('⚠ never returns a message from a conversation the viewer is only INVITED to', async () => {
    const { writes, reads } = harness();
    const group = await writes.startGroup('ann', { title: 'Standup', userIds: ['bob'] });
    const first = await writes.send('ann', { conversationId: group.id, body: 'first' });
    await writes.send('ann', { conversationId: group.id, body: 'second' });

    // Bob has not accepted. The replay is a push, so it has to re-ask the same
    // question `listMessages` does.
    expect((await reads.missedSince('bob', first)).messages).toEqual([]);
  });

  it('returns nothing for somebody in no conversations at all', async () => {
    const { reads } = harness();

    expect(await reads.missedSince('nobody', { createdAt: new Date(0), id: '' })).toEqual({
      messages: [],
      truncated: false,
    });
  });

  it('⚠ ABANDONS the replay rather than truncating it when too much was missed', async () => {
    const { writes, reads } = harness();
    const direct = await writes.startDirect('ann', 'bob');
    const mark = await writes.send('ann', { conversationId: direct.id, body: 'mark' });
    for (let index = 0; index < 201; index += 1) {
      await writes.send('ann', { conversationId: direct.id, body: `message ${index}` });
    }

    const missed = await reads.missedSince('ann', mark);

    // Replaying the newest 200 of 201 would leave a hole in the thread that
    // nothing ever fills. `sync` already told the client to re-read.
    expect(missed).toEqual({ messages: [], truncated: true });
  });
});
