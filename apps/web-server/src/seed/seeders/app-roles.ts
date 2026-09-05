import { upsertAppRole } from '@kwtech/module-permissions/server';
import { APP_ROLES } from '../app-roles.js';
import { ALL_FEATURES } from '../registry.js';
import type { Seeder } from '../types.js';

/**
 * Upserts this product's app-level system roles.
 *
 * Ordered AFTER the registry seeder in the list, and that ordering is real
 * rather than tidy: `perm_role_feature` references `perm_feature`, so granting
 * a role a key the registry has not written yet fails on a foreign key.
 *
 * Each role gets its own transaction rather than one across all of them — the
 * roles are independent, and a failure on the second should not roll back a
 * correctly synced first.
 */
export const appRolesSeeder: Seeder = {
  name: 'permissions:app-roles',
  phase: 'sync',
  description: 'Upsert the app-level system roles and re-sync what they grant.',
  async run({ prisma, log }) {
    for (const definition of APP_ROLES) {
      const role = await prisma.$transaction((tx) => upsertAppRole(tx, definition, ALL_FEATURES));
      log(`${role.key}: ${role.features} feature(s)`);
    }
  },
};
