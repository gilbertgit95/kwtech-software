import type { FeatureContribution } from '@kwtech/module-kit';

/**
 * The rights this module contributes to the shared registry.
 *
 * ## Which surfaces get a key at all
 *
 * The rule this module follows is that a surface gets a feature key only when
 * it needs AUTHORISATION — not merely a session. Those are different questions,
 * and conflating them is how people get locked out of their own accounts:
 *
 *   no sign-in, no authorisation   /auth/signin, /auth/forgot-password,
 *                                  /auth/reset-password, /auth/verify.
 *                                  Reached BEFORE a session exists or in order
 *                                  to recover one. A key here is a right you
 *                                  need an account to hold and an account you
 *                                  cannot reach without it.
 *
 *   sign-in, no authorisation      /settings/profile, /settings/security,
 *                                  /settings/two-factor, and the endpoints
 *                                  behind them. Every signed-in person must
 *                                  reach these — withholding `account:security`
 *                                  would leave someone unable to change a
 *                                  password they believe is compromised, which
 *                                  is a lockout dressed as a permission.
 *                                  `JwtAuthGuard` already requires the session,
 *                                  and change-password requires the CURRENT
 *                                  password, which is a stronger check than any
 *                                  key.
 *
 *   sign-in AND authorisation      the `users:*` block below — acting on
 *                                  SOMEBODY ELSE'S account. This row was empty
 *                                  and described in advance what would fill it:
 *                                  "an administrator resetting another person's
 *                                  password, or ending their sessions". That is
 *                                  what arrived.
 *
 * ## Why user administration is in THIS module and not in permissions
 *
 * It reads and writes `auth_user`, `auth_session`, `auth_credential` and
 * `auth_mfa_factor` — this module's tables, and the most identity-shaped data
 * there is. PLAN §12.12 closed the general form of that question when auth
 * became its own module rather than part of permissions, and an admin CRUD over
 * these tables living there would reverse it quietly.
 *
 * "App-level admin right" does NOT mean "declared in module-permissions". A
 * module contributes its own grantable rights through `FeatureContribution`,
 * which comes from `module-kit` — the package both modules already depend on —
 * and the app composes the lists in `seed/registry.ts`. So permissions enforces
 * these keys without ever learning they exist: they arrive as data, and its role
 * editor offers them because they are in the registry, not because it knows what
 * a user is.
 *
 * The one part that CANNOT live here is a user's memberships and roles — that is
 * permissions data keyed by a userId. It composes in the app, on the seam
 * `apps/web-server/src/users/` already occupies.
 *
 * ## `account:*` — writes, never reads
 *
 * Those three keys govern CHANGING your own data, not seeing it. Every settings
 * route stays unkeyed, so the pages remain reachable and a withheld key costs
 * you a disabled control rather than a locked door. Denying the read would make
 * the app look broken; denying the write is the actual requirement.
 *
 * They exist so a genuinely restricted role — an account whose identity is
 * managed elsewhere, or a shared kiosk login — can be expressed. Nothing holds
 * them back today: every seeded role carries all three, so behaviour is
 * unchanged until someone deliberately withholds one.
 *
 * ## `users:*` — reads ARE keyed, and that is not an inconsistency
 *
 * The opposite rule applies one block down, because the data is somebody else's.
 * Withholding `account:profile_write` costs you a greyed-out button on your own
 * page; withholding `users:read` costs you a page you have no business seeing.
 * A key that hides your own settings is a lockout. A key that hides a list of
 * every account on the platform is the entire point.
 *
 * ## Why `users:*` splits into nine keys and not one `users:manage`
 *
 * The same reason `roles:*` and `plans:*` split, stated by those keys: read,
 * create, update and retire are different risks, and one key for all of them
 * means the platform cannot have somebody who reviews accounts without also
 * being able to empty one. Split now rather than later — a key is cheap to add
 * and expensive to split once roles have been granted from it, because splitting
 * one silently narrows what every existing holder can do.
 *
 * Two of them deserve naming together, because HOLDING BOTH IS ACCOUNT
 * TAKEOVER: `users:password_reset` and `users:two_factor_remove`. Either alone
 * is survivable — a reset cannot get past a second factor, and removing a factor
 * gets nobody past a password nobody knows. Together they are a complete path
 * into any account on the platform, with no trace in that account's own audit
 * beyond the two admin actions. They are two keys precisely so a role can carry
 * the recoverable half without the other, and both are `isPrivileged`.
 *
 * ## The password is deliberately NOT here
 *
 * Keying `change-password` would be either leaky or dangerous, and there is no
 * third option yet. Leaky, because `/auth/forgot-password` is unkeyed and
 * always reachable — blocking the settings page stops nothing, and a control
 * that looks enforced and is not is worse than none. Dangerous, because closing
 * that hole too would leave someone with a compromised password unable to fix
 * it, and there is no admin-side reset to fall back on. The key arrives with
 * that tooling, not before it.
 *
 * If the real intent is "these credentials are centrally managed", that belongs
 * on the ACCOUNT — an externally-managed-identity flag — not on a role: it
 * follows the account, not whichever role it happens to hold.
 */

