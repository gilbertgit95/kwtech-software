import type { ChatMessageView } from '../chat-client.js';

/**
 * What a thread does with a message that arrives while it is open.
 *
 * ⚠ THE HARDEST PART OF THE SCREEN, and pure so it can be argued with in a
 * test. Three streams land in one list — the page the reader scrolled, the
 * socket's live events, and the reader's own optimistic sends — and every
 * ordering mistake between them shows up as a message in the wrong place, a
 * message twice, or a message that never appears.
 */

/**
 * A message the reader has sent but the server has not confirmed.
 *
 * ⚠ IT CARRIES A REAL `clientMessageId`, which is the whole mechanism: the
 * server is idempotent on it, and the confirmed message comes back carrying the
 * same one — so reconciliation is an id match rather than a guess about
 * timestamps and bodies.
 */
export interface PendingMessage extends ChatMessageView {
  /** Set only on the local copy. Cleared the moment the server's own arrives. */
  pending: true;
  clientMessageId: string;
}

export type ThreadMessage = ChatMessageView | PendingMessage;

export function isPending(message: ThreadMessage): message is PendingMessage {
  return 'pending' in message && message.pending === true;
}

/**
 * Strictly later in the thread's own ordering — `(createdAt, id)`, both halves.
 *
 * ⚠ THE SAME PAIR THE SERVER PAGES BY, and the tiebreak is not decoration: two
 * messages can share a millisecond, and comparing timestamps alone puts them in
 * whichever order they happened to arrive. The badge's unread count is computed
 * from the same pair server-side, so a thread that ordered differently would
 * disagree with its own count.
 */
export function compareMessages(a: ThreadMessage, b: ThreadMessage): number {
  const byTime = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
}

/**
 * One message into a thread — arriving live, confirmed after an optimistic
 * send, or replayed after a reconnection.
 *
 * Four cases, and the first two are the ones that go wrong quietly:
 *
 *   1. ⚠ It REPLACES the reader's own pending copy, matched on
 *      `clientMessageId`. Appending instead shows the message twice, and only
 *      to the person who sent it — which is the version of this bug that
 *      reaches production, because it never happens to anybody testing with one
 *      browser.
 *   2. ⚠ It REPLACES an existing message with the same id rather than
 *      appending. Catch-up on reconnection deliberately overlaps what the
 *      thread already holds, and an edit or a delete arrives as the same id
 *      with different contents.
 *   3. It is inserted IN ORDER, not pushed. A replayed gap arrives oldest-first
 *      after the reader has already received newer live messages.
 *   4. Anything for another conversation is ignored, because one socket carries
 *      every conversation this person is in.
 */
export function applyMessage(messages: readonly ThreadMessage[], incoming: ChatMessageView): ThreadMessage[] {
  const replaced = messages.map((existing) => {
    if (existing.id === incoming.id) return incoming;
    // The optimistic copy, by the id the sender minted for it.
    if (isPending(existing) && existing.clientMessageId === incoming.clientMessageId) return incoming;
    return existing;
  });

  const alreadyThere = replaced.some((existing) => existing.id === incoming.id);
  return (alreadyThere ? replaced : [...replaced, incoming]).sort(compareMessages);
}

/**
 * The reader's own message, on screen before the server has heard of it.
 *
 * ⚠ `createdAt` IS A LOCAL GUESS and the server's value wins the moment it
 * arrives. It has to be something — the list sorts by it — and it will be
 * slightly wrong, which is invisible for the half-second it survives. What it
 * must NOT be is omitted: a message with no timestamp sorts to the top of the
 * thread, which is the one place it certainly does not belong.
 */
export function optimisticMessage(input: {
  conversationId: string;
  authorId: string;
  body: string;
  clientMessageId: string;
  now?: Date;
}): PendingMessage {
  return {
    // Distinct from any server id, and stable for the life of the copy so React
    // does not rebuild the row when anything around it changes.
    id: `pending:${input.clientMessageId}`,
    conversationId: input.conversationId,
    kind: 'user',
    authorId: input.authorId,
    body: input.body,
    clientMessageId: input.clientMessageId,
    replyToMessageId: null,
    createdAt: (input.now ?? new Date()).toISOString(),
    editedAt: null,
    deleted: false,
    pending: true,
  };
}

/** Drops a pending copy whose send was refused, so a failure does not linger. */
export function dropPending(messages: readonly ThreadMessage[], clientMessageId: string): ThreadMessage[] {
  return messages.filter((message) => !(isPending(message) && message.clientMessageId === clientMessageId));
}

/**
 * The newest message that should move the read mark, or undefined.
 *
 * ⚠ NEVER YOUR OWN, and never a pending copy. Marking your own message as read
 * is harmless server-side — it moves the cursor forward — but it would send a
 * write on every keystroke-ending send, and `markChatRead` refuses to move
 * backwards anyway. A pending message has no server id to mark.
 *
 * Deleted messages ARE eligible: the tombstone is still a position in the
 * thread, and skipping it would leave the mark stuck behind a message nobody
 * can read.
 */
export function readMarkFor(messages: readonly ThreadMessage[], viewerId: string): ChatMessageView | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || isPending(message)) continue;
    if (message.authorId === viewerId) continue;
    return message;
  }
  return undefined;
}
