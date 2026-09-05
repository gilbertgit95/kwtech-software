import { syncFeatureRegistry } from '@kwtech/module-permissions/server';
import { ALL_FEATURES } from '../registry.js';
import type { Seeder } from '../types.js';

/**
 * Mirrors the module's feature registry into `perm_feature`.
 *
 * The ALGORITHM is the module's — upsert every spec, deprecate what is gone,
 * never delete — because it has to agree with the module's own read path, which
 * filters `deprecatedAt: null`. This file supplies the client and the registry
 * and nothing else.
 *
 * Phase 'sync', and that is load-bearing: `perm_role_feature` has a foreign key
 * to `perm_feature`, so until this has run a newly added key CANNOT BE GRANTED
 * TO ANYONE. It has to happen on every deploy, not when someone remembers.
 */
export const permissionsRegistrySeeder: Seeder = {
  name: 'permissions:features',
  phase: 'sync',
  description: 'Mirror every module’s feature registry into perm_feature.',
  async run({ prisma, log }) {
    const result = await syncFeatureRegistry(prisma, ALL_FEATURES);
    log(`${result.upserted} feature(s) upserted`);
    if (result.deprecated.length > 0) log(`deprecated: ${result.deprecated.join(', ')}`);
  },
};
