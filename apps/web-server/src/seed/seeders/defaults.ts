import { APP_DEFAULT } from '@kwtech/module-permissions';
import { NORMAL_USER_KEY } from '../app-roles.js';
import type { Seeder } from '../types.js';

/**
 * The platform's recommended STARTING defaults.
 *
 * What every new account, organization and workspace is created with, on a
 * database where nobody has decided yet. `/admin/defaults` is where an operator
 * changes them; this exists so a fresh environment is not born with all of them
 * blank — which is a working state, and a bad first impression: a founder who
 * cannot administer the company they just created, on an organization entitled
 * to nothing.
 *
 * ## ⚠ IT ONLY EVER WRITES A ROW THAT IS ABSENT
 *
 * Not "a row whose value is null". Those are different facts and the difference
 * is the whole reason `setDefault` writes null rather than deleting:
 *
 *   no row      nobody has decided. This seeder decides.
 *   null value  somebody deliberately turned it off, from the screen, and
 *               `updatedByUserId` records who. Refilling it would overrule an
 *               operator with a hardcoded opinion on the next deploy — the same
 *               call `createPlanIfAbsent` makes about a plan somebody has since
 *               edited.
 *
 * That is also what makes it idempotent in the way `Seeder.run` requires: a
 * second run finds every row present and writes nothing.
 *
 * ## 'sync', not 'seed'
 *
 * It belongs with the reference data an environment needs to function rather
 * than with the fixtures an operator asks for once. A deployment that never runs
 * `db:seed` still needs a sane answer to "what does a new account hold" — and
 * the absent-row rule is what makes running it on every deploy safe.
 *
 * ## Why the roles are named by KEY
 *
 * The defaults table stores role IDs, which are generated and differ between
 * databases, so this resolves each key to whatever id that role has here — the
 * same reason `defaultAppRoleKey` in the module options is a key. A role the
 * seed has not created is SKIPPED with a line in the log rather than failing the
 * run: an operator who renamed the presets should get their environment, not a
 * broken deploy.
 */

/**
 * The role each role-kinded default starts pointed at, by role key.
 *
 * ⚠ These are the least-privileged choice that still makes the process WORK,
 * not the most useful one. Choosing a default role is the escalation decision
 * — `assignRole`'s no-escalation check cannot run for a role the platform
 * grants on its own — so a seeded starting value has to be the one that is
 * hardest to regret, and an operator raises it deliberately from the screen.
 *
 *   the founder     `organization-owner`. The exception, and it is not an
 *                   escalation in any meaningful sense: they created the
 *                   company, they are its only member, and the alternative is
 *                   an organization nobody can administer.
 *   everyone else   the plain member role at that level. Being added to a
 *                   place is not a reason to be able to change it.
 */
const ROLE_DEFAULTS: { key: string; roleKey: string; why: string }[] = [
  { key: APP_DEFAULT.accountRole, roleKey: NORMAL_USER_KEY, why: 'manage your own account and nothing else' },
  { key: APP_DEFAULT.organizationFounderRole, roleKey: 'organization-owner', why: 'they created it' },
  { key: APP_DEFAULT.organizationMemberRole, roleKey: 'organization-user', why: 'joining is not administering' },
  { key: APP_DEFAULT.workspaceCreatorRole, roleKey: 'workspace-admin', why: 'they created it' },
  { key: APP_DEFAULT.workspaceMemberRole, roleKey: 'workspace-user', why: 'being added is not administering' },
];

/**
 * The defaults that point at nothing in the database — a status, a count of
 * days — so they need no lookup.
 */
