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
  /**
   * Unguarded ON PURPOSE, like `myPermissions` below: the person accepting an
   * invitation holds nothing in the organization — that is what an invitation
   * is — so requiring a feature of them would mean only administrators could
   * accept. The token authorises; the session says who joins.
   */
  it('acceptInvitation stays unguarded, because the token is the authorisation', () => {
    expect(required(PermissionsResolver.prototype, 'acceptInvitation')).toBeUndefined();
  });

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
    'Query.permissionRoles': required(PermissionsResolver.prototype, 'roles'),
    'Mutation.createRole': required(PermissionsResolver.prototype, 'createRole'),
    'Mutation.updateRole': required(PermissionsResolver.prototype, 'updateRole'),
    'Mutation.setRoleDisabled': required(PermissionsResolver.prototype, 'setRoleDisabled'),
    'Mutation.previewRoleClone': required(PermissionsResolver.prototype, 'previewRoleClone'),
    'Query.permissionPlans': required(PermissionsResolver.prototype, 'plans'),
    'Subscription.planChanged': required(PermissionsResolver.prototype, 'planChanged'),
    'Mutation.createPlan': required(PermissionsResolver.prototype, 'createPlan'),
    'Mutation.updatePlan': required(PermissionsResolver.prototype, 'updatePlan'),
    'Mutation.setPlanArchived': required(PermissionsResolver.prototype, 'setPlanArchived'),
    'Mutation.previewPlanClone': required(PermissionsResolver.prototype, 'previewPlanClone'),
    'Query.permissionSubscriptions': required(PermissionsResolver.prototype, 'subscriptions'),
    'Query.permissionOrganizations': required(PermissionsResolver.prototype, 'organizations'),
    'Mutation.createSubscription': required(PermissionsResolver.prototype, 'createSubscription'),
    'Mutation.updateSubscription': required(PermissionsResolver.prototype, 'updateSubscription'),
    'Mutation.endSubscription': required(PermissionsResolver.prototype, 'endSubscription'),
    'Query.permissionOrganizationDetail': required(PermissionsResolver.prototype, 'organizationDetail'),
    'Mutation.updateOrganization': required(PermissionsResolver.prototype, 'updateOrganization'),
    'Mutation.addMember': required(PermissionsResolver.prototype, 'addMember'),
    'Mutation.removeMember': required(PermissionsResolver.prototype, 'removeMember'),
    'Mutation.assignRole': required(PermissionsResolver.prototype, 'assignRole'),
    'Mutation.assignAppRole': required(PermissionsResolver.prototype, 'assignAppRole'),
    'Query.permissionUserAppRoles': required(PermissionsResolver.prototype, 'userAppRoles'),
    'Query.permissionUserOrganizations': required(PermissionsResolver.prototype, 'userOrganizations'),
    'Mutation.revokeRole': required(PermissionsResolver.prototype, 'revokeRole'),
    'Mutation.createWorkspace': required(PermissionsResolver.prototype, 'createWorkspace'),
    'Mutation.updateWorkspace': required(PermissionsResolver.prototype, 'updateWorkspace'),
    'Mutation.archiveWorkspace': required(PermissionsResolver.prototype, 'archiveWorkspace'),
    'Mutation.shareWorkspace': required(PermissionsResolver.prototype, 'shareWorkspace'),
    'Mutation.unshareWorkspace': required(PermissionsResolver.prototype, 'unshareWorkspace'),
    'Mutation.assignWorkspaceRole': required(PermissionsResolver.prototype, 'assignWorkspaceRole'),
    'Mutation.revokeWorkspaceRole': required(PermissionsResolver.prototype, 'revokeWorkspaceRole'),
    /*
     * Guarded in the APP, not in this module: it queries `auth_user` and is
     * bound to a permissions key, and neither module may import the other. The
     * app's own suite asserts the guard; this entry records that the binding is
     * deliberate rather than unverified.
     */
    'Query.findUserByEmail': [FEATURE.membersManage],
    'Query.findUsersByIds': [FEATURE.membersManage],
    'Mutation.inviteMember': required(PermissionsResolver.prototype, 'inviteMember'),
    'Mutation.inviteUser': required(PermissionsResolver.prototype, 'inviteUser'),
    'Mutation.revokeInvitation': required(PermissionsResolver.prototype, 'revokeInvitation'),
  };

  const apiBindings = FEATURE_REGISTRY.flatMap((spec) =>
    (spec.bindings ?? [])
      .filter(
        (b) =>
          b.surface === 'rest_endpoint' ||
          b.surface === 'graphql_operation' ||
          // Enforced at the handshake rather than per request, which is exactly
          // why it is a separate surface — and exactly why it has to be checked
          // here too rather than assumed to inherit the query's guard.
          b.surface === 'graphql_subscription',
      )
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
