import { decodeCursor } from '../src/domain/ordering.js';
import { NotificationWriteError } from '../src/server/notification.errors.js';
import { NotificationEventPublisher } from '../src/server/notification.events.js';
import { resolveNotificationConfig } from '../src/server/notification.options.js';
import type { NotificationEvent, NotificationPubSub } from '../src/server/notification.pubsub.js';
import { NotificationSender } from '../src/server/notification.sender.js';
import { NotificationService } from '../src/server/notification.service.js';
import { NotificationWriteService } from '../src/server/notification-write.service.js';
import { fakeClient } from './fake-client.js';

function setup(options: { floodLimitPerMinute?: number; failPublish?: boolean } = {}) {
  const { client, state } = fakeClient();
  const published: NotificationEvent[] = [];
  const pubsub: NotificationPubSub = {
    async publish(_trigger, payload) {
      if (options.failPublish) throw new Error('redis is down');
      published.push(payload as NotificationEvent);
    },
    async *asyncIterableIterator() {
      // Not used by these tests.
    },
  };
  const config = resolveNotificationConfig({
    sources: [
      { key: 'queue', label: 'Queue', mutable: true },
      { key: 'security', label: 'Security', mutable: false },
    ],
    ...(options.floodLimitPerMinute ? { floodLimitPerMinute: options.floodLimitPerMinute } : {}),
  });
  const events = new NotificationEventPublisher(pubsub);
  return {
    state,
    published,
    sender: new NotificationSender(client, config, events),
    reads: new NotificationService(client, config),
    writes: new NotificationWriteService(client, events),
  };
}

