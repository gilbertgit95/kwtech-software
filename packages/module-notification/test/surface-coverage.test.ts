import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC_SURFACE_METADATA, REQUIRED_SCOPE_METADATA } from '@kwtech/module-kit';
import { NOTIFICATION_FEATURE, NOTIFICATION_FEATURE_REGISTRY } from '../src/feature-keys.js';
import { NotificationResolver } from '../src/server/graphql/notification.resolver.js';

/**
 * ⚠ THERE IS NO `@RequireFeature` HERE, so a missing BINDING is not a
 * documentation gap — it is an operation anybody signed in can call, including
 * sending as the platform. This suite turns that into a red build.
 */

/** Read out of the resolver's SOURCE, as chat's and the queue's suites do. */
function publishedOperations(): string[] {
  const source = readFileSync(join(__dirname, '..', 'src', 'server', 'graphql', 'notification.resolver.ts'), 'utf8');
  return [...source.matchAll(/@(Query|Mutation|Subscription)\([\s\S]*?name:\s*'([^']+)'/g)].map(
    (match) => `${match[1]}.${match[2]}`,
  );
}

const OPERATIONS = publishedOperations();

const BOUND = new Map<string, string>();
for (const spec of NOTIFICATION_FEATURE_REGISTRY) {
  for (const binding of spec.bindings ?? []) BOUND.set(binding.identifier, spec.key);
}

describe('the resolver', () => {
  it('publishes operations — the reflection has to work for this suite to mean anything', () => {
    expect(OPERATIONS.length).toBeGreaterThan(10);
  });

  it('⚠ declares NO scope: the inbox belongs to the person, across every tenant', () => {
    expect(Reflect.getMetadata(REQUIRED_SCOPE_METADATA, NotificationResolver)).toBeUndefined();
  });

  it('marks nothing public', () => {
    const prototype = NotificationResolver.prototype as unknown as Record<string, object>;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === 'constructor' || typeof prototype[name] !== 'function') continue;
      expect([name, Reflect.getMetadata(PUBLIC_SURFACE_METADATA, prototype[name] as object)]).toEqual([
        name,
        undefined,
      ]);
    }
  });

  it.each(OPERATIONS)('%s is bound to a key', (identifier) => {
    expect(BOUND.get(identifier)).toBeDefined();
  });
});

describe('the bindings', () => {
  it('⚠ name no operation that is not published', () => {
    const published = new Set(OPERATIONS);
    expect([...BOUND.keys()].filter((identifier) => !published.has(identifier))).toEqual([]);
  });

  it('bind the subscription as a subscription surface', () => {
    const read = NOTIFICATION_FEATURE_REGISTRY.find((spec) => spec.key === NOTIFICATION_FEATURE.read);
    expect(read?.bindings).toContainEqual({
      surface: 'graphql_subscription',
      identifier: 'Subscription.notificationEvents',
    });
  });

  it.each([
    ['Query.notifications', NOTIFICATION_FEATURE.read],
    ['Mutation.markAllNotificationsRead', NOTIFICATION_FEATURE.read],
    ['Subscription.notificationEvents', NOTIFICATION_FEATURE.read],
    // ⚠ Sending as the platform, and finding people to send to, are privileged.
    ['Mutation.sendNotification', NOTIFICATION_FEATURE.send],
    ['Query.notificationRecipientSearch', NOTIFICATION_FEATURE.send],
    ['Query.notificationBatches', NOTIFICATION_FEATURE.send],
    ['Mutation.recallNotificationBatch', NOTIFICATION_FEATURE.manage],
  ])('%s → %s', (identifier, key) => {
    expect(BOUND.get(identifier)).toBe(key);
  });
});
