import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DEFAULT_TIME_ZONE } from '@kwtech/module-kit';
import { unbilledAccessUntil } from '@kwtech/module-permissions';
import { grantAppRole } from '@kwtech/module-permissions/server';
import {
  addDays,
  addMonthsAnchored,
  DEFAULT_GRACE_DAYS,
  dayOfMonth,
  platformDay,
  platformDayStart,
} from '@kwtech/module-platform-billing';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env.js';
import { PrismaClient } from '../generated/client.js';
import { seedUser } from '../seed/seeders/first-user.js';

/**
 * `pnpm --filter @kwtech/web-server e2e:billing <setup|reset|period|daily|teardown>`: the people
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

/**
 * The organizations the trial case (O14) has the owner create in the browser:
 * keys start with this, which is what reset and teardown find them by. The
 * owner's first one takes the trial; the second is refused it (#199).
 */
const TRIAL_ORGANIZATION_KEY_PREFIX = 'e2e-billing-trial-';

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
 * The payment accounts the tests pay into, one per method (O4 shows them).
 * Made up and marked: nobody can send money to them.
 */
const TEST_PAYMENT_ACCOUNTS = [
  { method: 'cash', label: 'E2E cash desk', details: 'Test only (#178): pay at the counter.' },
  { method: 'e_wallet', label: 'E2E e-wallet', details: 'Test only (#178): 0900 000 0000.' },
  { method: 'bank_transfer', label: 'E2E bank', details: 'Test only (#178): account 000-000-000.' },
];

/** The platform's billing settings as they were before the first setup, or `null`: no row had been saved. */
interface SavedSettings {
  row: {
    currency: string;
    timeZone: string;
    graceDays: number;
    issuerName: string;
    issuerDetails: string;
    paymentAccounts: unknown;
    updatedById: string | null;
  } | null;
}

const SETTINGS_ID = 'platform';

/**
 * Where the settings before the tests are kept until teardown puts them
 * back. A file, not the fixture JSON, and written only when absent: a
 * second `setup` must not save the TEST settings as "before".
 */
const SAVED_SETTINGS_FILE = resolve(process.cwd(), '../web-app/e2e/billing/.settings-before.json');

function readSavedSettings(): SavedSettings | null {
  if (!existsSync(SAVED_SETTINGS_FILE)) return null;
  return JSON.parse(readFileSync(SAVED_SETTINGS_FILE, 'utf8')) as SavedSettings;
}

/**
 * The platform's settings as they were, with the test payment accounts.
 *
 * ⚠ PLATFORM-WIDE. There is one settings row (D16), so while the tests run
 * every organization's Billing page lists the test accounts; teardown puts
 * the row back as it was, or removes it if there was none. Saved once,
 * before the first change, so a run that failed halfway still restores the
 * original. Whatever a test changed (U2: grace, an account) is undone here
 * on every reset, so the next journey starts from the same settings.
 */
async function useTestSettings(prisma: PrismaClient): Promise<void> {
  let saved = readSavedSettings();
  if (!saved) {
    const row = await prisma.platformBillingSettings.findUnique({ where: { id: SETTINGS_ID } });
    saved = {
      row: row
        ? {
            currency: row.currency,
            timeZone: row.timeZone,
            graceDays: row.graceDays,
            issuerName: row.issuerName,
            issuerDetails: row.issuerDetails,
            paymentAccounts: row.paymentAccounts,
            updatedById: row.updatedById,
          }
        : null,
    };
    mkdirSync(dirname(SAVED_SETTINGS_FILE), { recursive: true });
    writeFileSync(SAVED_SETTINGS_FILE, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 });
  }
  const before = saved.row;
  const data = {
    ...(before
      ? {
          currency: before.currency,
          timeZone: before.timeZone,
          graceDays: before.graceDays,
          issuerName: before.issuerName,
          issuerDetails: before.issuerDetails,
        }
      : {}),
    paymentAccounts: TEST_PAYMENT_ACCOUNTS,
  };
  await prisma.platformBillingSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...data },
    update: data,
  });
}