describe('NotificationSender.send', () => {
  it('writes one row per recipient under one batch, and publishes each AFTER the commit', async () => {
    const { sender, state, published } = setup();
    const result = await sender.send({ recipientIds: ['ana', 'ben'], title: 'Queue started', source: 'queue' });

    expect(result).toMatchObject({ written: 2, grouped: 0, overflowed: 0 });
    expect(state.notificationItem.map((row) => row.recipientId)).toEqual(['ana', 'ben']);
    expect(state.notificationBatch).toEqual([expect.objectContaining({ id: result.batchId, recipientCount: 2 })]);
    expect(published.map((event) => [event.kind, event.recipientId])).toEqual([
      ['created', 'ana'],
      ['created', 'ben'],
    ]);
    expect(published[0]?.notification).toMatchObject({ title: 'Queue started', sourceLabel: 'Queue' });
  });

  it('⚠ refuses a bad send with its reason, and writes nothing', async () => {
    const { sender, state } = setup();
    await expect(sender.send({ recipientIds: ['ana'], title: 'x', source: 'nope' })).rejects.toMatchObject({
      reason: 'unknown_source',
    });
    expect(state.notificationItem).toEqual([]);
    expect(state.notificationBatch).toEqual([]);
  });

  it('⚠ a failed publish does not fail the send — the row is committed, and catch-up delivers it', async () => {
    const { sender, state } = setup({ failPublish: true });
    await expect(sender.send({ recipientIds: ['ana'], title: 'Hi', source: 'queue' })).resolves.toMatchObject({
      written: 1,
    });
    expect(state.notificationItem).toHaveLength(1);
  });

  it('⚠ sendSafely never throws — reporting an error must not become a second error', async () => {
    const { sender } = setup();
    await expect(sender.sendSafely({ recipientIds: [], title: 'x', source: 'queue' })).resolves.toBeNull();
  });

  it('dedupes a re-send to the same person, and does not toast it again', async () => {
    const { sender, state, published } = setup();
    await sender.send({ recipientIds: ['ana'], title: 'Invite', source: 'queue', dedupeKey: 'invite:1' });
    const again = await sender.send({
      recipientIds: ['ana', 'ben'],
      title: 'Invite',
      source: 'queue',
      dedupeKey: 'invite:1',
    });

    expect(again.written).toBe(1);
    expect(state.notificationItem.map((row) => row.recipientId)).toEqual(['ana', 'ben']);
    expect(published.filter((event) => event.recipientId === 'ana')).toHaveLength(1);
  });

  it('folds into the recipient’s open group, renders the count, and moves it to the top', async () => {
    const { sender, state, published } = setup();
    const group = { key: 'joined', title: '{count} people joined' };
    await sender.send({ recipientIds: ['ana'], title: 'Ben joined', source: 'queue', group });
    const second = await sender.send({ recipientIds: ['ana'], title: 'Cy joined', source: 'queue', group });

    expect(second).toMatchObject({ written: 0, grouped: 1 });
    expect(state.notificationItem).toHaveLength(1);
    expect(state.notificationItem[0]).toMatchObject({ title: '2 people joined', groupCount: 2 });
    expect(published.at(-1)).toMatchObject({ kind: 'grouped', recipientId: 'ana' });
  });

  it('⚠ does not fold into a group once it has been read — the next one starts a new row', async () => {
    const { sender, state } = setup();
    const group = { key: 'joined', title: '{count} people joined' };
    await sender.send({ recipientIds: ['ana'], title: 'Ben joined', source: 'queue', group });
    (state.notificationItem[0] as { readAt: Date | null }).readAt = new Date();
    await sender.send({ recipientIds: ['ana'], title: 'Cy joined', source: 'queue', group });

    expect(state.notificationItem.map((row) => row.title)).toEqual(['Ben joined', 'Cy joined']);
  });

  it('⚠ folds a flooding source into one overflow row per person, and keeps an alert loud', async () => {
    const { sender, state } = setup({ floodLimitPerMinute: 2 });
    for (const title of ['one', 'two', 'three', 'four']) {
      await sender.send({ recipientIds: ['ana'], title, source: 'queue' });
    }
    const last = await sender.send({ recipientIds: ['ana'], title: 'fire', source: 'queue', severity: 'alert' });

    expect(last.overflowed).toBe(1);
    // Two ordinary rows, then ONE overflow row that absorbed the rest.
    expect(state.notificationItem).toHaveLength(3);
    const overflow = state.notificationItem.find((row) => row.groupKey === 'overflow:queue');
    expect(overflow).toMatchObject({ groupCount: 3, title: '3 more notifications from Queue', severity: 'alert' });
  });

  it('does not count another source, or anything older than a minute, toward the flood', async () => {
    const { sender, state } = setup({ floodLimitPerMinute: 1 });
    await sender.send({ recipientIds: ['ana'], title: 'old', source: 'queue' });
    (state.notificationItem[0] as { createdAt: Date }).createdAt = new Date(Date.now() - 120_000);
    await sender.send({ recipientIds: ['ana'], title: 'other source', source: 'security' });
    const result = await sender.send({ recipientIds: ['ana'], title: 'new', source: 'queue' });
    expect(result.overflowed).toBe(0);
  });
});

