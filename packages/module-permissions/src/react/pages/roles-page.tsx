'use client';

import { FEATURE } from '../../feature-keys.js';
import { FeatureGate } from '../feature-gate.js';

/**
 * The role editor — the module's own page, shipped with the module.
 *
 * A consuming app does not build this screen, know its data shape, or wire its
 * queries. It lists the module; the route appears.
 */
export function RolesPage() {
  return (
    <FeatureGate allOf={[FEATURE.adminAccess]} fallback={<p>You do not have access to role administration.</p>}>
      <section>
        <h1>Roles</h1>
        {/* Phase 6: role list and grant editor over the module's own operations. */}
      </section>
    </FeatureGate>
  );
}