/**
 * The settings back as they were before the first setup, and the prices the
 * test accounts set (U2) removed: a price is platform-wide too.
 */
async function restoreSettings(prisma: PrismaClient, userIds: readonly string[]): Promise<void> {
  if (userIds.length > 0) await prisma.platformBillingPrice.deleteMany({ where: { setById: { in: [...userIds] } } });
  const saved = readSavedSettings();
  if (!saved) return;
  if (!saved.row) {
    await prisma.platformBillingSettings.deleteMany({ where: { id: SETTINGS_ID } });
  } else {
    const { paymentAccounts, ...rest } = saved.row;
    await prisma.platformBillingSettings.update({
      where: { id: SETTINGS_ID },
      // Stored JSON, put back as it was read.
      data: { ...rest, paymentAccounts: paymentAccounts as object },
    });
  }
  rmSync(SAVED_SETTINGS_FILE, { force: true });
}

/**
 * Between journeys: the organization back on Free with no billing history,
 * the settings and prices back to the tests' own, the numbering rewound and
 * the people's notices cleared. The accounts and their sessions stay, so a
 * run keeps each person signed in (see e2e/billing/fixtures.ts).
 */
async function reset(prisma: PrismaClient): Promise<void> {
  const organization = await prisma.permOrganization.findUnique({
    where: { key: ORGANIZATION_KEY },
    select: { id: true },
  });
  if (!organization) throw new Error('No E2E Billing organization. Run e2e:billing setup first.');
  const users = await prisma.authUser.findMany({
    where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);

  await clearBilling(prisma, organization.id);
  await startOnFree(prisma, organization.id);
  await removeTrialOrganizations(prisma);
  await prisma.platformBillingPrice.deleteMany({ where: { setById: { in: userIds } } });
  await useTestSettings(prisma);
  await rewindNumbering(prisma);
  await prisma.notificationItem.deleteMany({ where: { recipientId: { in: userIds } } });
  console.log(`Reset ${ORGANIZATION_NAME} to Free.`);
}

/**
 * `period --ends=<±days> [--access=<±days>]`: moves E2E Billing's live
 * subscription so its period ends that many days from today (billing's time
 * zone), and its access with it: the end plus the grace by default, or
 * `--access` days from today. How the date cases (renewal window, grace,
 * hold, expiry) get there without waiting a month.
 *
 * Written the way billing writes a period (`platformDayStart` of each day,
 * the start one month before the end on the same billing day), so the pages
 * read it as they would a real one.
 */
async function movePeriod(prisma: PrismaClient, args: readonly string[]): Promise<void> {
  const ends = numberArgument(args, 'ends');
  if (ends === null) throw new Error('Say when the period ends: period --ends=-3 (days from today).');
  const organization = await prisma.permOrganization.findUnique({
    where: { key: ORGANIZATION_KEY },
    select: { id: true },
  });
  if (!organization) throw new Error('No E2E Billing organization. Run e2e:billing setup first.');
  const live = await prisma.permSubscription.findFirst({ where: { liveOrganizationId: organization.id } });
  if (!live) throw new Error('E2E Billing has no live subscription.');

  const settings = await prisma.platformBillingSettings.findUnique({ where: { id: SETTINGS_ID } });
  const timeZone = settings?.timeZone ?? DEFAULT_TIME_ZONE;
  const graceDays = settings?.graceDays ?? DEFAULT_GRACE_DAYS;
  const today = platformDay(new Date(), timeZone);
  const end = addDays(today, ends);
  const billingDay = dayOfMonth(end);
  const start = addMonthsAnchored(end, -1, billingDay);
  const accessDays = numberArgument(args, 'access');
  const accessUntil = accessDays === null ? addDays(end, graceDays) : addDays(today, accessDays);

  await prisma.permSubscription.update({
    where: { id: live.id },
    data: {
      periodStart: platformDayStart(start, timeZone),
      currentPeriodEnd: platformDayStart(end, timeZone),
      billingDay,
      accessUntil: platformDayStart(accessUntil, timeZone),
    },
  });
  console.log(`E2E Billing's period now ${start} to ${end}, access until ${accessUntil}.`);
}

/** `--name=<integer>` from the command line, or null when absent. */
function numberArgument(args: readonly string[], name: string): number | null {
  const raw = args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`--${name} takes a whole number of days, not ${raw}.`);
  return value;
}

