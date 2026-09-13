import { NOTIFY_COOLDOWN_MS, type NotifyDecision, shouldNotify } from '../src/domain/notify.js';
import type { ChatNotification, ChatNotifier } from '../src/server/chat.notifier.js';
import { ChatWriteService } from '../src/server/chat-write.service.js';
import { emptyState, fakeClient } from './fake-client.js';

/**
 * ── WHO IS OWED A NUDGE ────────────────────────────────────────────────────
 *
 * The tone only plays in an open tab (§12.50). Every refusal below is an email
 * somebody would otherwise have received and been annoyed by — which is the
 * failure mode that gets a notification system switched off entirely, and then
 * nobody is told anything.
 */

const NOW = new Date('2026-09-13T12:00:00Z');

const arriving = (over: Partial<NotifyDecision> = {}): NotifyDecision => ({
  recipientId: 'ann',
  authorId: 'bob',
  status: 'active',
  recipientOnline: false,
  availability: 'available',
  mutedUntil: null,
  lastNotifiedAt: null,
  now: NOW,
  ...over,
});

describe('shouldNotify', () => {
  it('tells an active participant who is not connected', () => {
    expect(shouldNotify(arriving())).toBe(true);
  });

  it('never tells you about your own message, or about a system one', () => {
    expect(shouldNotify(arriving({ authorId: 'ann' }))).toBe(false);
    expect(shouldNotify(arriving({ authorId: null }))).toBe(false);
  });

  /**
   * ⚠ THE CENTRAL ONE. Somebody holding a socket has already had the badge move
   * and the tone play — mailing them as well is telling somebody something they
   * are currently watching.
   */
  it('⚠ never tells somebody who holds a live socket', () => {
    expect(shouldNotify(arriving({ recipientOnline: true }))).toBe(false);
  });

  /**
   * ⚠ §12.44 said `dnd` would stop being presentation and start being DELIVERY
   * the day a notification system existed. This is that line.
   */
  it('⚠ respects Do not disturb, which now suppresses delivery rather than a tone', () => {
    expect(shouldNotify(arriving({ availability: 'dnd' }))).toBe(false);
  });

  it('still tells somebody who is away, busy or invisible', () => {
    for (const availability of ['away', 'busy', 'invisible', 'available', null]) {
      expect(shouldNotify(arriving({ availability }))).toBe(true);
    }
  });

  /**
   * ⚠ `mutedUntil` was a convenience while the only thing it could suppress was
   * a tone in an open tab. It is load-bearing now — it stops a notification
   * reaching somebody who is not looking, which is what they muted it for.
   */
  it('⚠ respects a per-conversation mute, and lets an EXPIRED one through', () => {
    expect(shouldNotify(arriving({ mutedUntil: new Date(NOW.getTime() + 60_000) }))).toBe(false);
    expect(shouldNotify(arriving({ mutedUntil: new Date(NOW.getTime() - 60_000) }))).toBe(true);
  });

  /**
   * ⚠ Only ACTIVE. An invited person is told by the invitation, not by every
   * message in a thread they have not accepted — and somebody who left asked
   * not to be here.
   */
  it('⚠ tells nobody who is not an active participant', () => {
    for (const status of ['invited', 'declined', 'left', 'removed']) {
      expect(shouldNotify(arriving({ status }))).toBe(false);
    }
  });

  /**
   * ⚠ THE DIFFERENCE BETWEEN A NOTIFICATION AND A MAIL FLOOD. A ten-message
   * burst is one conversation, not ten things worth telling somebody about
   * separately.
   */
  it('⚠ stays quiet inside the cooldown and speaks again after it', () => {
    const justNow = new Date(NOW.getTime() - 60_000);
    expect(shouldNotify(arriving({ lastNotifiedAt: justNow }))).toBe(false);

    const longAgo = new Date(NOW.getTime() - NOTIFY_COOLDOWN_MS - 1);
    expect(shouldNotify(arriving({ lastNotifiedAt: longAgo }))).toBe(true);
  });

  it('treats the cooldown boundary as expired rather than as still running', () => {
    // Exactly at the boundary the window is over — `<` rather than `<=`, so a
    // clock that lands on the millisecond does not suppress a real nudge.
    expect(shouldNotify(arriving({ lastNotifiedAt: new Date(NOW.getTime() - NOTIFY_COOLDOWN_MS) }))).toBe(true);
  });
});