export const AUTH_FEATURE = {
  /** Change your own display name and username. Email is already immutable. */
  accountProfileWrite: 'account:profile_write',
  /** Add a second factor to your own account. */
  accountTwoFactorEnrol: 'account:two_factor_enrol',
  /** Take one off again. */
  accountTwoFactorRemove: 'account:two_factor_remove',

  /*
   * ── users: administering SOMEBODY ELSE'S account ────────────────────────
   *
   * FOUR keys, shaped exactly like `roles:*` and `plans:*` in
   * @kwtech/module-permissions — read, create, update, and a reversible off
   * switch. Same split for the same reason those give: reviewing accounts and
   * changing one are different risks, and one `users:manage` would mean the
   * platform cannot have somebody who looks without also being able to act.
   *
   * All APP level. There is no organization-scoped version of any of them and
   * there should not be: an account belongs to a person, not to a tenant, and
   * the same address may be a member of several. An organization-level
   * `users:disable` would let one tenant's administrator cut a person off from
   * every OTHER tenant they belong to.
   *
   * ⚠ WHAT `users:update` CARRIES, and it is more than a rename. Sending a
   * password reset and removing a second factor are both under it, and holding
   * both is a complete path into any account on the platform — a reset alone
   * does not get past a factor, and removing a factor does not get past an
   * unknown password, but one key now grants both. That is a deliberate trade
   * of least-privilege for a vocabulary that matches the rest of the admin app;
   * splitting the credential operations back out is one key and a binding move
   * if the platform ever wants an auditor-plus-editor role that cannot take an
   * account over.
   */

  /**
   * List, search and open any account, and see where one is signed in.
   *
   * ⚠ This is deliberately the customer-list harvester that `findUserByEmail`
   * refuses to be. That query answers one question about one address at a time,
   * specifically so `members:manage` — held inside a tenant — cannot enumerate
   * the platform's users. This key IS the enumeration, granted on purpose, at
   * app level, to platform staff. The two are not in tension: they are the same
   * judgement about who may see the whole list, answered `no` for a tenant
   * administrator and `yes` for the back office.
   *
   * It also covers the session list — device, address, last use — which was
   * briefly its own key on privacy grounds. Folded in with the rest of reading:
   * `roles:read` shows everything about a role, and an administration surface
   * where "read" means "read some of it" is a vocabulary nobody can hold in
   * their head.
   */
  usersRead: 'users:read',

  /**
   * Create an account directly, without an invitation.
   *
   * Its own key because it is its own decision. PLAN §12 open decision 36 says
   * self-service registration must be a product choice rather than something
   * arrived at by leaving an endpoint exposed — `AuthService.createAccount` is
   * a method with no route for exactly that reason, reachable only through
   * `signUpFromInvitation`. This adds a SECOND way in, and it is defensible
   * where an open sign-up page is not: it is guarded, app level, privileged,
   * and every use of it has an administrator's name on it.
   */
  usersCreate: 'users:create',

  /**
   * Change an existing account: its name, its username, its credentials.
   *
   * Covers the rename, sending a password reset, ending every session, and
   * removing a second factor — everything that alters an account without
   * changing whether it may sign in at all, which is `users:disable`.
   *
   * ⚠ Read the block above on what holding this means. Two narrower operations
   * live under it deliberately:
   *
   *   the password reset      SENDS a reset, and there is no admin path that
   *                           sets a password directly. An administrator who
   *                           could type one would hold that person's
   *                           credential, and every "was that you or support?"
   *                           question afterwards would be unanswerable. The
   *                           link goes to the mailbox, which is the one place
   *                           the account's owner controls.
   *
   *   removing a factor       for somebody who lost their phone AND their
   *                           recovery codes, which is the ordinary case it
   *                           exists for — which is why it cannot simply be
   *                           withheld from everyone who may edit a profile.
   */
  usersUpdate: 'users:update',

  /**
   * Suspend an account so it cannot sign in, and lift the suspension again.
   *
   * The exact call `roles:disable` and `plans:archive` make, and there is
   * deliberately NO `users:delete` beside it. Every membership, invitation and
   * accepted-by record points at the account; deleting one either cascades that
   * history away — destroying the answer to "who accepted this invitation last
   * March" — or leaves rows pointing at nobody, which is what actually happens
   * here, because `perm_membership.userId` has no foreign key to `auth_user`
   * (PLAN §12.12).
   *
   * Suspension keeps the row, keeps the history, and is reversible by whoever
   * got it wrong. `AuthUserStatus` already had `active | suspended` with
   * nothing writing it.
   *
   * ONE key for both directions, like `roles:disable`: the act is reversible,
   * and whoever can stop access is the obvious person to restore it. Splitting
   * them would produce a role that can lock people out and not let them back
   * in.
   */
  usersDisable: 'users:disable',
} as const;