/**
 * `daily`: the billing daily check for E2E Billing ALONE, now
 * (`PlatformBillingDailyCheck.runForOrganization`): its renewal from credit,
 * then its reminders, written and sent through the app's real notifier.
 *
 * ⚠ Never the whole run. A run retries, renews and reminds every
 * organization and sends the approvers' digest about all of them, and the
 * real organizations here must not be touched by a test.
 *
 * ⚠ The app is booted in this process to reach the handler, so the job
 * runner must be off (`JOBS_RUNNER=off` in the environment, which the env
 * profile does not override): a second runner beside the running API would
 * run every process twice. Refused otherwise.
 */
async function runDailyCheck(organizationId: string): Promise<void> {
  if (env.JOBS_RUNNER !== 'off') {
    throw new Error('Run it with JOBS_RUNNER=off: booting the app here must not start a second job runner.');
  }
  const [{ NestFactory }, { AppModule }, { PlatformBillingDailyCheck }] = await Promise.all([
    import('@nestjs/core'),
    import('../app.module.js'),
    import('@kwtech/module-platform-billing/server'),
  ]);
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  try {
    await app.init();
    const daily = app.get(PlatformBillingDailyCheck, { strict: false });
    const result = await daily.runForOrganization(organizationId, new Date());
    console.log(
      `Daily check for ${ORGANIZATION_NAME}: ${result.renewed ? 'renewed, ' : ''}${result.sent} notice(s) sent.`,
    );
  } finally {
    await app.close();
  }
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
    await clearBilling(prisma, organizationId);
    // Memberships, workspaces, roles and subscriptions cascade from the organization.
    await prisma.permOrganization.delete({ where: { id: organizationId } });
  }
  await removeTrialOrganizations(prisma);

  await clearOrphanedBillingNotices(prisma);
  await rewindNumbering(prisma);
  await restoreSettings(prisma, userIds);

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
 * The notices the tests' requests sent, to ANYBODY: the organization's own
 * (scoped to it, which reaches a super admin too) and the approvers' (global,
 * keyed by the request: `billing:request:<id>:approvers` in the app's
 * notifier). Approvers include the real platform staff of this database, and
 * a test run must not leave its requests in their inbox.
 *
 * Then any billing notice whose request no longer exists: requests are never
 * deleted in real use, so only a test's (an earlier run that died before this
 * cleanup, or runs before it existed) can be orphaned like that.
 */
async function clearBillingNotices(prisma: PrismaClient, organizationId: string): Promise<void> {
  const requests = await prisma.platformBillingRequest.findMany({ where: { organizationId }, select: { id: true } });
  const keys = requests.flatMap((request) => [
    `billing:request:${request.id}:approvers`,
    `billing:request:${request.id}:organization`,
  ]);
  await prisma.notificationItem.deleteMany({ where: { OR: [{ organizationId }, { groupKey: { in: keys } }] } });
  await clearOrphanedBillingNotices(prisma);
}

/** Billing notices about a request that no longer exists: only the tests delete requests. */
async function clearOrphanedBillingNotices(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.notificationItem.findMany({
    where: { groupKey: { startsWith: 'billing:request:' } },
    select: { id: true, groupKey: true },
  });
  const requestIdOf = (key: string | null) => key?.split(':')[2] ?? '';
  const ids = [...new Set(rows.map((row) => requestIdOf(row.groupKey)))];
  const existing = new Set(
    (await prisma.platformBillingRequest.findMany({ where: { id: { in: ids } }, select: { id: true } })).map(
      (request) => request.id,
    ),
  );
  const orphaned = rows.filter((row) => !existing.has(requestIdOf(row.groupKey))).map((row) => row.id);
  if (orphaned.length > 0) await prisma.notificationItem.deleteMany({ where: { id: { in: orphaned } } });
}

