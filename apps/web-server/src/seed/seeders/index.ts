import type { Seeder } from '../types.js';
import { appRolesSeeder } from './app-roles.js';
import { defaultsSeeder } from './defaults.js';
import { demoUserSeeder } from './demo-user.js';
import { firstUserSeeder } from './first-user.js';
import { permissionsRegistrySeeder } from './permissions-registry.js';
import { plansSeeder } from './plans.js';
import { superAdminGrantSeeder } from './super-admin-grant.js';

/**
 * EVERY SEEDER THIS APP RUNS, listed once. ← add yours here
 *
 * The same idea as `WEB_MODULES` in the web app: declare a thing, add it to one
 * array, and nothing downstream changes. The runner reads this list, package.json
 * does not name individual scripts, and adding a seeder is a file plus a line.
 *
 * ## Order is real
 *
 * Seeders run top to bottom within their phase, and some genuinely depend on
 * what came before: `perm_role_feature` has a foreign key to `perm_feature`, so
 * app roles cannot be granted keys the registry has not written yet, and the
 * super-admin grant needs both a role and a user to exist.
 *
 * There is no `dependsOn` field and deliberately so — an explicit graph for four
 * entries with one real edge is machinery to maintain in place of a list to
 * read. Put a new seeder after what it needs.
 *
 * ## Writing one
 *
 * See ./README.md. The short version:
 *
 *   export const demoTenantSeeder: Seeder = {
 *     name: 'demo:tenant',
 *     phase: 'seed',
 *     description: 'A worked-example organization with two workspaces.',
 *     async run({ prisma, log }) { ... },
 *   };
 *
 * It MUST be idempotent — see the note on `Seeder.run`.
 */
export const SEEDERS: readonly Seeder[] = [
  // ── sync: reference data, every deploy ──────────────────────────────────
  permissionsRegistrySeeder,
  appRolesSeeder,
  /*
   * After the roles: it points defaults AT them, by key, and a role the seeder
   * above has not created yet is one it would skip.
   */
  defaultsSeeder,

  // ── seed: once per environment, on request ──────────────────────────────
  /*
   * The plan catalogue. 'seed' rather than 'sync' because what a plan sells is
   * a product decision an operator changes through the admin screens — see the
   * seeder. It depends on the registry above having run, which is a cross-phase
   * dependency and the same one superAdminGrantSeeder already has.
   */
  plansSeeder,
  firstUserSeeder,
  superAdminGrantSeeder,
  // After the roles above: it grants one, so the role has to exist first.
  demoUserSeeder,
];