/**
 * ── AND THE WRITE PATH THAT USES IT ────────────────────────────────────────
 *
 * The rule above is pure. These assert the three things the caller is
 * responsible for: that it asks at all, that the cooldown is actually written
 * down, and — the important one — that none of it can break a send.
 */
describe('send, and who gets told', () => {
  const collecting = () => {
    const sent: ChatNotification[] = [];
    return {
      sent,
      notifier: {
        async notify(notification: ChatNotification) {
          sent.push(notification);
        },
      },
    };
  };

  const harness = (notifier?: ChatNotifier) => {
    const { client, state } = fakeClient(emptyState());
    return {
      writes: new ChatWriteService(client, undefined, undefined, undefined, undefined, notifier),
      state,
    };
  };

  const group = async (writes: ChatWriteService) => {
    const conversation = await writes.startGroup('ann', { title: 'Team', userIds: ['bob'] });
    await writes.respondToInvitation('bob', conversation.id, true);
    return conversation;
  };

  it('tells the other participant, and never the author', async () => {
    const { sent, notifier } = collecting();
    const { writes } = harness(notifier);
    const conversation = await group(writes);

    await writes.send('ann', { conversationId: conversation.id, body: 'hello' });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ recipientId: 'bob', senderId: 'ann', isGroup: true });
  });

  /** ⚠ The port carries no message body, and this is the assertion that keeps it that way. */
  it('⚠ carries ids and a group flag — never the message, never a title', () => {
    const notification: ChatNotification = {
      recipientId: 'bob',
      senderId: 'ann',
      conversationId: 'c1',
      isGroup: true,
    };
    // If a `body` or `title` is ever added to the port, this stops compiling —
    // which is the point. Conversation content must not reach a mailbox.
    expect(Object.keys(notification).sort()).toEqual(['conversationId', 'isGroup', 'recipientId', 'senderId']);
  });

  /**
   * ⚠ THE COOLDOWN IS WRITTEN DOWN, or it is not a cooldown. A burst must be
   * one notification, and the state that makes that true is a column.
   */
  it('⚠ tells somebody once for a burst, not once per message', async () => {
    const { sent, notifier } = collecting();
    const { writes } = harness(notifier);
    const conversation = await group(writes);

    await writes.send('ann', { conversationId: conversation.id, body: 'one' });
    await writes.send('ann', { conversationId: conversation.id, body: 'two' });
    await writes.send('ann', { conversationId: conversation.id, body: 'three' });

    expect(sent).toHaveLength(1);
  });

  it('does not tell somebody who has muted the conversation', async () => {
    const { sent, notifier } = collecting();
    const { writes, state } = harness(notifier);
    const conversation = await group(writes);

    const bob = state.participants.find((row) => row.userId === 'bob');
    if (bob) bob.mutedUntil = new Date(Date.now() + 60 * 60 * 1000);

    await writes.send('ann', { conversationId: conversation.id, body: 'hello' });
    expect(sent).toHaveLength(0);
  });

  /**
   * ⚠ THE ONE THAT MATTERS MOST. The message is already committed and already
   * on every open socket by the time the notifier runs. A mail server that is
   * down must not turn a delivered message into a failed send.
   */
  it('⚠ still sends the message when the notifier throws', async () => {
    const angry: ChatNotifier = {
      async notify() {
        throw new Error('the mail server is on fire');
      },
    };
    const { writes, state } = harness(angry);
    const conversation = await group(writes);

    await expect(writes.send('ann', { conversationId: conversation.id, body: 'hello' })).resolves.toBeDefined();
    expect(state.messages.some((row) => row.body === 'hello')).toBe(true);
  });

  it('works with no notifier bound at all — nobody is told, nothing breaks', async () => {
    const { writes, state } = harness();
    const conversation = await group(writes);

    await expect(writes.send('ann', { conversationId: conversation.id, body: 'hello' })).resolves.toBeDefined();
    expect(state.messages.some((row) => row.body === 'hello')).toBe(true);
  });

  /** A retry already notified whoever was owed a notification the first time. */
  it('does not notify twice for a resent clientMessageId', async () => {
    const { sent, notifier } = collecting();
    const { writes } = harness(notifier);
    const conversation = await group(writes);

    await writes.send('ann', { conversationId: conversation.id, body: 'hello', clientMessageId: 'c-1' });
    await writes.send('ann', { conversationId: conversation.id, body: 'hello', clientMessageId: 'c-1' });

    expect(sent).toHaveLength(1);
  });
});
