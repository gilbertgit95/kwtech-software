import { createPlanIfAbsent } from '@kwtech/module-permissions/server';
import { PLANS } from '../plans.js';
import { ALL_FEATURES } from '../registry.js';
import type { Seeder } from '../types.js';

/**
 * Creates this product's starting plan catalogue.
 *
 * ## Phase 'seed', NOT 'sync' — the opposite call from app roles
 *
 * `permissions:app-roles` is 'sync' because a role's meaning is code: a role
 * that grants `roles:read` has to keep granting it or the guards lie, so it is
 * re-asserted on every deploy and the admin screens refuse to edit one.
 *
 * A plan is the other kind of thing. What it sells is a PRODUCT decision that
 * changes without a deploy — adding a feature to `pro`, raising a seat cap —
 * and that is the ordinary use of the screens this module ships. Re-asserting
 * the definitions every release would silently undo an operator's work, which
 * is why `createPlanIfAbsent` creates what is missing and never rewrites what
 * is there.
 *
 * So this is asked for once per environment, like the first user account: it
 * hands over a catalogue and gets out of the way.
 *
 * ⚠ RUN `pnpm db:sync` FIRST. `perm_plan_feature` has a foreign key to
 * `perm_feature`, so a plan cannot sell a key the registry has not written yet.
 * That is a cross-phase dependency — the same one `permissions:super-admin`
 * already has on the app roles — and it is why a fresh environment runs sync
 * before seed rather than the other way round.
 *
 * Each plan gets its own transaction: they are independent, and a failure on
 * the third should not roll back two correctly created ones.
 */
export const plansSeeder: Seeder = {
  name: 'permissions:plans',
  phase: 'seed',
  description:
    'Create the starting plan catalogue — free, starter, pro, enterprise. Never overwrites an existing plan.',
  async run({ prisma, log }) {
    for (const definition of PLANS) {
      const plan = await prisma.$transaction((tx) => createPlanIfAbsent(tx, definition, ALL_FEATURES));
      // Says which it did, because "created" and "left alone" are the two
      // outcomes an operator needs to tell apart on a live system.
      log(
        plan.created
          ? `${plan.key}: created with ${plan.features} feature(s)`
          : `${plan.key}: already exists, left unchanged`,
      );
    }
  },
};
