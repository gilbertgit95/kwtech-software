import { normaliseEmail } from '@kwtech/module-auth';
import { grantAppRole } from '@kwtech/module-permissions/server';
import { NORMAL_USER_KEY } from '../app-roles.js';
import type { Seeder } from '../types.js';
import { seedUser } from './first-user.js';

/**
 * An ordinary account holding no features, for testing that gating actually
 * gates.
 *
 * ## Why a seeder and not a one-off script
 *
 * `prisma migrate reset` drops everything, and a test account that has to be
 * recreated by hand is a test account nobody recreates — after which "does the
 * denial still work" stops being a question anyone can answer in a minute. This
 * is the extension point the seed folder exists for; adding it is a file and a
 * line in `seeders/index.ts`.
 *
 * ## Why the credentials come from the environment
 *
 * A password in a source file is a password in the repository, and this one is
 * real. `apps/web-server/.env` is gitignored; `.env.example` documents the
 * variables with placeholders and no value.
 *
 * Skipped entirely when unset, so the seeder is safe on any environment — a
 * demo account appearing on production because someone ran the seed task is
 * exactly the kind of surprise a test fixture must not be capable of.
 */
export const demoUserSeeder: Seeder = {
  name: 'demo:user',
  phase: 'seed',
  description: 'Create the SEED_DEMO_USER_* account and grant it the feature-less normal-user role.',
  async run({ prisma, log }) {
    const email = process.env.SEED_DEMO_USER_EMAIL;
    const password = process.env.SEED_DEMO_USER_PASSWORD;

    if (!email || !password) {
      log('skipped — set SEED_DEMO_USER_EMAIL and SEED_DEMO_USER_PASSWORD');
      return;
    }

    /*
     * The SAME `seedUser` the first-operator seeder uses, so this account is
     * created by the same rules: normalised email, the module's own hash, and
     * the password policy checked out loud. A second implementation would be a
     * second place for "how an account is made" to drift.
     */
    const { id, created } = await seedUser(prisma, {
      email,
      username: process.env.SEED_DEMO_USER_USERNAME ?? 'demo.user',
      displayName: process.env.SEED_DEMO_USER_NAME ?? 'Demo User',
      password,
    });
    log(`${created ? 'created' : 'updated'} ${normaliseEmail(email)} (${id})`);

    /*
     * `normal-user` grants nothing, which is the point: every gated route, page,
     * component and endpoint should refuse this account, and the drawer should
     * show no Administration group at all.
     */
    const grant = await grantAppRole(prisma, { userId: id, roleKey: NORMAL_USER_KEY });
    log(`${grant.created ? 'granted' : 'already held'} ${NORMAL_USER_KEY} — holds no features by design`);
  },
};
