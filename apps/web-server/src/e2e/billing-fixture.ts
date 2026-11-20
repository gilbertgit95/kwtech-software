import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { unbilledAccessUntil } from '@kwtech/module-permissions';
import { grantAppRole } from '@kwtech/module-permissions/server';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env.js';
import { PrismaClient } from '../generated/client.js';
import { seedUser } from '../seed/seeders/first-user.js';

/**
 * `pnpm --filter @kwtech/web-server e2e:billing <setup|teardown>`: the people
 * and the organization the billing browser tests (#178,
 * `apps/web-app/e2e/billing/`) sign in as.
 *
 * ⚠ NOT A SEEDER, for the reason `notify:demo` is not one: it writes USER data
 * (accounts, an organization, billing rows) and deletes them again, which
 * nothing that runs on a deploy may ever do. Two locks keep it local: the
 * package script refuses any profile but `local` (`env.mjs --require=local`),
 * and this file refuses anything but `APP_ENV=local` in a development build.
 *
 * ## Why throwaway accounts
 *
 * The seed account has two-step sign-in, which a script cannot pass, and its
 * password is a profile secret. These accounts have no second factor and a
 * password made fresh on every `setup`, written only to the gitignored
 * `apps/web-app/e2e/billing/.fixture.json` the tests read.
 *
 * ## Why `setup` starts with a teardown
 *
 * Every run starts from the same state (Free, trial unused, no requests), so a
 * run that failed halfway never leaves the next one a different organization.
 * Everything is found by the fixed emails and the organization key below,
 * never by the JSON file, so a lost file still cleans up.
 *
 * ## Why Prisma directly, not the services
 *
 * Booting the app's module would start the job runner beside the one the
 * running API already has. The rows written are the ones the app's own paths
 * write: `seedUser` for an account (the same hash and policy), `grantAppRole`
 * for platform staff, and the Free row as `startDefaultSubscription` writes it.
 */

/** The organization's key: unique, and what teardown finds it by. */
const ORGANIZATION_KEY = 'e2e-billing';
const ORGANIZATION_NAME = 'E2E Billing';
const WORKSPACE_KEY = 'e2e-billing-desk';
const WORKSPACE_NAME = 'E2E Billing desk';

/** `.test` is reserved (RFC 2606): no mail sent to these can reach anybody. */
const EMAIL_DOMAIN = 'e2e-billing.test';

/** The default plan a new organization starts on when it gets no trial, and its period (`organization.plan_period_days`). */
const FREE_PLAN_KEY = 'free';
const FREE_PERIOD_DAYS = 30;

/**
 * One account per perspective of #178, "Who is who". `organizationRole` and
 * `workspaceRole` make it a member; `appRole` makes it platform staff.
 */
const PEOPLE = {
  owner: { name: 'E2E Owner', organizationRole: 'organization-owner', workspaceRole: 'workspace-admin' },
  admin: { name: 'E2E Admin', organizationRole: 'organization-admin', workspaceRole: 'workspace-admin' },
  member: { name: 'E2E Member', organizationRole: 'organization-user', workspaceRole: 'workspace-user' },
  approver: { name: 'E2E Approver', appRole: 'platform-billing-approver' },
  /** D15: an approver who also belongs to the organization, flagged and not blocked. */
  approverMember: {
    name: 'E2E Approver Member',
    appRole: 'platform-billing-approver',
    organizationRole: 'organization-user',
    workspaceRole: 'workspace-user',
  },
  superAdmin: { name: 'E2E Super Admin', appRole: 'super-admin' },
  support: { name: 'E2E Support', appRole: 'platform-support' },
  operations: { name: 'E2E Operations', appRole: 'platform-operations' },
  moderator: { name: 'E2E Moderator', appRole: 'platform-moderator' },
} as const satisfies Record<string, Person>;

interface Person {
  name: string;
  appRole?: string;
  organizationRole?: string;
  workspaceRole?: string;
}

type PersonKey = keyof typeof PEOPLE;

/** What the tests read: who to sign in as, and where. */
export interface BillingFixture {
  createdAt: string;
  organizationId: string;
  workspaceId: string;
  people: Record<PersonKey, { id: string; email: string; password: string; name: string }>;
}

/** Where the tests look for it, from `apps/web-server` (the package script's directory). */
const FIXTURE_FILE = resolve(process.cwd(), '../web-app/e2e/billing/.fixture.json');

