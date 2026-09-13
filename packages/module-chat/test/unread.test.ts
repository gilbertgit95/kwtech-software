import { ChatService } from '../src/server/chat.service.js';
import { ChatWriteService } from '../src/server/chat-write.service.js';
import { emptyState, fakeClient } from './fake-client.js';

/**
 * ── HOW MUCH IS WAITING ────────────────────────────────────────────────────
 *
 * ⚠ These are the first tests this count has had, and it is the number the
 * whole drawer badge is made of. It was a `findUnique` plus a `count` PER
 * CONVERSATION — forty round trips for somebody in twenty of them, run again
 * every time anybody sends them a message — and the fake's `count` ignored the
 * keyset clause entirely, so the boundary could have been wrong in either
 * direction and nothing here would have said so.
 *
 * Now it is one grouped query, and the fake honours the pair.
 */

const harness = () => {
  const { client, state } = fakeClient(emptyState());
  return { reads: new ChatService(client), writes: new ChatWriteService(client), state, client };
};

/**
 * Every delegate call the client sees, so a test can assert the SHAPE of the
 * cost rather than only the answer.
 *
 * ⚠ The regression this exists to catch is invisible in every other assertion:
 * a count per conversation returns exactly the right numbers and is simply
 * quadratic. Nothing about the output says so.
 */
function counting<T extends object>(client: T): { client: T; queries: () => number } {
  let count = 0;
  const wrapped = new Proxy(client, {
    get(target, model: string) {
      const delegate = (target as Record<string, Record<string, unknown>>)[model];
      if (typeof delegate !== 'object' || delegate === null) return delegate;
      return new Proxy(delegate, {
        get(inner, method: string) {
          const fn = inner[method];
          if (typeof fn !== 'function') return fn;
          return (...args: unknown[]) => {
            count += 1;
            return (fn as (...a: unknown[]) => unknown).apply(inner, args);
          };
        },
      });
    },
  });
  return { client: wrapped as T, queries: () => count };
}

