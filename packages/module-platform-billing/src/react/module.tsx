import type { ModuleRouteProps, WebModuleDescriptor } from '@kwtech/module-kit';
import { PLATFORM_BILLING_FEATURE, PLATFORM_BILLING_FEATURE_REGISTRY } from '../feature-keys.js';
import { BillingDocumentPage } from './pages/billing-document-page.js';
import { BillingPage } from './pages/billing-page.js';
import { BillingStatementPage } from './pages/billing-statement-page.js';
import { BILLING_DOCUMENT_ROUTE, BILLING_PAGE_ROUTE, BILLING_STATEMENT_ROUTE } from './routes.js';

/**
 * The organization drawer's group, by its name: declared by
 * `module-permissions` (`ORGANIZATION_NAV_GROUP`), restated here because a
 * module never imports another (PLAN §9). A name that drifted would put the
 * page in a group of its own at the bottom of the drawer, not lose it.
 */
const ORGANIZATION_NAV_GROUP = 'Organization';

/** A thin adapter: the route's params to the page's props. */
function BillingRoute({ params }: ModuleRouteProps) {
  return <BillingPage organizationId={params?.organizationId} />;
}

/** One query-string value, or undefined (a repeated one counts as absent). */
function one(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A printable bill or receipt: the request from the path, which document from the query. */
function BillingDocumentRoute({ params, searchParams }: ModuleRouteProps) {
  return (
    <BillingDocumentPage
      organizationId={params?.organizationId}
      requestId={params?.requestId}
      kind={one(searchParams?.kind)}
      number={one(searchParams?.number)}
    />
  );
}

/** The statement of account: its range from the query. */
function BillingStatementRoute({ params, searchParams }: ModuleRouteProps) {
  return (
    <BillingStatementPage
      organizationId={params?.organizationId}
      from={one(searchParams?.from)}
      to={one(searchParams?.to)}
    />
  );
}

/**
 * Billing's web half (phase 6): the organization's Billing page. Not a
 * sub-app (plan §3): a drawer page under the organization, never on a
 * workspace's Apps page.
 *
 * ⚠ It replaces `module-permissions`' read-only
 * `/organizations/:organizationId/subscription`: the app hands permissions
 * this page as its `planPage` (apps/web-app/src/modules.ts).
 */
export const platformBillingWebModule: WebModuleDescriptor = {
  key: 'platform-billing',
  features: PLATFORM_BILLING_FEATURE_REGISTRY,
  routes: [
    {
      path: BILLING_PAGE_ROUTE,
      component: BillingRoute,
      title: 'Billing',
      // ⚠ Exempt from the plan filter (D13): an expired organization still reaches the page that renews it.
      feature: PLATFORM_BILLING_FEATURE.read,
      nav: { group: ORGANIZATION_NAV_GROUP, order: 50, icon: 'billing' },
    },
    /*
     * The printable pages (phase 6b): out of the drawer and out of the app's
     * frame ('fullscreen'), so the browser prints the document alone. Behind
     * the same key as the Billing page they are opened from.
     */
    {
      path: BILLING_DOCUMENT_ROUTE,
      component: BillingDocumentRoute,
      title: 'Billing document',
      feature: PLATFORM_BILLING_FEATURE.read,
      chrome: 'fullscreen',
    },
    {
      path: BILLING_STATEMENT_ROUTE,
      component: BillingStatementRoute,
      title: 'Statement of account',
      feature: PLATFORM_BILLING_FEATURE.read,
      chrome: 'fullscreen',
    },
  ],
};
