/**
 * `@kwtech/module-platform-billing/react` — the web half: the organization's
 * Billing page (phase 6) and the platform's billing pages (phase 7).
 *
 * A SEPARATE entry point from '.', which stays framework-free. `react`,
 * `@kwtech/web-ui` and `lucide-react` are optional peers for that reason; it
 * never imports `/server`.
 *
 * ⚠ NAMED exports, never `export *`: part of this barrel is `'use client'`, and
 * a client module does not answer the enumeration `export *` compiles to.
 */

export type {
  BillingAdminClient,
  BillingQueueItemView,
  BillingSettingsView,
} from './billing-admin-client.js';
export { createBillingAdminClient } from './billing-admin-client.js';
export type {
  BillingClient,
  BillingHistoryPageView,
  BillingOverviewView,
  BillingPreviewView,
  BillingRequestView,
  BillingStandingView,
} from './billing-client.js';
export { createBillingClient } from './billing-client.js';
export { platformBillingWebModule } from './module.js';
export { AdminDocumentPage, type AdminDocumentPageProps } from './pages/admin-document-page.js';
export { AdminQueuePage, type AdminQueuePageProps } from './pages/admin-queue-page.js';
export { AdminRequestPage, type AdminRequestPageProps } from './pages/admin-request-page.js';
export { AdminSettingsPage, type AdminSettingsPageProps } from './pages/admin-settings-page.js';
export { BillingDocumentPage, type BillingDocumentPageProps } from './pages/billing-document-page.js';
export { BillingPage, type BillingPageProps } from './pages/billing-page.js';
export { BillingStatementPage, type BillingStatementPageProps } from './pages/billing-statement-page.js';
export {
  BILLING_ADMIN_DOCUMENT_ROUTE,
  BILLING_ADMIN_REQUEST_ROUTE,
  BILLING_ADMIN_ROUTE,
  BILLING_ADMIN_SETTINGS_ROUTE,
  BILLING_DOCUMENT_ROUTE,
  BILLING_PAGE_ROUTE,
  BILLING_STATEMENT_ROUTE,
  billingAdminDocumentHref,
  billingAdminRequestHref,
  billingDocumentHref,
  billingPageHref,
  billingStatementHref,
} from './routes.js';
