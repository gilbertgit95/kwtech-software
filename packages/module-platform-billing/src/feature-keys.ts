import type { FeatureContribution } from '@kwtech/module-kit';

/**
 * What billing lets somebody do (PLATFORM-BILLING-PLAN §8).
 *
 * TWO LEVELS, never a workspace one: billing is about the whole application
 * and each organization, not a sub-app.
 *
 * - **Organization level** — the organization's own billing. Split by who may
 *   do it (D8): the owner chooses, changes and cancels the plan; an admin
 *   renews and adds payment details, so a lapse never waits on the owner.
 *   ⚠ These keys work WITHOUT a plan (D13): the app passes them to
 *   `module-permissions`' `planExemptFeatures` (#92), so an expired or new
 *   organization can always reach the page that renews it.
 * - **App level** — platform staff. Split by risk: seeing the queue and the
 *   reports, approving ("we were paid"), voiding a receipt, and editing the
 *   settings are four keys, so a role can read the reports without approving.
 *   ⚠ App level is what keeps an organization's owner from being granted
 *   approval and approving their own unpaid request: the registry refuses an
 *   app key in an organization role or a plan.
 *
 * ⚠ THE BINDINGS ARE THE GUARD. This module cannot use `@RequireFeature`, so
 * an operation missing here is reachable by anybody signed in;
 * `test/surface-coverage.test.ts` fails the build on one. `void` binds nothing
 * until the void arrives (phase 4b).
 */
export const PLATFORM_BILLING_FEATURE = {
  /** The organization's Billing page: status, bills, receipts, history. */
  read: 'platform-billing:read',
  /** Subscribe, change plan, replace an archived plan, cancel. The owner's (D8). */
  changePlan: 'platform-billing:change_plan',
  /** Renew the current plan for another month. */
  renew: 'platform-billing:renew',
  /** Add or correct the payment details of a pending request. */
  enterPayment: 'platform-billing:enter_payment',
  /** The platform's queue of requests, every organization's standing, and the reports. */
  queueRead: 'platform-billing:queue_read',
  /** Approve, reject, or close as credit: the judgement "we were paid". */
  approve: 'platform-billing:approve',
  /** Void a receipt, reversing what its approval did. */
  void: 'platform-billing:void',
  /** Payment accounts, issuer details, currency, time zone, grace days. */
  manageSettings: 'platform-billing:manage_settings',
} as const;

export type PlatformBillingFeatureKey = (typeof PLATFORM_BILLING_FEATURE)[keyof typeof PLATFORM_BILLING_FEATURE];

/** The organization-level keys: those that work without a plan (D13), passed to permissions' `planExemptFeatures`. */
export const PLATFORM_BILLING_ORGANIZATION_KEYS: readonly PlatformBillingFeatureKey[] = [
  PLATFORM_BILLING_FEATURE.read,
  PLATFORM_BILLING_FEATURE.changePlan,
  PLATFORM_BILLING_FEATURE.renew,
  PLATFORM_BILLING_FEATURE.enterPayment,
];

/**
 * Contributed to the app's composed registry (`seed/registry.ts`).
 * `test/feature-keys.test.ts` pins the levels and the privileged flags, and
 * `test/surface-coverage.test.ts` the bindings.
 */
