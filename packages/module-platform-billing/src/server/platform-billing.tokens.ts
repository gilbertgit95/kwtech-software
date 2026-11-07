/**
 * Injection tokens, in their own file so nothing has to import a Nest module to
 * name one. Strings rather than symbols, matching every module here.
 */

/** The READ client. Host-injected; this module opens no connection. */
export const PLATFORM_BILLING_PRISMA = 'kwtech:platform-billing-prisma';

/**
 * The WRITE client, which must expose `$transaction`. ⚠ Its transaction must be
 * one the app can also hand to `module-permissions` (`PLATFORM_BILLING_SUBSCRIPTIONS`):
 * an approval writes the subscription and the receipt together or not at all.
 */
export const PLATFORM_BILLING_PRISMA_WRITE = 'kwtech:platform-billing-prisma-write';

export const PLATFORM_BILLING_OPTIONS = 'kwtech:platform-billing-options';

/**
 * A `PlatformBillingSubscriptions`: the organization's live subscription, and
 * permissions' write methods inside billing's transaction. ⚠ REQUIRED: unbound,
 * the module refuses to boot, because billing that cannot apply a plan would
 * take payments and give nothing for them.
 */
export const PLATFORM_BILLING_SUBSCRIPTIONS = 'kwtech:platform-billing-subscriptions';

/**
 * A `PlatformBillingPlans`: the plans, and how much of each cap an
 * organization uses. ⚠ REQUIRED, for the same reason.
 */
export const PLATFORM_BILLING_PLANS = 'kwtech:platform-billing-plans';

/**
 * A `PlatformBillingPeople`. Unbound means every approver is FLAGGED as a
 * member of the organization (D15): the flag never blocks, and saying "maybe a
 * member" is the side that errs towards a second look.
 */
export const PLATFORM_BILLING_PEOPLE = 'kwtech:platform-billing-people';
