'use client';

import { FEATURE } from '../../feature-keys.js';
import { AdminPage, AdminPlaceholder } from './admin-page.js';

/**
 * Organizations — the tenants, and who belongs to them.
 *
 * The module's own page, shipped with the module. A consuming app does not
 * build this screen, know its data shape, or wire its queries: it lists the
 * module and the route appears.
 *
 * Gated on `members:manage` rather than `admin:access`, because this is where
 * people are invited, removed and re-roled — the organization-level
 * administration key, not the baseline right to open the admin app at all.
 */
export function OrganizationsPage() {
  return (
    <AdminPage
      title="Organizations"
      description="The organizations you administer, their members and the roles those members hold."
      feature={FEATURE.membersManage}
    >
      {/*
        The rows exist — PermOrganization and PermMembership — but nothing
        exposes them yet. The list and the member editor land with the module's
        own read operations; the route, the nav entry and the gate are already
        real, so only the body changes.
      */}
      <AdminPlaceholder>
        The organization list is not built yet. It needs read operations over <code>PermOrganization</code> and{' '}
        <code>PermMembership</code>, which the module does not expose today.
      </AdminPlaceholder>
    </AdminPage>
  );
}