export const PLATFORM_BILLING_FEATURE_REGISTRY: readonly FeatureContribution[] = [
  {
    key: PLATFORM_BILLING_FEATURE.read,
    module: 'platform-billing',
    level: 'organization',
    label: 'See billing',
    description: "See the organization's plan, what it owes, its bills, receipts and history.",
    bindings: [
      { surface: 'graphql_operation', identifier: 'Query.platformBillingOverview' },
      { surface: 'graphql_operation', identifier: 'Query.platformBillingPreview' },
      { surface: 'graphql_operation', identifier: 'Query.platformBillingHistory' },
      { surface: 'graphql_operation', identifier: 'Query.platformBillingRequest' },
    ],
    tags: ['platform-billing'],
  },
  {
    key: PLATFORM_BILLING_FEATURE.changePlan,
    module: 'platform-billing',
    level: 'organization',
    label: 'Choose the plan',
    description: "Subscribe, change the organization's plan, replace a plan no longer offered, or cancel.",
    bindings: [{ surface: 'graphql_operation', identifier: 'Mutation.requestPlatformBillingPlan' }],
    tags: ['platform-billing'],
  },
  {
    key: PLATFORM_BILLING_FEATURE.renew,
    module: 'platform-billing',
    level: 'organization',
    label: 'Renew the plan',
    description: 'Request the current plan for another month.',
    bindings: [{ surface: 'graphql_operation', identifier: 'Mutation.renewPlatformBilling' }],
    tags: ['platform-billing'],
  },
  {
    key: PLATFORM_BILLING_FEATURE.enterPayment,
    module: 'platform-billing',
    level: 'organization',
    label: 'Enter payment details',
    description: 'Add or correct how a pending request was paid: method, amount, date and reference.',
    bindings: [
      { surface: 'graphql_operation', identifier: 'Mutation.enterPlatformBillingPayment' },
      { surface: 'graphql_operation', identifier: 'Mutation.withdrawPlatformBillingRequest' },
    ],
    tags: ['platform-billing'],
  },
  {
    key: PLATFORM_BILLING_FEATURE.queueRead,
    module: 'platform-billing',
    level: 'app',
    label: 'See billing requests and reports',
    description: "See every organization's requests, standing and credit, and the platform's billing reports.",
    bindings: [
      { surface: 'graphql_operation', identifier: 'Query.platformBillingQueue' },
      { surface: 'graphql_operation', identifier: 'Query.platformBillingReview' },
      { surface: 'graphql_operation', identifier: 'Query.platformBillingSettings' },
      { surface: 'graphql_operation', identifier: 'Query.platformBillingPrices' },
    ],
    tags: ['platform-billing'],
  },
  {
    key: PLATFORM_BILLING_FEATURE.approve,
    module: 'platform-billing',
    // PRIVILEGED: approving says "we were paid" and gives an organization its plan.
    isPrivileged: true,
    level: 'app',
    label: 'Approve billing requests',
    description: 'Approve a request once its payment is confirmed, reject it with a reason, or close it as credit.',
    bindings: [
      { surface: 'graphql_operation', identifier: 'Mutation.approvePlatformBillingRequest' },
      { surface: 'graphql_operation', identifier: 'Mutation.rejectPlatformBillingRequest' },
    ],
    tags: ['platform-billing'],
  },
  {
    key: PLATFORM_BILLING_FEATURE.void,
    module: 'platform-billing',
    // PRIVILEGED: a void reverses a receipt, its credit and the period it paid for.
    isPrivileged: true,
    level: 'app',
    label: 'Void receipts',
    description: 'Void a receipt issued in error, with a reason, reversing what its approval did.',
    // Bound when the void arrives (phase 4b, #93): a key guarding nothing yet.
    bindings: [],
    tags: ['platform-billing'],
  },
  {
    key: PLATFORM_BILLING_FEATURE.manageSettings,
    module: 'platform-billing',
    // PRIVILEGED: the accounts customers pay into, and the grace every organization gets.
    isPrivileged: true,
    level: 'app',
    label: 'Manage billing settings',
    description:
      'Set where organizations pay, the issuer details on bills, the currency, the time zone and the grace days.',
    bindings: [
      { surface: 'graphql_operation', identifier: 'Mutation.setPlatformBillingSettings' },
      { surface: 'graphql_operation', identifier: 'Mutation.setPlatformBillingPrice' },
    ],
    tags: ['platform-billing'],
  },
];

/**
 * A role a host MAY create, exported as data and never seeded by this module.
 * The app's `seed/app-roles.ts` reads them.
 */
export interface PlatformBillingRolePreset {
  key: string;
  label: string;
  icon: string;
  level: 'app' | 'organization';
  features: readonly PlatformBillingFeatureKey[];
}

export const PLATFORM_BILLING_ROLE_PRESETS: readonly PlatformBillingRolePreset[] = [
  {
    // What `organization-owner` adds: every organization key (D8).
    key: 'platform-billing-owner',
    label: 'Billing owner',
    icon: 'credit-card',
    level: 'organization',
    features: PLATFORM_BILLING_ORGANIZATION_KEYS,
  },
  {
    // What `organization-admin` adds: renew and pay, never choose the plan (D8).
    key: 'platform-billing-admin',
    label: 'Billing admin',
    icon: 'credit-card',
    level: 'organization',
    features: [PLATFORM_BILLING_FEATURE.read, PLATFORM_BILLING_FEATURE.renew, PLATFORM_BILLING_FEATURE.enterPayment],
  },
  {
    /*
     * The platform's billing staff, so an approver need not be a super admin.
     * The queue, approving and voiding; never the settings, which stay with
     * super admins.
     */
    key: 'platform-billing-approver',
    label: 'Billing approver',
    icon: 'badge-check',
    level: 'app',
    features: [PLATFORM_BILLING_FEATURE.queueRead, PLATFORM_BILLING_FEATURE.approve, PLATFORM_BILLING_FEATURE.void],
  },
];
