import type { PrismaClient } from '../generated/client.js';

/**
 * The contract a seeder fills in, so adding one is a file and a list entry.
 *
 * The shape is deliberately the same idea as `WebModuleDescriptor`: declare a
 * thing, add it to one array, and the runner does the rest. Nobody edits the
 * runner to add a seeder, and nobody edits package.json.
 */

/**
 * WHEN a seeder runs, and this is the distinction that matters most here.
 *
 *   'sync'  Reference data the code owns and the database mirrors. Idempotent,
 *           and it must run on EVERY DEPLOY — `perm_role_feature` has a foreign
 *           key to `perm_feature`, so until the registry is synced a newly added
 *           feature key cannot be granted to anyone. This is a migration of
 *           reference data, not sample data.
 *
 *   'seed'  Data an operator asks for once per environment: the first account,
 *           a demo tenant, fixtures for a test database. Running it again on a
 *           live system is at best noise and at worst an account nobody
 *           expected.
 *
 * They were one `pnpm db:seed` command and have opposite lifecycles, which is
 * how "sync the registry" ended up being something to remember rather than
 * something that happens.
 */
export type SeedPhase = 'sync' | 'seed';

export interface SeedContext {
  /**
   * ONE client, shared by every seeder in a run.
   *
   * The scripts used to be separate processes chained with `&&`, which meant a
   * connection pool each and no way for a later step to see a partial earlier
   * one — and a failure halfway left the database half-seeded with the shell
   * simply stopping.
   */
  prisma: PrismaClient;
  /** Progress, prefixed with the seeder's name by the runner. */
  log: (message: string) => void;
}

export interface Seeder {
  /** Shown in the runner's output and used to select one with `--only`. */
  name: string;
  phase: SeedPhase;
  /** One line, for `pnpm db:seed --list`. */
  description: string;
  /**
   * MUST BE IDEMPOTENT — running twice does the same thing as running once.
   *
   * This is the property that replaces a transaction around the whole run.
   * Wrapping every seeder in one would mean a single long-lived transaction
   * (Prisma's interactive ones time out) and would still not help across
   * separate invocations. Convergence does: a run that fails halfway is fixed by
   * running it again, which is also exactly what a redeploy does.
   *
   * A seeder needing atomicity across several of its own writes should open its
   * own `prisma.$transaction`.
   */
  run(context: SeedContext): Promise<void>;
}
