import { NotificationResolver } from '../src/server/graphql/notification.resolver.js';
import type { NotificationEventType } from '../src/server/graphql/notification.types.js';
import { NotificationEventPublisher } from '../src/server/notification.events.js';
import { resolveNotificationConfig } from '../src/server/notification.options.js';
import { NOTIFICATION_EVENT, type NotificationPubSub } from '../src/server/notification.pubsub.js';
import { NotificationSender } from '../src/server/notification.sender.js';
import { NotificationService } from '../src/server/notification.service.js';
import { NotificationWriteService } from '../src/server/notification-write.service.js';
import { fakeClient } from './fake-client.js';

/**
 * An in-process engine with the one property that matters here: every
 * subscriber gets every publish, exactly as the real engine does. The FILTER is
 * what the test is about.
 */
function memoryPubSub(): NotificationPubSub {
  const subscribers = new Set<(payload: unknown) => void>();
  return {
    async publish(trigger, payload) {
      if (trigger !== NOTIFICATION_EVENT.item) return;
      for (const deliver of subscribers) deliver(payload);
    },
    asyncIterableIterator<T>(): AsyncIterableIterator<T> {
      const queue: T[] = [];
      let wake: (() => void) | null = null;
      const deliver = (payload: unknown) => {
        queue.push(payload as T);
        wake?.();
      };
      subscribers.add(deliver);
      const iterator: AsyncIterableIterator<T> = {
        async next() {
          while (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
          return { value: queue.shift() as T, done: false };
        },
        async return() {
          subscribers.delete(deliver);
          return { value: undefined, done: true };
        },
        [Symbol.asyncIterator]() {
          return iterator;
        },
      };
      return iterator;
    },
  };
}

function setup() {
  const { client } = fakeClient();
  const pubsub = memoryPubSub();
  const config = resolveNotificationConfig({ sources: [{ key: 'queue', label: 'Queue', mutable: true }] });
  const events = new NotificationEventPublisher(pubsub);
  const sender = new NotificationSender(client, config, events);
  const options = { resolveActorId: (request: unknown) => (request as { userId?: string }).userId };
  const resolver = new NotificationResolver(
    new NotificationService(client, config),
    new NotificationWriteService(client, events),
    sender,
    options,
    pubsub,
  );
  return { resolver, sender };
}

async function take(stream: AsyncIterableIterator<NotificationEventType>, count: number) {
  const out: NotificationEventType[] = [];
  for (let i = 0; i < count; i += 1) {
    const next = await stream.next();
    if (next.done) break;
    out.push(next.value);
  }
  return out;
}

describe('notificationEvents — who receives what', () => {
  it('opens with `sync`, the event that makes a reconnect lose nothing', async () => {
    const { resolver } = setup();
    const stream = resolver.notificationEvents({ req: { userId: 'ana' } });
    expect((await take(stream, 1))[0]).toEqual({ kind: 'sync', ids: [], batchId: null, notification: null });
    await stream.return?.();
  });

  it('⚠ delivers a notification to its recipient and to nobody else', async () => {
    const { resolver, sender } = setup();
    const ana = resolver.notificationEvents({ req: { userId: 'ana' } });
    const ben = resolver.notificationEvents({ req: { userId: 'ben' } });
    await take(ana, 1);
    await take(ben, 1);

    await sender.send({ recipientIds: ['ben'], title: 'For Ben only', source: 'queue' });
    await sender.send({ recipientIds: ['ana'], title: 'For Ana', source: 'queue' });

    const [forAna] = await take(ana, 1);
    const [forBen] = await take(ben, 1);
    expect(forAna?.notification?.title).toBe('For Ana');
    expect(forBen?.notification?.title).toBe('For Ben only');
    await ana.return?.();
    await ben.return?.();
  });

  it('⚠ does not put the recipient id on the wire — it was the filter, not content', async () => {
    const { resolver, sender } = setup();
    const ana = resolver.notificationEvents({ req: { userId: 'ana' } });
    await take(ana, 1);
    await sender.send({ recipientIds: ['ana'], title: 'Hi', source: 'queue' });
    const [event] = await take(ana, 1);
    expect(event).not.toHaveProperty('recipientId');
    expect(event?.kind).toBe('created');
    await ana.return?.();
  });

  it('refuses to subscribe with nobody signed in — at subscribe, not on a first event that never comes', () => {
    const { resolver } = setup();
    expect(() => resolver.notificationEvents({ req: {} })).toThrow('Not signed in');
  });
});
