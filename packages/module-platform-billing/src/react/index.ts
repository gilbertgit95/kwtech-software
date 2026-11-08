/**
 * `@kwtech/module-platform-billing/react` — the web half: the organization's
 * Billing page (phase 6).
 *
 * A SEPARATE entry point from '.', which stays framework-free. `react`,
 * `@kwtech/web-ui` and `lucide-react` are optional peers for that reason; it
 * never imports `/server`.
 *
 * ⚠ NAMED exports, never `export *`: part of this barrel is `'use client'`, and
 * a client module does not answer the enumeration `export *` compiles to.
 */

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
export { BillingDocumentPage, type BillingDocumentPageProps } from './pages/billing-document-page.js';
export { BillingPage, type BillingPageProps } from './pages/billing-page.js';
export { BillingStatementPage, type BillingStatementPageProps } from './pages/billing-statement-page.js';
export {
  BILLING_DOCUMENT_ROUTE,
  BILLING_PAGE_ROUTE,
  BILLING_STATEMENT_ROUTE,
  billingDocumentHref,
  billingPageHref,
  billingStatementHref,
} from './routes.js';
