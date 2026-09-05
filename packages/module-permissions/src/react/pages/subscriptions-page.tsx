'use client';

import { FEATURE } from '../../feature-keys.js';
import { AdminPage, AdminPlaceholder } from './admin-page.js';

/**
 * Subscriptions — what an organization bought, as opposed to what its people
 * may do.
 *
 * The distinction is the model's, not this page's: a plan supplies
 * ENTITLEMENTS and a role supplies GRANTS, and a feature needs both. Keeping
 * them on separate screens is what stops "upgrade your plan" and "ask an
 * administrator" from being answered by the same button — see
 * domain/grants.ts.
 *
 * Gated on `billing:manage`, which the registry already describes as
 * entitlement rather than authorisation.
 */
export function SubscriptionsPage() {
  return (
    <AdminPage
      title="Subscriptions"
      description="The plan each organization is on, what it entitles them to, and when it renews."
      feature={FEATURE.billingManage}
    >
      {/*
        PermPlan, PermPlanFeature, PermPlanLimit and PermSubscription all exist
        and are already read by the resolution pipeline — they are simply not
        exposed to a client. The screen lands with those operations.
      */}
      <AdminPlaceholder>
        The plan and subscription screens are not built yet. They need read operations over <code>PermPlan</code> and{' '}
        <code>PermSubscription</code>, which the module does not expose today.
      </AdminPlaceholder>
    </AdminPage>
  );
}