describe('NotificationService.list — unread first, keyset pages', () => {
  async function seed(count: number, readEvery = 0) {
    const context = setup();
    for (let i = 1; i <= count; i += 1) {
      await context.sender.send({ recipientIds: ['ana'], title: `n${i}`, source: 'queue' });
    }
    if (readEvery > 0) {
      for (const [index, row] of context.state.notificationItem.entries()) {
        if ((index + 1) % readEvery === 0) (row as { readAt: Date | null }).readAt = new Date();
      }
    }
    return context;
  }

  it('lists unread first, newest first within each run', async () => {
    const { reads } = await seed(6, 2); // n2, n4, n6 read
    const page = await reads.list('ana', { first: 10 });
    expect(page.items.map((item) => item.title)).toEqual(['n5', 'n3', 'n1', 'n6', 'n4', 'n2']);
    expect(page).toMatchObject({ totalCount: 6, unreadCount: 3, hasNext: false, hasPrevious: false });
  });

  it('⚠ walks every row exactly once across pages that cross from unread to read', async () => {
    const { reads } = await seed(7, 3); // n3, n6 read
    const seen: string[] = [];
    let after: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await reads.list('ana', { first: 2, after });
      seen.push(...page.items.map((item) => item.title));
      if (!page.hasNext) break;
      after = page.endCursor;
    }
    expect(seen).toEqual(['n7', 'n5', 'n4', 'n2', 'n1', 'n6', 'n3']);
  });

  it('⚠ Previous returns the same rows Next showed, in display order', async () => {
    const { reads } = await seed(7, 3);
    const first = await reads.list('ana', { first: 3 });
    const second = await reads.list('ana', { first: 3, after: first.endCursor });
    const back = await reads.list('ana', { first: 3, before: second.startCursor });
    expect(back.items.map((item) => item.title)).toEqual(first.items.map((item) => item.title));
    expect(back.hasPrevious).toBe(false);
  });

  it('⚠ does not repeat or skip a row when a new one arrives mid-walk', async () => {
    const { reads, sender } = await seed(4);
    const first = await reads.list('ana', { first: 2 });
    await sender.send({ recipientIds: ['ana'], title: 'arrived', source: 'queue' });
    const second = await reads.list('ana', { first: 2, after: first.endCursor });
    expect([...first.items, ...second.items].map((item) => item.title)).toEqual(['n4', 'n3', 'n2', 'n1']);
  });

  it('orders newest first when asked, ignoring read state', async () => {
    const { reads } = await seed(4, 2);
    const page = await reads.list('ana', { order: 'newest' });
    expect(page.items.map((item) => item.title)).toEqual(['n4', 'n3', 'n2', 'n1']);
    expect(decodeCursor(page.endCursor ?? '')?.run).toBe('all');
  });

  it('⚠ never shows another person’s rows, or recalled ones', async () => {
    const { reads, sender, state } = await seed(2);
    await sender.send({ recipientIds: ['ben'], title: 'for ben', source: 'queue' });
    (state.notificationItem[0] as { recalledAt: Date | null }).recalledAt = new Date();
    const page = await reads.list('ana', {});
    expect(page.items.map((item) => item.title)).toEqual(['n2']);
    expect(page.totalCount).toBe(1);
  });

  it('filters by where it came from — one organization, or global only', async () => {
    const { reads, sender } = setup();
    await sender.send({ recipientIds: ['ana'], title: 'global', source: 'queue' });
    await sender.send({
      recipientIds: ['ana'],
      title: 'acme',
      source: 'queue',
      context: { scope: 'organization', organizationId: 'acme', label: 'Acme' },
    });
    expect((await reads.list('ana', { globalOnly: true })).items.map((item) => item.title)).toEqual(['global']);
    expect((await reads.list('ana', { organizationId: 'acme' })).items.map((item) => item.title)).toEqual(['acme']);
  });

  it('⚠ refuses a tampered cursor instead of silently returning page 1', async () => {
    const { reads } = await seed(2);
    await expect(reads.list('ana', { after: 'garbage' })).rejects.toBeInstanceOf(NotificationWriteError);
    await expect(reads.list('ana', { after: 'x', before: 'y' })).rejects.toMatchObject({ reason: 'invalid' });
  });

  it('hides the buttons of an expired notification', async () => {
    const { reads, sender } = setup();
    await sender.send({
      recipientIds: ['ana'],
      title: 'Report ready',
      source: 'queue',
      actions: [{ kind: 'link', key: 'open', label: 'Open', href: '/r', target: 'self' }],
      expiresAt: new Date(Date.now() - 1000),
    });
    const [item] = (await reads.list('ana', {})).items;
    expect(item?.actions).toEqual([]);
    expect(item?.expiresAt).not.toBeNull();
  });
});

describe('NotificationService — the count and the catch-up', () => {
  it('counts unread, unarchived, unrecalled rows for the actor only', async () => {
    const { reads, sender, state } = setup();
    await sender.send({ recipientIds: ['ana', 'ben'], title: 'a', source: 'queue' });
    await sender.send({ recipientIds: ['ana'], title: 'b', source: 'queue' });
    await sender.send({ recipientIds: ['ana'], title: 'c', source: 'queue' });
    const [first, , , third] = state.notificationItem as Array<{ archivedAt: Date | null; readAt: Date | null }>;
    if (first) first.archivedAt = new Date();
    if (third) third.readAt = new Date();
    expect(await reads.unreadCount('ana')).toBe(1);
    expect(await reads.unreadCount('ben')).toBe(1);
  });

  it('returns only what arrived after the given time, for the actor, not archived or recalled', async () => {
    const { reads, sender, state } = setup();
    await sender.send({ recipientIds: ['ana'], title: 'before', source: 'queue' });
    await sender.send({ recipientIds: ['ana', 'ben'], title: 'after', source: 'queue', severity: 'alert' });
    const [before] = state.notificationItem as Array<{ occurredAt: Date }>;
    const since = (before?.occurredAt ?? new Date()).toISOString();

    const missed = await reads.since('ana', since);
    expect(missed.items.map((item) => item.title)).toEqual(['after']);
    expect(missed.total).toBe(1);
    await expect(reads.since('ana', 'not a time')).rejects.toMatchObject({ reason: 'invalid' });
  });
});