describe('unreadByConversation', () => {
  it('counts what arrived after the mark, and nothing before it', async () => {
    const { reads, writes } = harness();
    const group = await writes.startGroup('ann', { title: 'Team', userIds: ['bob'] });
    await writes.respondToInvitation('bob', group.id, true);

    const first = await writes.send('bob', { conversationId: group.id, body: 'one' });
    await writes.send('bob', { conversationId: group.id, body: 'two' });

    const before = await reads.listConversations('ann');
    expect(before.find((one) => one.conversation.id === group.id)?.unread).toBe(2);

    await writes.markRead('ann', group.id, first.id);

    const after = await reads.listConversations('ann');
    expect(after.find((one) => one.conversation.id === group.id)?.unread).toBe(1);
  });

  /**
   * ⚠ THE THREE EXCLUSIONS, which are the domain's `countsAsUnread` expressed
   * as a query. Each one is a badge that would otherwise be wrong: you know
   * what you sent, "X left" is addressed to nobody, and a tombstone holds its
   * place in the ordering but points at nothing to read.
   */
  it('excludes your own messages, system messages and tombstones', async () => {
    const { reads, writes } = harness();
    const group = await writes.startGroup('ann', { title: 'Team', userIds: ['bob'] });
    await writes.respondToInvitation('bob', group.id, true);

    await writes.send('ann', { conversationId: group.id, body: 'mine' });
    const doomed = await writes.send('bob', { conversationId: group.id, body: 'gone' });
    await writes.delete('bob', doomed.id, { mayModerate: false });
    // Leaving writes a `kind: system` message into the same conversation.
    await writes.leave('bob', group.id);

    const list = await reads.listConversations('ann');
    expect(list.find((one) => one.conversation.id === group.id)?.unread).toBe(0);
  });

  /**
   * ⚠ THE KEYSET PAIR IS THE WHOLE CORRECTNESS OF THE BADGE, and this is the
   * case `id: { gt }` alone gets wrong. Two messages can share a timestamp —
   * the database's resolution is finite and a burst arrives inside it — so the
   * boundary is "later, OR the same instant with a greater id", exactly the
   * order the thread is paged in.
   */
  it('⚠ breaks a timestamp tie by id rather than counting both or neither', async () => {
    const { reads, writes, state } = harness();
    const group = await writes.startGroup('ann', { title: 'Team', userIds: ['bob'] });
    await writes.respondToInvitation('bob', group.id, true);

    const mark = await writes.send('bob', { conversationId: group.id, body: 'the mark' });
    const tied = await writes.send('bob', { conversationId: group.id, body: 'same instant' });

    // The fake increments its clock per write; force the collision the database
    // can produce on its own.
    const tiedRow = state.messages.find((row) => row.id === tied.id);
    if (tiedRow) tiedRow.createdAt = mark.createdAt;
    expect(tied.id > mark.id).toBe(true);

    await writes.markRead('ann', group.id, mark.id);

    const list = await reads.listConversations('ann');
    expect(list.find((one) => one.conversation.id === group.id)?.unread).toBe(1);
  });

  /**
   * ⚠ AN INVITATION IS NOT COUNTED. It shows who sent it and not one word of
   * what was said (§12.51), so a number on it would put a count on a thread the
   * viewer is refused — and the requests inbox counts invitations separately.
   */
  it('⚠ counts nothing for a conversation the viewer has only been invited to', async () => {
    const { reads, writes } = harness();
    const group = await writes.startGroup('ann', { title: 'Team', userIds: ['bob'] });
    await writes.send('ann', { conversationId: group.id, body: 'hello' });

    const list = await reads.listConversations('bob');
    expect(list.find((one) => one.conversation.id === group.id)?.unread).toBe(0);
  });

  /**
   * ⚠ A MARK THAT NO LONGER RESOLVES COUNTS EVERYTHING. An unknown boundary
   * must fail towards "there is something to read": the other direction hides a
   * message behind a badge that says nothing is waiting.
   */
  it('⚠ counts everything when the mark points at a message that is not there', async () => {
    const { reads, writes, state } = harness();
    const group = await writes.startGroup('ann', { title: 'Team', userIds: ['bob'] });
    await writes.respondToInvitation('bob', group.id, true);
    await writes.send('bob', { conversationId: group.id, body: 'one' });
    const mark = await writes.send('bob', { conversationId: group.id, body: 'two' });
    await writes.send('bob', { conversationId: group.id, body: 'three' });
    await writes.markRead('ann', group.id, mark.id);

    // With the mark readable this is 1 — only the third message is after it.
    expect((await reads.conversationFor('ann', group.id)).unread).toBe(1);

    state.messages.splice(
      state.messages.findIndex((row) => row.id === mark.id),
      1,
    );

    // With the boundary gone, both survivors count rather than neither.
    expect((await reads.conversationFor('ann', group.id)).unread).toBe(2);
  });

  /**
   * The list and the detail view must never disagree about one number, which is
   * why `conversationFor` calls the same function with a single row rather than
   * restating the rule.
   */
  it('gives the same answer through the list and through one conversation', async () => {
    const { reads, writes } = harness();
    const group = await writes.startGroup('ann', { title: 'Team', userIds: ['bob'] });
    await writes.respondToInvitation('bob', group.id, true);
    await writes.send('bob', { conversationId: group.id, body: 'one' });
    await writes.send('bob', { conversationId: group.id, body: 'two' });

    const fromList = (await reads.listConversations('ann')).find((one) => one.conversation.id === group.id)?.unread;
    const fromOne = (await reads.conversationFor('ann', group.id)).unread;

    expect(fromOne).toBe(2);
    expect(fromOne).toBe(fromList);
  });

  /**
   * ⚠ THE POINT OF THE WHOLE CHANGE, and the only assertion that can see it.
   * Every other test here passes just as well against a count per conversation
   * — it returns the right numbers, it is simply quadratic, and the badge
   * re-reads this on every message anybody sends the viewer.
   */
  it('⚠ costs the same number of queries for two conversations as for six', async () => {
    const { client, state } = fakeClient(emptyState());
    const writes = new ChatWriteService(client);

    const seed = async (count: number) => {
      for (let index = 0; index < count; index += 1) {
        const group = await writes.startGroup('ann', { title: `Group ${index}`, userIds: ['bob'] });
        await writes.respondToInvitation('bob', group.id, true);
        const message = await writes.send('bob', { conversationId: group.id, body: 'hello' });
        await writes.markRead('ann', group.id, message.id);
        await writes.send('bob', { conversationId: group.id, body: 'and again' });
      }
    };

    await seed(2);
    const small = counting(client);
    await new ChatService(small.client).listConversations('ann');

    await seed(4);
    const large = counting(client);
    const list = await new ChatService(large.client).listConversations('ann');

    expect(list).toHaveLength(6);
    expect(large.queries()).toBe(small.queries());
    // Five: my rows, the conversations, everybody in them, the marks, the count.
    expect(large.queries()).toBe(5);
    expect(state.conversations).toHaveLength(6);
  });

  it('keeps each conversation on its own mark', async () => {
    const { reads, writes } = harness();
    const first = await writes.startGroup('ann', { title: 'One', userIds: ['bob'] });
    const second = await writes.startGroup('ann', { title: 'Two', userIds: ['bob'] });
    await writes.respondToInvitation('bob', first.id, true);
    await writes.respondToInvitation('bob', second.id, true);

    const markable = await writes.send('bob', { conversationId: first.id, body: 'one' });
    await writes.send('bob', { conversationId: first.id, body: 'two' });
    await writes.send('bob', { conversationId: second.id, body: 'alone' });
    await writes.markRead('ann', first.id, markable.id);

    const list = await reads.listConversations('ann');
    const unread = new Map(list.map((one) => [one.conversation.id, one.unread]));
    expect(unread.get(first.id)).toBe(1);
    expect(unread.get(second.id)).toBe(1);
  });
});
