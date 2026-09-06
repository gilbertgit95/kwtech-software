import type { FeatureContribution } from '@kwtech/module-kit';

/**
 * The rights this module contributes to the shared registry: NONE, today.
 *
 * ## Why it is empty rather than absent
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
 *   sign-in AND authorisation      nothing in this module yet. It arrives with
 *                                  the first surface acting on SOMEBODY ELSE'S
 *                                  account — an administrator resetting another
 *                                  person's password, or ending their sessions.
 *                                  That is a right worth granting and worth
 *                                  withholding, and it goes here.
 *
 * ## What IS declared: writes, never reads
 *
 * The keys below govern CHANGING your own data, not seeing it. Every settings
 * route stays unkeyed, so the pages remain reachable and a withheld key costs
 * you a disabled control rather than a locked door. Denying the read would make
 * the app look broken; denying the write is the actual requirement.
 *
 * They exist so a genuinely restricted role — an account whose identity is
 * managed elsewhere, or a shared kiosk login — can be expressed. Nothing holds
 * them back today: every seeded role carries all three, so behaviour is
 * unchanged until someone deliberately withholds one.
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
} as const;

export type AuthFeatureKey = (typeof AUTH_FEATURE)[keyof typeof AUTH_FEATURE];

/**
 * All APP level, the only level that fits: they are about the person, not about
 * any organization, so they must apply the same way everywhere. An
 * organization-level version would mean your own profile behaved differently
 * depending on which tenant you were looking at.
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
];