export type AuthFeatureKey = (typeof AUTH_FEATURE)[keyof typeof AUTH_FEATURE];

/**
 * All APP level, the only level that fits: they are about the person, not about
 * any organization, so they must apply the same way everywhere. An
 * organization-level version would mean your own profile behaved differently
 * depending on which tenant you were looking at — and, for the `users:*` half,
 * would let one tenant's administrator reach an account that belongs to several.
 *
 * Every `users:*` entry names the operations it guards, added in the commit
 * that added `@RequireAuthFeature` to them — the registry's own rule, because a
 * binding naming a surface nobody wrote reads as coverage in the role editor
 * while guarding nothing.
 *
 * The GraphQL operations live in `server/graphql/users-admin.resolver.ts`, in
 * THIS module, which is new: `findUserByEmail` and `findUsersByIds` are bound
 * to a permissions key and hosted by the app, because they are joint work. User
 * administration is not joint work — it is this module's tables, guarded by
 * this module's keys — so only the ENFORCEMENT is borrowed, through the
 * metadata contract in `@kwtech/module-kit`.
 *
 * They are tagged `['admin', 'auth']`, which reads outermost-first: the auth
 * area of the admin app. That is what puts them beside `roles:*` and `plans:*`
 * in the role editor's picker rather than beside the account settings keys —
 * the same screen, a different area.
 */
