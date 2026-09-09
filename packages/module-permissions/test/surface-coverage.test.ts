import 'reflect-metadata';
import { FEATURE, FEATURE_REGISTRY } from '../src/feature-keys.js';
import { PermissionsResolver } from '../src/server/graphql/permissions.resolver.js';
import { PermissionsController } from '../src/server/permissions.controller.js';
import { REQUIRED_FEATURES } from '../src/server/require-feature.decorator.js';
import { REQUIRED_SCOPE, type ScopeSpec } from '../src/server/require-scope.decorator.js';

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

  /**
   * Unguarded for the same reason, and the reason is worth stating: a key here
   * would be a key you need before you can be given any key. Somebody holding
   * nothing anywhere must still be able to see which organizations they are in,
   * or they can never reach the one place a role could be granted to them.
   *
   * It discloses nothing either way — the subject is the caller, taken from the
   * session rather than from an argument.
   */
  it('myOrganizations stays unguarded', () => {
    expect(required(PermissionsResolver.prototype, 'myOrganizations')).toBeUndefined();
  });

  /**
   * Also unguarded, and the reason is sharper than for `myOrganizations`: the
   * list IS the caller's own `accessibleWorkspaceIds` resolved into names, so
   * it cannot disclose a workspace they may not enter.
   *
   * ⚠ It must NOT take `organization:read`. Being a member of a workspace does
   * not imply the right to open the organization's screens, so that key would
   * hide a workspace from somebody who is in it.
   */
  it('myWorkspaces stays unguarded', () => {
    expect(required(PermissionsResolver.prototype, 'myWorkspaces')).toBeUndefined();
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
    'Query.findUserByEmail': [FEATURE.membersRead],
    'Query.findUsersByIds': [FEATURE.membersRead],
    'Mutation.inviteMember': required(PermissionsResolver.prototype, 'inviteMember'),
    'Mutation.inviteUser': required(PermissionsResolver.prototype, 'inviteUser'),
    'Mutation.revokeInvitation': required(PermissionsResolver.prototype, 'revokeInvitation'),
    // ── the tenant's own organization ────────────────────────────────────────
    'Query.myOrganization': required(PermissionsResolver.prototype, 'myOrganization'),
    'Query.myWorkspace': required(PermissionsResolver.prototype, 'myWorkspace'),
    'Query.myOrganizationRoles': required(PermissionsResolver.prototype, 'myOrganizationRoles'),
    'Query.myOrganizationSubscriptions': required(PermissionsResolver.prototype, 'myOrganizationSubscriptions'),
    'Mutation.renameMyOrganization': required(PermissionsResolver.prototype, 'renameMyOrganization'),
    'Mutation.leaveOrganization': required(PermissionsResolver.prototype, 'leaveOrganization'),
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

/**
 * A resolver has NO PATH. One GraphQL endpoint serves every operation, so the
 * guard's fallback reads `/api/v1/graphql` and resolves APP level with no
 * organization — whatever the arguments say. An operation that acts inside a
 * tenant and does not declare its scope therefore loads the caller's context
 * with no tenant in it, and every ORGANIZATION-LEVEL key silently grants
 * nothing: only app-level roles work it.
 *
 * That failure is invisible from the outside. The request is refused with a
 * perfectly ordinary "requires members:manage" for somebody who holds
 * `members:manage`, which reads as a permissions bug in the role rather than a
 * missing decorator on the resolver. It is exactly what PLAN §12.13 deferred,
 * and these tests are what stop the next tenant-level operation reintroducing
 * it.
 */
const scopeOf = (method: string): ScopeSpec | undefined => {
  const handler = (PermissionsResolver.prototype as unknown as Record<string, unknown>)[method];
  if (typeof handler !== 'function') throw new Error(`No handler '${method}' on PermissionsResolver`);
  return Reflect.getMetadata(REQUIRED_SCOPE, handler);
};

describe('operations that act inside a tenant declare the level they act at', () => {
  const ORGANIZATION = [
    'inviteMember',
    'revokeInvitation',
    'addMember',
    'removeMember',
    'assignRole',
    'revokeRole',
    /*
     * These three take a workspaceId and are ORGANIZATION scope, deliberately.
     * `workspaces:manage` is the right to manage a tenant's workspaces, and
     * renaming or archiving one is not entering it — §12.33 requires membership
     * to ENTER a workspace, which these do not do.
     */
    'createWorkspace',
    'updateWorkspace',
    'archiveWorkspace',
    'myOrganization',
    'myOrganizationRoles',
    'myOrganizationSubscriptions',
    'renameMyOrganization',
    'leaveOrganization',
  ];

  /**
   * WORKSPACE scope does more than resolve grants in the right place: it makes
   * the guard ask `canAccessWorkspace` BEFORE the feature question, which is
   * §12.33 enforced rather than described. Nothing in this codebase resolved a
   * workspace-level request until these declarations existed.
   */
  const WORKSPACE = ['shareWorkspace', 'unshareWorkspace', 'assignWorkspaceRole', 'revokeWorkspaceRole', 'myWorkspace'];

  it.each(ORGANIZATION)('%s declares organization scope', (method) => {
    expect(scopeOf(method)?.level).toBe('organization');
  });

  it.each(WORKSPACE)('%s declares workspace scope', (method) => {
    expect(scopeOf(method)?.level).toBe('workspace');
  });

  /**
   * The platform reads stay UNDECLARED, and that is not an oversight.
   *
   * `permissionOrganizations`, `permissionSubscriptions` and
   * `permissionOrganizationDetail` answer across tenants for app-level keys. A
   * declared scope would resolve the caller inside one organization, and
   * `permissionSubscriptions` in particular takes an OPTIONAL organizationId —
   * declaring a level it cannot always reach would refuse the admin list for
   * disagreeing with its own declaration.
   */
  /*
   * `myWorkspaces` is here too. It takes an organizationId and still declares
   * no scope, which looks inconsistent and is not: `@RequireScope` exists to
   * tell the GUARD where to resolve, and no guard runs on an unguarded query.
   * It resolves its own actor at that organization instead — see the resolver.
   */
  it.each([
    'organizations',
    'subscriptions',
    'organizationDetail',
    'roles',
    'features',
    'mine',
    'myOrganizations',
    'myWorkspaces',
  ])('%s declares no scope, because it does not act inside one tenant', (method) => {
    expect(scopeOf(method)).toBeUndefined();
  });
});
