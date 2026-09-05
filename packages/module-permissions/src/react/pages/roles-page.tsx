'use client';

import { FEATURE } from '../../feature-keys.js';
import { AdminPage, AdminPlaceholder } from './admin-page.js';

/**
 * The role editor — the module's own page, shipped with the module.
 *
 * A consuming app does not build this screen, know its data shape, or wire its
 * queries. It lists the module; the route appears.
 */
export function RolesPage() {
  return (
    <AdminPage
      title="Roles"
      description="What each role grants, and who holds it. A role is exactly the list of features it carries — there is no inheritance."
      feature={FEATURE.adminAccess}
    >
      {/* Phase 6: role list and grant editor over the module's own operations. */}
      <AdminPlaceholder>
        The role list and grant editor are not built yet. The vocabulary they edit is already visible under Features.
      </AdminPlaceholder>
    </AdminPage>
  );
}