function emailOf(key: PersonKey): string {
  return `${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}@${EMAIL_DOMAIN}`;
}

function usernameOf(key: PersonKey): string {
  return `e2e.billing.${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/** A role every database has after `db:sync`, by key. Throws, naming the fix, when it is missing. */
async function systemRoleId(prisma: PrismaClient, key: string): Promise<string> {
  const role = await prisma.permRole.findFirst({ where: { key, organizationId: null }, select: { id: true } });
  if (!role) throw new Error(`No role '${key}'. Run pnpm --filter @kwtech/web-server db:sync first.`);
  return role.id;
}

/**
 * The app role every new account is given (`account.app_role`), as accepting
 * an invitation gives it.
 *
 * ⚠ Without it an account holds no app-level grant at all, which no real
 * account is in: the app then cannot resolve its app-level permissions, the
 * organization list comes back empty and every `/admin` page says "We could
 * not determine your permissions" (seen on the first run, 2026-11-20).
 */
async function accountAppRoleId(prisma: PrismaClient): Promise<string> {
  const stored = await prisma.permDefault.findUnique({ where: { key: 'account.app_role' }, select: { value: true } });
  if (stored?.value) return stored.value;
  return systemRoleId(prisma, 'normal-user');
}

/**
 * Removes everything a setup made, and whatever the tests made in the
 * organization since. Billing first: its rows refer to each other with
 * `Restrict`, and none of them cascades from the organization (they hold its
 * id as a bare string).
 */
async function teardown(prisma: PrismaClient): Promise<void> {
  const organization = await prisma.permOrganization.findUnique({
    where: { key: ORGANIZATION_KEY },
    select: { id: true },
  });
  const users = await prisma.authUser.findMany({
    where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);

  if (organization) {
    const organizationId = organization.id;
    // In this order, each step's rows referring only to rows a later step removes.
    await prisma.platformBillingEvent.deleteMany({ where: { organizationId } });
    await prisma.platformBillingPayment.deleteMany({ where: { request: { organizationId } } });
    await prisma.platformBillingCredit.deleteMany({ where: { organizationId } });
    await prisma.platformBillingReceipt.deleteMany({ where: { organizationId } });
    await prisma.platformBillingBill.deleteMany({ where: { organizationId } });
    await prisma.platformBillingRequest.deleteMany({ where: { organizationId } });
    await prisma.platformBillingNotice.deleteMany({ where: { organizationId } });
    await prisma.platformBillingAutoRenew.deleteMany({ where: { organizationId } });
    await prisma.platformBillingLock.deleteMany({ where: { organizationId } });
    // Memberships, workspaces, roles and subscriptions cascade from the organization.
    await prisma.permOrganization.delete({ where: { id: organizationId } });
  }

  await rewindNumbering(prisma);

  if (userIds.length > 0) {
    await prisma.notificationItem.deleteMany({ where: { recipientId: { in: userIds } } });
    // App roles hold the user's id as a bare string: nothing cascades to them.
    await prisma.permUserRole.deleteMany({ where: { userId: { in: userIds } } });
    // Sessions, credentials and the rest of the account cascade from the user.
    await prisma.authUser.deleteMany({ where: { id: { in: userIds } } });
  }

  rmSync(FIXTURE_FILE, { force: true });
  console.log(
    `Removed ${organization ? `the organization ${ORGANIZATION_NAME}` : 'no organization'} and ${userIds.length} account(s).`,
  );
}

/**
 * Puts the bill and receipt numbering back after the tests' documents are
 * removed: each counter to the highest number still in use (0 if none).
 *
 * ⚠ The counters are the PLATFORM's, shared with every organization, and
 * numbering has no gaps (module-platform-billing's README). Left alone, the
 * real organizations' next bill would follow numbers that no longer exist.
 * Rewinding to the highest number left keeps their sequence whole. The one
 * case it cannot mend: a real bill issued DURING a run, after a test bill,
 * keeps its number and the removed test number is a gap below it.
 */
async function rewindNumbering(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const [bill, receipt] = await Promise.all([
      tx.platformBillingBill.aggregate({ _max: { number: true } }),
      tx.platformBillingReceipt.aggregate({ _max: { number: true } }),
    ]);
    await tx.platformBillingCounter.updateMany({ where: { sequence: 'bill' }, data: { value: bill._max.number ?? 0 } });
    await tx.platformBillingCounter.updateMany({
      where: { sequence: 'receipt' },
      data: { value: receipt._max.number ?? 0 },
    });
  });
}

async function setup(prisma: PrismaClient): Promise<void> {
  await teardown(prisma);

  const people = {} as BillingFixture['people'];
  for (const key of Object.keys(PEOPLE) as PersonKey[]) {
    // One at a time: each is a transaction of its own, and the order shows in the log.
    const password = randomBytes(18).toString('base64url');
    const email = emailOf(key);
    const { id } = await seedUser(prisma, {
      email,
      username: usernameOf(key),
      displayName: PEOPLE[key].name,
      password,
    });
    people[key] = { id, email, password, name: PEOPLE[key].name };
  }

  const now = new Date();
  const periodEnd = new Date(now.getTime() + FREE_PERIOD_DAYS * 86_400_000);
  const organization = await prisma.permOrganization.create({
    data: {
      key: ORGANIZATION_KEY,
      name: ORGANIZATION_NAME,
      description: 'Made by the billing browser tests (#178); removed by e2e:billing teardown.',
      workspaces: { create: { key: WORKSPACE_KEY, name: WORKSPACE_NAME } },
      /*
       * Free, as `startDefaultSubscription` writes it for an organization that
       * gets no trial, and with NO `trialUserId`: the owner's trial is unused,
       * which the trial case (O14) depends on.
       */
      subscriptions: {
        create: {
          planKey: FREE_PLAN_KEY,
          status: 'active',
          currentPeriodEnd: periodEnd,
          accessUntil: unbilledAccessUntil(periodEnd),
        },
      },
    },
    select: { id: true, workspaces: { select: { id: true } }, subscriptions: { select: { id: true } } },
  });
  const workspaceId = organization.workspaces[0]?.id;
  const subscriptionId = organization.subscriptions[0]?.id;
  if (!workspaceId || !subscriptionId) throw new Error('The organization was created without its workspace.');
  // The live slot, set after the create because it names the organization's own id.
  await prisma.permSubscription.update({
    where: { id: subscriptionId },
    data: { liveOrganizationId: organization.id },
  });

  const accountRoleId = await accountAppRoleId(prisma);
  for (const key of Object.keys(PEOPLE) as PersonKey[]) {
    const person: Person = PEOPLE[key];
    const userId = people[key].id;
    await prisma.permUserRole.create({ data: { userId, roleId: accountRoleId } });
    if (person.appRole) await grantAppRole(prisma, { userId, roleKey: person.appRole });
    if (!person.organizationRole) continue;

    const membership = await prisma.permMembership.create({
      data: {
        userId,
        organizationId: organization.id,
        status: 'active',
        roles: { create: { roleId: await systemRoleId(prisma, person.organizationRole) } },
      },
      select: { id: true },
    });
    if (!person.workspaceRole) continue;
    await prisma.permWorkspaceMember.create({
      data: {
        membershipId: membership.id,
        workspaceId,
        roles: { create: { roleId: await systemRoleId(prisma, person.workspaceRole) } },
      },
    });
  }

  const fixture: BillingFixture = {
    createdAt: now.toISOString(),
    organizationId: organization.id,
    workspaceId,
    people,
  };
  mkdirSync(dirname(FIXTURE_FILE), { recursive: true });
  writeFileSync(FIXTURE_FILE, `${JSON.stringify(fixture, null, 2)}\n`, { mode: 0o600 });
  console.log(`Created ${ORGANIZATION_NAME} (${organization.id}) and ${Object.keys(people).length} accounts.`);
  console.log(`Wrote ${FIXTURE_FILE}`);
}

async function main(): Promise<void> {
  // The second lock, after the package script's: a build or a profile that is not local writes nothing.
  if (env.NODE_ENV !== 'development' || env.APP_ENV !== 'local') {
    throw new Error('e2e:billing runs only against the local profile, in a development build.');
  }
  const command = process.argv[2];
  if (command !== 'setup' && command !== 'teardown') {
    throw new Error('Say what to do: e2e:billing setup | e2e:billing teardown');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  try {
    if (command === 'setup') await setup(prisma);
    if (command === 'teardown') await teardown(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
