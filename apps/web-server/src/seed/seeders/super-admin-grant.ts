import { normaliseEmail } from '@kwtech/module-auth';
import { grantAppRole } from '@kwtech/module-permissions/server';
import { SUPER_ADMIN_KEY } from '../app-roles.js';
import type { Seeder } from '../types.js';

/**
 * Grants `super-admin` to the address in SEED_SUPER_ADMIN_EMAIL.
 *
 * ## Why the email lookup is HERE and not in the module
 *
 * This is the seam. `auth_user` belongs to `@kwtech/module-auth` and
 * `perm_user_role` to `@kwtech/module-permissions`, and those two packages do
 * not import each other (PLAN §9). So the app resolves the person to an id and
 * hands the id over — exactly what `resolvePrincipal` does on the server and
 * `session-query` does on the web.
 *
 * `grantAppRole` therefore takes a `userId`, which is also why it cannot invent
 * the user: refusing an unknown address is what stops a typo minting platform
 * staff.
 *
 * ## Why it is optional
 *
 * Skipped entirely when the variable is unset, so the task is safe to run on any
 * environment. Syncing roles is routine; handing someone every right on the
 * platform is not, and a seeder that did it by default would do it on the
 * environment where it matters most.
 */
export const superAdminGrantSeeder: Seeder = {
  name: 'permissions:super-admin',
  phase: 'seed',
  description: 'Grant super-admin to SEED_SUPER_ADMIN_EMAIL, if it is set.',
  async run({ prisma, log }) {
    const raw = process.env.SEED_SUPER_ADMIN_EMAIL;
    if (!raw) {
      log('skipped — set SEED_SUPER_ADMIN_EMAIL to grant it');
      return;
    }

    const email = normaliseEmail(raw);
    const user = await prisma.authUser.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new Error(`No user with email ${email}. Run the auth:first-user seeder first.`);

    const grant = await grantAppRole(prisma, { userId: user.id, roleKey: SUPER_ADMIN_KEY });
    log(`${grant.created ? 'granted' : 'already held'} ${SUPER_ADMIN_KEY} → ${email}`);
  },
};
