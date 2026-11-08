import type { ModuleRouteProps, WebModuleDescriptor } from '@kwtech/module-kit';
import { PLATFORM_BILLING_FEATURE, PLATFORM_BILLING_FEATURE_REGISTRY } from '../feature-keys.js';
import { BillingPage } from './pages/billing-page.js';
import { BILLING_PAGE_ROUTE } from './routes.js';

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

/**
 * Billing's web half (phase 6): the organization's Billing page. Not a
 * sub-app (plan §3): a drawer page under the organization, never on a
 * workspace's Apps page.
 *
 * ⚠ It replaces `module-permissions`' read-only
 * `/organizations/:organizationId/subscription`; the app drops that route
 * when it composes both (apps/web-app/src/modules.ts).
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
  ],
};