export const AUTH_FEATURE_REGISTRY: readonly FeatureContribution[] = [
  {
    key: AUTH_FEATURE.accountProfileWrite,
    module: 'auth',
    tags: ['auth'],
    level: 'app',
    label: 'Edit your own profile',
    description: 'Change your own display name and username. Your email address cannot be changed here.',
    bindings: [
      { surface: 'graphql_operation', identifier: 'Mutation.updateProfile' },
      { surface: 'ui_component', identifier: 'ProfilePage.SaveButton' },
    ],
  },
  {
    key: AUTH_FEATURE.accountTwoFactorEnrol,
    module: 'auth',
    tags: ['auth'],
    level: 'app',
    label: 'Add two-step verification',
    /*
     * Separate from removal, and this is the direction that matters: a policy
     * wanting 2FA mandatory withholds REMOVAL. Withholding enrolment would stop
     * someone protecting their own account, which weakens security rather than
     * enforcing it — so the two are never one key.
     */
    description: 'Enrol a second factor on your own account.',
    bindings: [
      { surface: 'rest_endpoint', identifier: 'POST /auth/mfa/enrol' },
      { surface: 'rest_endpoint', identifier: 'POST /auth/mfa/confirm' },
      { surface: 'ui_component', identifier: 'TwoFactorPage.EnrolButton' },
    ],
  },
  {
    key: AUTH_FEATURE.accountTwoFactorRemove,
    module: 'auth',
    tags: ['auth'],
    level: 'app',
    label: 'Remove two-step verification',
    description: 'Take a second factor off your own account.',
    isPrivileged: true,
    bindings: [
      { surface: 'rest_endpoint', identifier: 'DELETE /auth/mfa/factors' },
      { surface: 'ui_component', identifier: 'TwoFactorPage.RemoveButton' },
    ],
  },
  {
    key: AUTH_FEATURE.usersRead,
    module: 'auth',
    tags: ['admin', 'auth'],
    level: 'app',
    label: 'Read users',
    description: 'List, search and open any account on the platform, and see where one is signed in.',
    // Privileged despite being a read: it is the whole customer list. See the key.
    isPrivileged: true,
    bindings: [
      { surface: 'graphql_operation', identifier: 'Query.adminUsers' },
      { surface: 'graphql_operation', identifier: 'Query.adminUser' },
      { surface: 'graphql_operation', identifier: 'Query.adminUserSessions' },
      { surface: 'ui_route', identifier: '/admin/users' },
      { surface: 'ui_route', identifier: '/admin/users/:userId' },
    ],
  },
  {
    key: AUTH_FEATURE.usersCreate,
    module: 'auth',
    tags: ['admin', 'auth'],
    level: 'app',
    label: 'Create users',
    description: 'Create an account directly, without an invitation.',
    isPrivileged: true,
    bindings: [
      { surface: 'graphql_operation', identifier: 'Mutation.adminCreateUser' },
      { surface: 'ui_route', identifier: '/admin/users/new' },
    ],
  },
  {
    key: AUTH_FEATURE.usersUpdate,
    module: 'auth',
    tags: ['admin', 'auth'],
    level: 'app',
    label: 'Update users',
    description:
      "Change an account's name and username, send it a password reset, end its sessions, or remove its second factor.",
    isPrivileged: true,
    bindings: [
      { surface: 'graphql_operation', identifier: 'Mutation.adminUpdateUserProfile' },
      { surface: 'graphql_operation', identifier: 'Mutation.adminSendPasswordReset' },
      { surface: 'graphql_operation', identifier: 'Mutation.adminRevokeUserSessions' },
      { surface: 'graphql_operation', identifier: 'Mutation.adminRemoveUserTwoFactor' },
      { surface: 'ui_route', identifier: '/admin/users/:userId/edit' },
    ],
  },
  {
    key: AUTH_FEATURE.usersDisable,
    module: 'auth',
    tags: ['admin', 'auth'],
    level: 'app',
    label: 'Disable users',
    description: 'Suspend an account so it cannot sign in, and lift the suspension again. Accounts are never deleted.',
    isPrivileged: true,
    bindings: [{ surface: 'graphql_operation', identifier: 'Mutation.adminSetUserStatus' }],
  },
];