describe('NotificationWriteService', () => {
  it('⚠ marks only the actor’s own rows — someone else’s id is skipped silently', async () => {
    const { sender, writes, state } = setup();
    await sender.send({ recipientIds: ['ana', 'ben'], title: 'x', source: 'queue' });
    const ids = state.notificationItem.map((row) => row.id as string);
    expect(await writes.markRead('ana', ids)).toBe(1);
    expect(state.notificationItem.map((row) => row.readAt !== null)).toEqual([true, false]);
  });

  it('marks unread, archives and unarchives, publishing only when something changed', async () => {
    const { sender, writes, state, published } = setup();
    await sender.send({ recipientIds: ['ana'], title: 'x', source: 'queue' });
    const id = state.notificationItem[0]?.id as string;
    const before = published.length;

    expect(await writes.markUnread('ana', [id])).toBe(0); // already unread
    expect(published.length).toBe(before);
    expect(await writes.markRead('ana', [id])).toBe(1);
    expect(await writes.markUnread('ana', [id])).toBe(1);
    expect(await writes.archive('ana', [id])).toBe(1);
    expect(await writes.unarchive('ana', [id])).toBe(1);
    expect(published.slice(before).map((event) => event.kind)).toEqual(['read', 'unread', 'archived', 'unarchived']);
  });

  it('refuses more than a page of ids at once', async () => {
    const { writes } = setup();
    const ids = Array.from({ length: 101 }, (_, index) => `n${index}`);
    await expect(writes.markRead('ana', ids)).rejects.toMatchObject({ reason: 'invalid' });
  });

  it('⚠ "mark all read" stops at what the client had seen, so a later arrival stays unread', async () => {
    const { sender, writes, state } = setup();
    await sender.send({ recipientIds: ['ana'], title: 'seen', source: 'queue' });
    const first = state.notificationItem[0] as { occurredAt: Date };
    const seen = first.occurredAt.toISOString();
    await sender.send({ recipientIds: ['ana'], title: 'arrived while clicking', source: 'queue' });
    expect(await writes.markAllRead('ana', seen)).toBe(1);
    expect(state.notificationItem.map((row) => row.readAt !== null)).toEqual([true, false]);
  });

  it('⚠ recall removes a send from every inbox, frees its dedupe key, and tells each open tab', async () => {
    const { sender, writes, reads, state, published } = setup();
    const { batchId } = await sender.send({
      recipientIds: ['ana', 'ben'],
      title: 'Oops',
      source: 'queue',
      dedupeKey: 'oops',
    });
    await writes.recall('admin', batchId);

    expect((await reads.list('ana', {})).items).toEqual([]);
    expect(state.notificationItem.every((row) => row.dedupeKey === null)).toBe(true);
    expect(state.notificationBatch[0]).toMatchObject({ recalledById: 'admin' });
    expect(published.filter((event) => event.kind === 'recalled').map((event) => event.recipientId)).toEqual([
      'ana',
      'ben',
    ]);

    // The corrected re-send is not swallowed by the old dedupe key.
    const again = await sender.send({ recipientIds: ['ana'], title: 'Fixed', source: 'queue', dedupeKey: 'oops' });
    expect(again.written).toBe(1);
  });

  it('recall is idempotent, and refuses a batch that does not exist', async () => {
    const { sender, writes, published } = setup();
    const { batchId } = await sender.send({ recipientIds: ['ana'], title: 'x', source: 'queue' });
    await writes.recall('admin', batchId);
    const count = published.length;
    await writes.recall('admin', batchId);
    expect(published.length).toBe(count);
    await expect(writes.recall('admin', 'missing')).rejects.toMatchObject({ reason: 'not_found' });
  });
});
