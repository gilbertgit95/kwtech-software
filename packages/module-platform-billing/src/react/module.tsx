import type { ModuleRouteProps, WebModuleDescriptor } from '@kwtech/module-kit';
import { PLATFORM_BILLING_FEATURE, PLATFORM_BILLING_FEATURE_REGISTRY } from '../feature-keys.js';
import { AdminDocumentPage } from './pages/admin-document-page.js';
import { AdminOrganizationsPage } from './pages/admin-organizations-page.js';
import { AdminQueuePage } from './pages/admin-queue-page.js';
import { AdminReportsPage } from './pages/admin-reports-page.js';
import { AdminRequestPage } from './pages/admin-request-page.js';
import { AdminSettingsPage } from './pages/admin-settings-page.js';
import { BillingDocumentPage } from './pages/billing-document-page.js';
import { BillingPage } from './pages/billing-page.js';
import { BillingStatementPage } from './pages/billing-statement-page.js';
import {
  BILLING_ADMIN_DOCUMENT_ROUTE,
  BILLING_ADMIN_ORGANIZATIONS_ROUTE,
  BILLING_ADMIN_REPORTS_ROUTE,
  BILLING_ADMIN_REQUEST_ROUTE,
  BILLING_ADMIN_ROUTE,
  BILLING_ADMIN_SETTINGS_ROUTE,
  BILLING_DOCUMENT_ROUTE,
  BILLING_PAGE_ROUTE,
  BILLING_STATEMENT_ROUTE,
} from './routes.js';

/**
 * The organization drawer's group, by its name: declared by
 * `module-permissions` (`ORGANIZATION_NAV_GROUP`), restated here because a
 * module never imports another (PLAN §9). A name that drifted would put the
 * page in a group of its own at the bottom of the drawer, not lose it.
 */
const ORGANIZATION_NAV_GROUP = 'Organization';

/** The platform drawer's group, restated for the same reason (`module-jobs` declares it too). */
const ADMINISTRATION_NAV_GROUP = 'Administration';

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

/** The platform's queue: no params. */
function AdminQueueRoute() {
  return <AdminQueuePage />;
}

/** One request on the platform's side, from the path. */
function AdminRequestRoute({ params }: ModuleRouteProps) {
  return <AdminRequestPage requestId={params?.requestId} />;
}

/** A printable document on the platform's side: the request from the path, which document from the query. */
function AdminDocumentRoute({ params, searchParams }: ModuleRouteProps) {
  return (
    <AdminDocumentPage
      requestId={params?.requestId}
      kind={one(searchParams?.kind)}
      number={one(searchParams?.number)}
    />
  );
}

/** Every organization's standing: the filter from the query. */
function AdminOrganizationsRoute({ searchParams }: ModuleRouteProps) {
  return <AdminOrganizationsPage filter={one(searchParams?.filter)} />;
}

/** The reports: the range from the query. */
function AdminReportsRoute({ searchParams }: ModuleRouteProps) {
  return <AdminReportsPage from={one(searchParams?.from)} to={one(searchParams?.to)} />;
}

/** The platform's billing settings and prices: no params. */
function AdminSettingsRoute() {
  return <AdminSettingsPage />;
}

/**
 * Billing's web half: the organization's Billing page (phase 6) and the
 * platform's queue, requests and settings (phase 7). Not a
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
    /*
     * The platform's pages (phase 7), app level. All read with `queue_read`;
     * the decisions and the settings changes are hidden in the page without
     * `approve`, `void` or `manage_settings`, and refused by the API again.
     */
    {
      path: BILLING_ADMIN_ROUTE,
      component: AdminQueueRoute,
      title: 'Billing queue',
      feature: PLATFORM_BILLING_FEATURE.queueRead,
      nav: { group: ADMINISTRATION_NAV_GROUP, order: 32, icon: 'receipt' },
    },
    {
      path: BILLING_ADMIN_REQUEST_ROUTE,
      component: AdminRequestRoute,
      title: 'Billing request',
      feature: PLATFORM_BILLING_FEATURE.queueRead,
    },
    {
      path: BILLING_ADMIN_DOCUMENT_ROUTE,
      component: AdminDocumentRoute,
      title: 'Billing document',
      feature: PLATFORM_BILLING_FEATURE.queueRead,
      chrome: 'fullscreen',
    },
    {
      path: BILLING_ADMIN_ORGANIZATIONS_ROUTE,
      component: AdminOrganizationsRoute,
      title: 'Organizations’ billing',
      feature: PLATFORM_BILLING_FEATURE.queueRead,
      nav: { group: ADMINISTRATION_NAV_GROUP, order: 33, icon: 'organization' },
    },
    {
      path: BILLING_ADMIN_REPORTS_ROUTE,
      component: AdminReportsRoute,
      title: 'Billing reports',
      feature: PLATFORM_BILLING_FEATURE.queueRead,
      nav: { group: ADMINISTRATION_NAV_GROUP, order: 34, icon: 'chart-bar' },
    },
    {
      path: BILLING_ADMIN_SETTINGS_ROUTE,
      component: AdminSettingsRoute,
      title: 'Billing settings',
      feature: PLATFORM_BILLING_FEATURE.queueRead,
      nav: { group: ADMINISTRATION_NAV_GROUP, order: 35, icon: 'wallet' },
    },
  ],
};
