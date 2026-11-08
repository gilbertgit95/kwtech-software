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

/** A printable bill or receipt of a request (phase 6b): its own page, without the app's frame. */
export const BILLING_DOCUMENT_ROUTE = '/organizations/:organizationId/billing/documents/:requestId';

/** The statement of account for a range of days, printable, with its CSV. */
export const BILLING_STATEMENT_ROUTE = '/organizations/:organizationId/billing/statement';

/** One document of a request, by kind and printed number (`B-000012`, `R-000003`). */
export function billingDocumentHref(
  organizationId: string,
  requestId: string,
  kind: 'bill' | 'receipt',
  number: string,
): string {
  const query = new URLSearchParams({ kind, number });
  return `${billingPageHref(organizationId)}/documents/${encodeURIComponent(requestId)}?${query.toString()}`;
}

/** The statement for the days `from` to `to`, both included. */
export function billingStatementHref(organizationId: string, from: string, to: string): string {
  const query = new URLSearchParams({ from, to });
  return `${billingPageHref(organizationId)}/statement?${query.toString()}`;
}