/**
 * Every billing row of the organization. In this order, each step's rows
 * referring only to rows a later step removes: they refer to each other with
 * `Restrict`, and none cascades from the organization (they hold its id as a
 * bare string).
 */
async function clearBilling(prisma: PrismaClient, organizationId: string): Promise<void> {
  await clearBillingNotices(prisma, organizationId);
  await prisma.platformBillingEvent.deleteMany({ where: { organizationId } });
  await prisma.platformBillingPayment.deleteMany({ where: { request: { organizationId } } });
  await prisma.platformBillingCredit.deleteMany({ where: { organizationId } });
  await prisma.platformBillingReceipt.deleteMany({ where: { organizationId } });
  await prisma.platformBillingBill.deleteMany({ where: { organizationId } });
  await prisma.platformBillingRequest.deleteMany({ where: { organizationId } });
  await prisma.platformBillingNotice.deleteMany({ where: { organizationId } });
  await prisma.platformBillingAutoRenew.deleteMany({ where: { organizationId } });
  await prisma.platformBillingLock.deleteMany({ where: { organizationId } });
}

/**
 * The organizations O14 created (`TRIAL_ORGANIZATION_KEY_PREFIX`), with their
 * billing rows: the owner's trial goes with them, since its row cascades from
 * the organization it was given to, so the next run's owner has it unused.
 */
async function removeTrialOrganizations(prisma: PrismaClient): Promise<void> {
  const created = await prisma.permOrganization.findMany({
    where: { key: { startsWith: TRIAL_ORGANIZATION_KEY_PREFIX } },
    select: { id: true },
  });
  // One at a time: each clears rows that refer to each other, in order.
  for (const { id } of created) {
    await clearBilling(prisma, id);
    await prisma.permOrganization.delete({ where: { id } });
  }
}

/**
 * The organization on Free, as `startDefaultSubscription` writes it for an
 * organization that gets no trial, and with NO `trialUserId`: the owner's
 * trial is unused, which the trial case (O14) depends on. Every subscription
 * row it had goes first, ended ones too, so a used trial is forgotten.
 */
async function startOnFree(prisma: PrismaClient, organizationId: string): Promise<void> {
  const periodEnd = new Date(Date.now() + FREE_PERIOD_DAYS * 86_400_000);
  await prisma.permSubscription.deleteMany({ where: { organizationId } });
  await prisma.permSubscription.create({
    data: {
      organizationId,
      planKey: FREE_PLAN_KEY,
      status: 'active',
      currentPeriodEnd: periodEnd,
      accessUntil: unbilledAccessUntil(periodEnd),
      // The live slot: one live organization-wide row per organization.
      liveOrganizationId: organizationId,
    },
  });
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
  const organization = await prisma.permOrganization.create({
    data: {
      key: ORGANIZATION_KEY,
      name: ORGANIZATION_NAME,
      description: 'Made by the billing browser tests (#178); removed by e2e:billing teardown.',
      workspaces: { create: { key: WORKSPACE_KEY, name: WORKSPACE_NAME } },
    },
    select: { id: true, workspaces: { select: { id: true } } },
  });
  const workspaceId = organization.workspaces[0]?.id;
  if (!workspaceId) throw new Error('The organization was created without its workspace.');
  await startOnFree(prisma, organization.id);
  await useTestSettings(prisma);

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
  if (!command || !['setup', 'reset', 'period', 'daily', 'teardown'].includes(command)) {
    throw new Error('Say what to do: e2e:billing setup | reset | period --ends=<days> | daily | teardown');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  try {
    if (command === 'setup') await setup(prisma);
    if (command === 'reset') await reset(prisma);
    if (command === 'period') await movePeriod(prisma, process.argv.slice(3));
    if (command === 'daily') {
      const organization = await prisma.permOrganization.findUnique({ where: { key: ORGANIZATION_KEY } });
      if (!organization) throw new Error('No E2E Billing organization. Run e2e:billing setup first.');
      await runDailyCheck(organization.id);
    }
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