const LITERAL_DEFAULTS: { key: string; value: string; why: string }[] = [
  {
    key: APP_DEFAULT.organizationPlanStatus,
    value: 'active',
    why: 'the only status that entitles anything',
  },
  {
    key: APP_DEFAULT.invitationExpiryDays,
    value: '7',
    why: 'the built-in figure, now visible and editable',
  },
  {
    /*
     * ⚠ A DATE NOTHING ENFORCES — YET, and this is the one seeded value whose
     * meaning depends on something that does not exist.
     *
     * Nothing compares a subscription to the clock (§12.40): an `active` row
     * entitles regardless of `currentPeriodEnd`, so what this writes is a
     * renewal date the guard ignores. A screen can read it as "renews on the
     * 30th" and nothing will happen on the 30th.
     *
     * Seeded anyway, deliberately, because the alternative is worse in the
     * other direction: every subscription this platform creates would carry NO
     * period at all, and the day a billing provider is wired in it has a
     * backlog of rows with nothing to reconcile against — no cycle start, no
     * cycle length, nothing to bill from. A recorded intention is something to
     * reconcile; a null is a gap somebody has to reconstruct.
     *
     * THIRTY, because a monthly cycle is what "first period" means to almost
     * everyone and it is the cadence a provider will most likely be configured
     * for. It is a starting value on the Defaults screen, not a commitment —
     * change it there, and the change applies to organizations created after
     * it, never to subscriptions already written.
     */
    key: APP_DEFAULT.organizationPlanPeriodDays,
    value: '30',
    why: 'a monthly cycle; informational until billing exists (§12.40)',
  },
];

/**
 * The plan a new organization starts on: the cheapest PUBLIC, live one.
 *
 * Derived rather than named, because the plan catalogue is a product decision
 * an operator changes through `/admin/plans` — hardcoding `free` here would be
 * this file having an opinion about a catalogue it does not own. Public,
 * because a private plan is one somebody is put on deliberately; live, because
 * an archived plan entitles nothing.
 *
 * "Cheapest" is approximated by FEWEST FEATURES, since the module models no
 * price. That is the right proxy for a starting default anyway: the smallest
 * thing that is still an answer, which is the same call `normal-user` makes.
 */
async function startingPlanKey(prisma: SeedPrisma): Promise<string | null> {
  const plans = await prisma.permPlan.findMany({
    where: { isPublic: true, archivedAt: null },
    include: { features: { select: { featureKey: true } } },
    orderBy: { key: 'asc' },
  });
  if (plans.length === 0) return null;

  const smallest = plans.reduce((best, plan) => (plan.features.length < best.features.length ? plan : best));
  return smallest.key;
}

type SeedPrisma = Parameters<Seeder['run']>[0]['prisma'];

export const defaultsSeeder: Seeder = {
  name: 'permissions:defaults',
  phase: 'sync',
  description: 'Set the platform defaults that have never been decided. Never changes one somebody has set or cleared.',
  async run({ prisma, log }) {
    const existing = new Set((await prisma.permDefault.findMany({ select: { key: true } })).map((row) => row.key));
    let written = 0;

    /*
     * `createMany` is not used, and `upsert` deliberately is not either: both
     * would need this to say what to do about a row that is already there, and
     * the answer — leave it completely alone, value or no value — is expressed
     * more clearly by not writing at all.
     */
    const write = async (key: string, value: string, why: string) => {
      if (existing.has(key)) return;
      await prisma.permDefault.create({ data: { key, value, updatedAt: new Date(), updatedByUserId: null } });
      log(`${key} → ${value} (${why})`);
      written += 1;
    };

    const roles = await prisma.permRole.findMany({
      where: { organizationId: null, disabledAt: null },
      select: { id: true, key: true },
    });
    const roleIdByKey = new Map(roles.map((role) => [role.key, role.id]));

    for (const entry of ROLE_DEFAULTS) {
      if (existing.has(entry.key)) continue;
      const roleId = roleIdByKey.get(entry.roleKey);
      if (!roleId) {
        log(`${entry.key} — skipped, no ${entry.roleKey} role here`);
        continue;
      }
      await write(entry.key, roleId, `${entry.roleKey}: ${entry.why}`);
    }

    for (const entry of LITERAL_DEFAULTS) {
      await write(entry.key, entry.value, entry.why);
    }

    if (!existing.has(APP_DEFAULT.organizationPlan)) {
      const planKey = await startingPlanKey(prisma);
      if (planKey) await write(APP_DEFAULT.organizationPlan, planKey, 'smallest public live plan');
      else log(`${APP_DEFAULT.organizationPlan} — skipped, no public live plan here`);
    }

    log(written === 0 ? 'every default already decided — nothing written' : `${written} default(s) set`);
  },
};
