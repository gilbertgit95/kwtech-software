import 'reflect-metadata';
import { REQUIRED_FEATURES } from '@kwtech/module-kit';
import { AUTH_FEATURE, AUTH_FEATURE_REGISTRY } from '../src/features.js';
import { UsersAdminResolver } from '../src/server/graphql/users-admin.resolver.js';

/**
 * The registry's BINDINGS are claims about where a key is enforced, and nothing
 * but a test can keep them true. `module-permissions` learned this the hard
 * way — `features:read` claimed a GraphQL query that was unguarded, so the UI
 * hid a page while the API served its data — and this is the same check for
 * this module's half of the registry.
 *
 * It reads the metadata the GUARD reads, through the constant in
 * `@kwtech/module-kit` rather than through either module's decorator. That is
 * the whole point of the key living there: if the two decorators ever disagreed
 * about the string, this test would fail rather than the guard silently
 * finding nothing to enforce.
 */

const OPERATION_HANDLER: Record<string, string> = {
  'Query.adminUsers': 'adminUsers',
  'Query.adminUser': 'adminUser',
  'Query.adminUserSessions': 'adminUserSessions',
  'Mutation.adminUpdateUserProfile': 'adminUpdateUserProfile',
  'Mutation.adminSetUserStatus': 'adminSetUserStatus',
  'Mutation.adminSendPasswordReset': 'adminSendPasswordReset',
  'Mutation.adminRevokeUserSessions': 'adminRevokeUserSessions',
  'Mutation.adminRemoveUserTwoFactor': 'adminRemoveUserTwoFactor',
};

function required(method: string): string[] | undefined {
  const handler = (UsersAdminResolver.prototype as unknown as Record<string, unknown>)[method];
  // Named explicitly: a renamed handler should fail with the name it was looking
  // for, not with a TypeError from inside reflect-metadata.
  if (typeof handler !== 'function') throw new Error(`No handler '${method}' on UsersAdminResolver`);
  return Reflect.getMetadata(REQUIRED_FEATURES, handler);
}

/** Every `graphql_operation` this module's registry claims to guard. */
const declared = AUTH_FEATURE_REGISTRY.flatMap((spec) =>
  (spec.bindings ?? [])
    .filter((binding) => binding.surface === 'graphql_operation')
    .map((binding) => ({ key: spec.key, identifier: binding.identifier })),
);

describe('declared API surfaces are actually guarded', () => {
  it('has bindings to check', () => {
    expect(declared.length).toBeGreaterThan(0);
  });

  it.each(declared)('$identifier is guarded by $key', ({ key, identifier }) => {
    const handler = OPERATION_HANDLER[identifier];
    /*
     * An unknown identifier means a binding names an operation this suite
     * cannot see — the account:* keys bind `Mutation.updateProfile`, which lives
     * on AuthResolver and is deliberately NOT covered here: those are rights
     * over your own account, and they are enforced on a resolver this file does
     * not import. Add the operation above rather than letting it pass silently.
     */
    if (!handler) {
      expect(identifier).toMatch(/^Mutation\.updateProfile$/);
      return;
    }
    expect(required(handler)).toContain(key);
  });

  it('never declares more than one key on a handler', () => {
    /*
     * The four keys exist so a role can hold one without the others. A handler
     * demanding two would collapse that for whoever holds only one — and the
     * default mode is 'all', so it would refuse them silently.
     */
    for (const method of Object.values(OPERATION_HANDLER)) {
      expect(required(method)).toHaveLength(1);
    }
  });

  it('puts the credential operations under users:update, together', () => {
    /*
     * ⚠ The trade this vocabulary makes, asserted so it is visible rather than
     * implied. A reset does not get past a second factor and removing a factor
     * does not get past an unknown password — but ONE key now grants both, so
     * `users:update` is a path into any account. features.ts says so at length;
     * this is the test that will fail the day somebody splits them again, which
     * is the day to update it deliberately.
     */
    expect(required('adminSendPasswordReset')).toEqual([AUTH_FEATURE.usersUpdate]);
    expect(required('adminRemoveUserTwoFactor')).toEqual([AUTH_FEATURE.usersUpdate]);
    expect(required('adminUpdateUserProfile')).toEqual([AUTH_FEATURE.usersUpdate]);
  });

  it('suspension is its own key, not part of update', () => {
    // The `roles:disable` split: changing an account and stopping it signing in
    // are different acts, and the reversible off switch is the sharper one.
    expect(required('adminSetUserStatus')).toEqual([AUTH_FEATURE.usersDisable]);
  });

  it('reading covers the list, the account and its sessions', () => {
    expect(required('adminUsers')).toEqual([AUTH_FEATURE.usersRead]);
    expect(required('adminUser')).toEqual([AUTH_FEATURE.usersRead]);
    expect(required('adminUserSessions')).toEqual([AUTH_FEATURE.usersRead]);
  });

  it('declares neither a delete nor a create', () => {
    /*
     * Accounts are suspended, never removed — and never created here either:
     * one comes into being when somebody accepts an invitation and chooses
     * their own password, which is module-permissions' `inviteUser`.
     */
    expect(Object.keys(OPERATION_HANDLER)).not.toContain('Mutation.adminDeleteUser');
    expect(Object.keys(OPERATION_HANDLER)).not.toContain('Mutation.adminCreateUser');
    const keys = declared.map((binding) => binding.key);
    expect(keys).not.toContain('users:delete');
    expect(keys).not.toContain('users:create');
  });
});
