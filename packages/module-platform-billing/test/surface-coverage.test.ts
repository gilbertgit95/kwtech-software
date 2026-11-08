import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CREDENTIAL_SURFACE_METADATA, PUBLIC_SURFACE_METADATA, REQUIRED_SCOPE_METADATA } from '@kwtech/module-kit';
import { PLATFORM_BILLING_FEATURE, PLATFORM_BILLING_FEATURE_REGISTRY } from '../src/feature-keys.js';
import { PLATFORM_BILLING_OPERATIONS } from '../src/operations.js';
import { PlatformBillingResolver } from '../src/server/graphql/platform-billing.resolver.js';
import { PlatformBillingAdminResolver } from '../src/server/graphql/platform-billing-admin.resolver.js';

/**
 * ⚠ THERE IS NO `@RequireFeature` HERE, so a missing BINDING is not a
 * documentation gap but an unguarded operation — approving anybody's payment
 * for anybody signed in. This suite checks:
 *
 *   - the organization resolver declares ORGANIZATION scope (its keys are
 *     organization level) and the platform resolver declares NONE (app level);
 *   - every operation is bound, to a key of the resolver's level;
 *   - no binding names an operation that does not exist, and nothing is public;
 *   - the documents the client sends name exactly the published operations.
 */

function publishedOperations(file: string): string[] {
  const source = readFileSync(join(__dirname, '..', 'src', 'server', 'graphql', file), 'utf8');
  return [...source.matchAll(/@(Query|Mutation|Subscription)\([\s\S]*?name:\s*'([^']+)'/g)].map(
    (match) => `${match[1]}.${match[2]}`,
  );
}

const ORGANIZATION_OPERATIONS = publishedOperations('platform-billing.resolver.ts');
const ADMIN_OPERATIONS = publishedOperations('platform-billing-admin.resolver.ts');
const OPERATIONS = [...ORGANIZATION_OPERATIONS, ...ADMIN_OPERATIONS];

const BOUND = new Map<string, { key: string; level: string }>();
for (const spec of PLATFORM_BILLING_FEATURE_REGISTRY) {
  for (const binding of spec.bindings ?? [])
    BOUND.set(binding.identifier, { key: spec.key, level: String(spec.level) });
}

function handlers(target: { prototype: object }): Array<[string, object]> {
  const prototype = target.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor' && typeof prototype[name] === 'function')
    .map((name) => [name, prototype[name] as object]);
}

describe('the resolvers', () => {
  it('publish operations — the reflection has to work for this suite to mean anything', () => {
    expect(ORGANIZATION_OPERATIONS).toHaveLength(9);
    expect(ADMIN_OPERATIONS).toHaveLength(10);
  });

  it('⚠ the organization resolver declares ORGANIZATION scope on the class', () => {
    expect(Reflect.getMetadata(REQUIRED_SCOPE_METADATA, PlatformBillingResolver)).toEqual({ level: 'organization' });
  });

  it('⚠ the platform resolver declares NO scope: every key is app level', () => {
    expect(Reflect.getMetadata(REQUIRED_SCOPE_METADATA, PlatformBillingAdminResolver)).toBeUndefined();
  });

  it('mark nothing public, and nothing a credential surface', () => {
    for (const [name, handler] of [...handlers(PlatformBillingResolver), ...handlers(PlatformBillingAdminResolver)]) {
      expect([name, Reflect.getMetadata(PUBLIC_SURFACE_METADATA, handler)]).toEqual([name, undefined]);
      expect([name, Reflect.getMetadata(CREDENTIAL_SURFACE_METADATA, handler)]).toEqual([name, undefined]);
    }
  });

  it.each(ORGANIZATION_OPERATIONS)('⚠ %s is bound to an ORGANIZATION key', (identifier) => {
    expect(BOUND.get(identifier)?.level).toBe('organization');
  });

  it.each(ADMIN_OPERATIONS)('⚠ %s is bound to an APP key', (identifier) => {
    expect(BOUND.get(identifier)?.level).toBe('app');
  });
});

describe('the bindings', () => {
  it('⚠ name no operation that is not published', () => {
    expect([...BOUND.keys()].filter((identifier) => !OPERATIONS.includes(identifier))).toEqual([]);
  });

  it.each([
    // D8: choosing the plan is the owner's; renewing and paying are the admin's too.
    ['Mutation.requestPlatformBillingPlan', PLATFORM_BILLING_FEATURE.changePlan],
    ['Mutation.renewPlatformBilling', PLATFORM_BILLING_FEATURE.renew],
    ['Mutation.enterPlatformBillingPayment', PLATFORM_BILLING_FEATURE.enterPayment],
    ['Mutation.withdrawPlatformBillingRequest', PLATFORM_BILLING_FEATURE.enterPayment],
    ['Mutation.approvePlatformBillingRequest', PLATFORM_BILLING_FEATURE.approve],
    ['Mutation.rejectPlatformBillingRequest', PLATFORM_BILLING_FEATURE.approve],
    ['Mutation.setPlatformBillingSettings', PLATFORM_BILLING_FEATURE.manageSettings],
    ['Mutation.setPlatformBillingPrice', PLATFORM_BILLING_FEATURE.manageSettings],
  ])('%s → %s', (identifier, key) => {
    expect(BOUND.get(identifier)?.key).toBe(key);
  });

  it('bind every query to a read key', () => {
    for (const [identifier, { key }] of BOUND) {
      if (!identifier.startsWith('Query.')) continue;
      expect([
        identifier,
        [PLATFORM_BILLING_FEATURE.read, PLATFORM_BILLING_FEATURE.queueRead].includes(key as never),
      ]).toEqual([identifier, true]);
    }
  });
});

describe('the documents the client sends', () => {
  it('cover exactly the published operations', () => {
    const fields = Object.values(PLATFORM_BILLING_OPERATIONS).map((document) => {
      const match = /^\s*(query|mutation|subscription)\s+\w+[^{]*\{\s*(\w+)/.exec(document);
      const kind = { query: 'Query', mutation: 'Mutation', subscription: 'Subscription' }[match?.[1] ?? 'query'];
      return `${kind ?? 'Query'}.${match?.[2]}`;
    });
    expect(fields.sort()).toEqual([...OPERATIONS].sort());
  });
});
