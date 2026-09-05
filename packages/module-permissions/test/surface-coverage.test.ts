import 'reflect-metadata';
import { FEATURE, FEATURE_REGISTRY } from '../src/feature-keys.js';
import { PermissionsResolver } from '../src/server/graphql/permissions.resolver.js';
import { PermissionsController } from '../src/server/permissions.controller.js';
import { REQUIRED_FEATURES } from '../src/server/require-feature.decorator.js';

/**
 * The registry's BINDINGS are claims about where a key is enforced. Nothing
 * checked them, so a binding could name a surface that had no guard — which is
 * exactly what happened: `features:read` claimed the GraphQL query while
 * `permissionFeatures` was unguarded, so the UI hid the page and the API handed
 * over the data anyway.
 *
 * These read the decorator metadata the guard reads, so a binding and its guard
 * cannot drift apart without failing here.
 */
const required = (target: object, method: string): string[] | undefined => {
  const handler = (target as Record<string, unknown>)[method];
  // Named explicitly: a renamed handler should fail with the name it was looking
  // for, not with a TypeError from inside reflect-metadata.
  if (typeof handler !== 'function') throw new Error(`No handler '${method}' on ${target.constructor.name}`);
  return Reflect.getMetadata(REQUIRED_FEATURES, handler);
};

describe('declared API surfaces are actually guarded', () => {
  it('Query.permissionFeatures requires features:read', () => {
    expect(required(PermissionsResolver.prototype, 'features')).toEqual([FEATURE.featuresRead]);
  });

  it('GET /permissions/features requires features:read', () => {
    expect(required(PermissionsController.prototype, 'features')).toEqual([FEATURE.featuresRead]);
  });

  /**
   * Deliberately unguarded: asking what you hold is not a privilege, and a
   * signed-in caller with no grants must still be able to learn that.
   */
  it('myPermissions stays unguarded', () => {
    expect(required(PermissionsResolver.prototype, 'mine')).toBeUndefined();
  });

  it('GET /permissions/me stays unguarded', () => {
    expect(required(PermissionsController.prototype, 'me')).toBeUndefined();
  });
});

describe('every declared API binding names a guard that exists', () => {
  /** The API surfaces this suite knows how to verify, and the guard behind each. */
  const GUARDED: Record<string, string[] | undefined> = {
    'Query.permissionFeatures': required(PermissionsResolver.prototype, 'features'),
    'GET /permissions/features': required(PermissionsController.prototype, 'features'),
  };

  const apiBindings = FEATURE_REGISTRY.flatMap((spec) =>
    (spec.bindings ?? [])
      .filter((b) => b.surface === 'rest_endpoint' || b.surface === 'graphql_operation')
      .map((b) => ({ key: spec.key, identifier: b.identifier })),
  );

  it('has at least one API binding to check', () => {
    expect(apiBindings.length).toBeGreaterThan(0);
  });

  it.each(apiBindings)('$identifier is guarded by $key', ({ key, identifier }) => {
    const guard = GUARDED[identifier];
    // An unknown identifier means a binding was declared for a surface this
    // suite cannot see — add it above rather than letting it pass silently.
    expect(guard).toBeDefined();
    expect(guard).toContain(key);
  });
});
