import type { ChatMessageView } from '../src/react/chat-client.js';
import {
  applyMessage,
  compareMessages,
  dropPending,
  optimisticMessage,
  readMarkFor,
  type ThreadMessage,
} from '../src/react/view/message-view.js';

/**
 * Three streams land in one thread — the page the reader scrolled, the socket's
 * live events, and the reader's own optimistic sends — and every ordering
 * mistake between them is a message in the wrong place, a message twice, or a
 * message that never appears.
 *
 * All of it is pure, so all of it is argued with here rather than in a browser.
 */

const at = (seconds: number) => new Date(Date.UTC(2026, 8, 11, 12, 0, seconds)).toISOString();

const message = (over: Partial<ChatMessageView> & Pick<ChatMessageView, 'id'>): ChatMessageView => ({
  conversationId: 'c1',
  kind: 'user',
  authorId: 'ann',
  body: 'hello',
  replyToMessageId: null,
  createdAt: at(1),
  editedAt: null,
  deleted: false,
  ...over,
});

describe('compareMessages', () => {
  it('orders by time', () => {
    const older = message({ id: 'a', createdAt: at(1) });
    const newer = message({ id: 'b', createdAt: at(2) });

    expect([newer, older].sort(compareMessages).map((one) => one.id)).toEqual(['a', 'b']);
  });

  it('⚠ breaks a tie by id, because two messages can share a millisecond', () => {
    // Without the tiebreak they land in whichever order they arrived, and the
    // thread disagrees with the unread count the server computes from the same
    // pair.
    const first = message({ id: 'a1', createdAt: at(1) });
    const second = message({ id: 'a2', createdAt: at(1) });

    expect([second, first].sort(compareMessages).map((one) => one.id)).toEqual(['a1', 'a2']);
  });
});

describe('applyMessage', () => {
  it('appends a message the thread has not seen', () => {
    const thread = applyMessage([message({ id: 'm1' })], message({ id: 'm2', createdAt: at(2) }));
    expect(thread.map((one) => one.id)).toEqual(['m1', 'm2']);
  });

  it('⚠ REPLACES an existing message rather than appending it again', () => {
    // Catch-up on reconnection deliberately overlaps what the thread already
    // holds — see the server's withCatchUp.
    const thread = applyMessage([message({ id: 'm1', body: 'first' })], message({ id: 'm1', body: 'first' }));

    expect(thread).toHaveLength(1);
  });

  it('applies an edit in place, keeping its position', () => {
    const start = [message({ id: 'm1', createdAt: at(1) }), message({ id: 'm2', createdAt: at(2) })];
    const thread = applyMessage(start, message({ id: 'm1', createdAt: at(1), body: 'edited', editedAt: at(5) }));

    expect(thread.map((one) => one.id)).toEqual(['m1', 'm2']);
    expect(thread[0]?.body).toBe('edited');
  });

  it('applies a delete as a replacement, not a removal', () => {
    const thread = applyMessage([message({ id: 'm1' })], message({ id: 'm1', body: null, deleted: true }));

    // The tombstone is a position in the thread. Removing the row would shift
    // everything under it while somebody is reading.
    expect(thread).toHaveLength(1);
    expect(thread[0]?.deleted).toBe(true);
  });

  it('⚠ REPLACES the sender’s own pending copy, matched on clientMessageId', () => {
    // The bug that only reaches production: appending shows the message twice,
    // and only to the person who sent it.
    const pending = optimisticMessage({
      conversationId: 'c1',
      authorId: 'ann',
      body: 'hello',
      clientMessageId: 'draft-1',
      now: new Date(at(1)),
    });

    const thread = applyMessage([pending], message({ id: 'm9', clientMessageId: 'draft-1' }));

    expect(thread).toHaveLength(1);
    expect(thread[0]?.id).toBe('m9');
  });

  it('⚠ INSERTS IN ORDER rather than pushing', () => {
    // A replayed gap arrives oldest-first, after the reader has already
    // received newer live messages.
    const thread = applyMessage([message({ id: 'm3', createdAt: at(3) })], message({ id: 'm1', createdAt: at(1) }));

    expect(thread.map((one) => one.id)).toEqual(['m1', 'm3']);
  });
});

describe('optimisticMessage', () => {
  it('carries a timestamp, so it does not sort to the top of the thread', () => {
    const pending = optimisticMessage({
      conversationId: 'c1',
      authorId: 'ann',
      body: 'hello',
      clientMessageId: 'draft-1',
    });

    expect(Number.isNaN(new Date(pending.createdAt).getTime())).toBe(false);
    expect(pending.pending).toBe(true);
  });

  it('has an id that cannot collide with a server one', () => {
    const pending = optimisticMessage({
      conversationId: 'c1',
      authorId: 'ann',
      body: 'hello',
      clientMessageId: 'draft-1',
    });

    expect(pending.id).toContain('pending:');
  });
});

describe('dropPending', () => {
  it('removes only the refused draft, and only the pending copy', () => {
    const pending = optimisticMessage({
      conversationId: 'c1',
      authorId: 'ann',
      body: 'hello',
      clientMessageId: 'draft-1',
    });
    const confirmed = message({ id: 'm1', clientMessageId: 'draft-2' });

    const thread = dropPending([pending, confirmed], 'draft-1');

    expect(thread.map((one) => one.id)).toEqual(['m1']);
  });
});

describe('readMarkFor', () => {
  it('is the newest message somebody else sent', () => {
    const thread: ThreadMessage[] = [
      message({ id: 'm1', authorId: 'bob', createdAt: at(1) }),
      message({ id: 'm2', authorId: 'bob', createdAt: at(2) }),
    ];

    expect(readMarkFor(thread, 'ann')?.id).toBe('m2');
  });

  it('⚠ skips your own messages, so sending does not write a read mark', () => {
    const thread: ThreadMessage[] = [
      message({ id: 'm1', authorId: 'bob', createdAt: at(1) }),
      message({ id: 'm2', authorId: 'ann', createdAt: at(2) }),
    ];

    expect(readMarkFor(thread, 'ann')?.id).toBe('m1');
  });

  it('⚠ skips a pending copy, which has no server id to mark', () => {
    const thread: ThreadMessage[] = [
      message({ id: 'm1', authorId: 'bob' }),
      optimisticMessage({ conversationId: 'c1', authorId: 'ann', body: 'x', clientMessageId: 'draft-1' }),
    ];

    expect(readMarkFor(thread, 'ann')?.id).toBe('m1');
  });

  it('counts a DELETED message, so the mark is not stuck behind a tombstone', () => {
    const thread: ThreadMessage[] = [
      message({ id: 'm1', authorId: 'bob', createdAt: at(1) }),
      message({ id: 'm2', authorId: 'bob', createdAt: at(2), body: null, deleted: true }),
    ];

    expect(readMarkFor(thread, 'ann')?.id).toBe('m2');
  });

  it('is undefined in a thread of your own messages alone', () => {
    expect(readMarkFor([message({ id: 'm1', authorId: 'ann' })], 'ann')).toBeUndefined();
  });
});
