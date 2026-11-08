/**
 * WHERE BILLING'S PAGES LIVE, in one place (frontend rules: paths and href
 * builders in `routes.ts`, every segment encoded).
 *
 * Not a sub-app (plan §3): a drawer page under the organization, never on a
 * workspace's Apps page.
 */

/** The organization's Billing page (phase 6), as a route pattern. */
export const BILLING_PAGE_ROUTE = '/organizations/:organizationId/billing';

/** The Billing page of `organizationId`. */
export function billingPageHref(organizationId: string): string {
  return `/organizations/${encodeURIComponent(organizationId)}/billing`;
}
