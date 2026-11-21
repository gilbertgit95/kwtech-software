import { normaliseEmail, normaliseUsername } from '@kwtech/module-auth';
import { grantAppRole, PermissionsService, PermissionsWriteService } from '@kwtech/module-permissions/server';
import { env } from '../config/env.js';
import type { PrismaClient } from '../generated/client.js';
import { seedUser } from '../seed/seeders/first-user.js';
import {
  checkEmail,
  checkKey,
  checkName,
  checkNewInstall,
  checkNewPassword,
  checkUsername,
  OWNER_ROLE_KEY,
  orderOrganizationRoles,
  type SetupAnswers,
  type SetupMember,
  type SetupPerson,
  type SetupRole,
  suggestKey,
  summaryLines,
} from './first-setup-plan.js';
import { askChecked, askYesNo, createPrompter, type Prompter } from './prompts.js';

/**
 * `pnpm --filter @kwtech/web-server first-setup`: a new install's first
 * organization, workspace and people (#206, #133 P0c).
 *
 * ## Why it boots the app
 *
 * The organization, the workspace and every role go through
 * `PermissionsWriteService` acting as the OWNER, the same path and the same
 * checks as the app's own pages: the founder role, the default plan and the
 * trial (`createOrganization`), the organizations cap, who may grant which
 * role. Raw inserts would make an organization no page could have made.
 * Accounts use `seedUser`, the seeders' path (the same hash and policy).
 *
 * ⚠ So the job runner must be off in this process (`JOBS_RUNNER=off`, set by
 * the package script): a second runner beside a running API would run every
 * background process twice.
 *
 * ## Why it refuses on a set-up install
 *
 * It creates a super admin and an owner from typed answers. Run on a live
 * install it would add a second shop, or hand platform powers to whoever is
 * at the keyboard. `checkNewInstall` refuses once any organization or super
 * admin exists.
 *
 * ## Not one transaction
 *
 * Each permissions write opens its own transaction, as it does in the app.
 * So everything is checked BEFORE the first write (the summary is confirmed
 * last), and a failure part-way removes what this run made: the organization
 * (its memberships, workspace and roles cascade) and the accounts.
 */

/** The platform's own role, given only to the super admin this script makes. */
const SUPER_ADMIN_ROLE_KEY = 'super-admin';

interface Services {
  prisma: PrismaClient;
  permissions: PermissionsService;
  writes: PermissionsWriteService;
}

/** System roles (no organization) at one level, not disabled. */
async function systemRoles(prisma: PrismaClient, level: 'organization' | 'workspace'): Promise<SetupRole[]> {
  return prisma.permRole.findMany({
    where: { organizationId: null, level, disabledAt: null },
    select: { id: true, key: true, label: true },
    orderBy: { label: 'asc' },
  });
}

/** The app role every new account gets (`account.app_role`, else `normal-user`). */
async function accountRoleId(prisma: PrismaClient): Promise<string> {
  const stored = await prisma.permDefault.findUnique({ where: { key: 'account.app_role' }, select: { value: true } });
  if (stored?.value) return stored.value;
  const role = await prisma.permRole.findFirst({
    where: { organizationId: null, level: 'app', key: 'normal-user' },
    select: { id: true },
  });
  if (!role)
    throw new Error('No normal-user role. Sync the reference data first: pnpm --filter @kwtech/web-server db:sync.');
  return role.id;
}

/** Name, email, username and password, each checked as it is answered. */
async function askPerson(
  prompter: Prompter,
  heading: string,
  taken: { emails: Set<string>; usernames: Set<string> },
): Promise<SetupPerson> {
  prompter.say();
  prompter.say(heading);
  const displayName = await askChecked(prompter, '  Name', checkName);
  const email = await askChecked(prompter, '  Email', (value) => checkEmail(value, taken.emails));
  const suggested = suggestKey(normaliseEmail(email).split('@')[0] ?? '').replace(/-/g, '.');
  const username = await askChecked(
    prompter,
    '  Username',
    (value) => checkUsername(value, taken.usernames),
    suggested || undefined,
  );
  let password = '';
  for (;;) {
    password = await prompter.askHidden('  Password');
    const refusal = checkNewPassword(password);
    if (refusal) {
      if (!prompter.interactive) throw new Error(`Password for ${displayName}: ${refusal}`);
      prompter.say(`  ✗ ${refusal}`);
      continue;
    }
    const again = await prompter.askHidden('  Password again');
    if (again === password) break;
    if (!prompter.interactive) throw new Error(`Password for ${displayName}: the two passwords differ.`);
    prompter.say('  ✗ The two passwords differ. Type it again.');
  }
  taken.emails.add(normaliseEmail(email));
  taken.usernames.add(normaliseUsername(username));
  return { displayName: displayName.trim(), email, username, password };
}

/** The workspace role for one person, by number; the last choice is none. */
async function askWorkspaceRole(
  prompter: Prompter,
  workspaceName: string,
  roles: readonly SetupRole[],
  fallbackKey: string | null,
): Promise<SetupRole | null> {
  const choices = roles.map((role, index) => `${index + 1}) ${role.label}`);
  const none = roles.length + 1;
  choices.push(`${none}) none`);
  const fallbackIndex = fallbackKey ? roles.findIndex((role) => role.key === fallbackKey) : -1;
  const fallback = String(fallbackIndex >= 0 ? fallbackIndex + 1 : none);
  const answer = await askChecked(
    prompter,
    `  Role in ${workspaceName}: ${choices.join(', ')}`,
    (value) => {
      const n = Number(value);
      return Number.isInteger(n) && n >= 1 && n <= none ? null : `Answer a number from 1 to ${none}.`;
    },
    fallback,
  );
  return roles[Number(answer) - 1] ?? null;
}

/** Every question, in the order #133 P0c gives. Nothing is written here. */
async function askEverything(prompter: Prompter, services: Services): Promise<SetupAnswers> {
  const { prisma } = services;
  const [organizationRoles, workspaceRoles, users] = await Promise.all([
    systemRoles(prisma, 'organization'),
    systemRoles(prisma, 'workspace'),
    prisma.authUser.findMany({ select: { email: true, username: true } }),
  ]);
  const ordered = orderOrganizationRoles(organizationRoles);
  if (ordered[0]?.key !== OWNER_ROLE_KEY) {
    throw new Error(
      'No Organization owner role. Sync the reference data first: pnpm --filter @kwtech/web-server db:sync.',
    );
  }
  const taken = {
    emails: new Set(users.map((user) => user.email)),
    usernames: new Set(users.flatMap((user) => (user.username ? [user.username] : []))),
  };

  const organizationName = await askChecked(prompter, 'Organization name', checkName);
  const organizationKey = await askChecked(
    prompter,
    'Organization key',
    checkKey,
    suggestKey(organizationName) || undefined,
  );
  const workspaceName = await askChecked(prompter, 'First workspace name', checkName);
  const workspaceKey = await askChecked(prompter, 'Workspace key', checkKey, suggestKey(workspaceName) || undefined);

  const superAdmin = await askPerson(
    prompter,
    'The super admin (platform staff, not a member of the organization)',
    taken,
  );

  const members: SetupMember[] = [];
  for (const role of ordered) {
    const required = role.key === OWNER_ROLE_KEY;
    if (!required) {
      prompter.say();
      if (!(await askYesNo(prompter, `Create an initial user for ${role.label}?`, false))) continue;
    }
    for (;;) {
      const heading = required ? `${role.label} (required: founds ${organizationName})` : role.label;
      const person = await askPerson(prompter, heading, taken);
      const workspaceRole = await askWorkspaceRole(
        prompter,
        workspaceName,
        workspaceRoles,
        required ? 'workspace-admin' : 'workspace-user',
      );
      members.push({ ...person, organizationRole: role, workspaceRole });
      if (required) break;
      if (!(await askYesNo(prompter, `Add another ${role.label}?`, false))) break;
    }
  }

  return {
    organization: { name: organizationName.trim(), key: organizationKey },
    workspace: { name: workspaceName.trim(), key: workspaceKey },
    superAdmin,
    members,
  };
}

/** Loads a person's permission context at a scope, or says why it could not. */
async function contextOf(services: Services, userId: string, organizationId?: string) {
  const context = await services.permissions.loadContext(userId, organizationId ? { organizationId } : {});
  if (!context) throw new Error('Could not load the owner’s permissions after creating them.');
  return context;
}

/** Writes everything, in order; on a failure, removes what it made and rethrows. */
async function apply(services: Services, answers: SetupAnswers): Promise<{ organizationId: string }> {
  const { prisma, writes } = services;
  const createdUsers: string[] = [];
  let organizationId: string | null = null;
  try {
    const appRoleId = await accountRoleId(prisma);
    // One at a time: each account is a transaction of its own, and the order shows in the log.
    const superAdmin = await seedUser(prisma, answers.superAdmin);
    createdUsers.push(superAdmin.id);
    // ⚠ Only super-admin: a person holds ONE app role, and super-admin carries normal-user's keys (#175).
    await grantAppRole(prisma, { userId: superAdmin.id, roleKey: SUPER_ADMIN_ROLE_KEY });

    const ids: string[] = [];
    for (const member of answers.members) {
      const user = await seedUser(prisma, member);
      createdUsers.push(user.id);
      ids.push(user.id);
      await prisma.permUserRole.create({ data: { userId: user.id, roleId: appRoleId } });
    }

    const [owner, ...others] = answers.members;
    const [ownerId, ...otherIds] = ids;
    if (!owner || !ownerId) throw new Error('No owner to found the organization.');

    // The owner founds it: membership, founder role, default plan, the trial if offered.
    const founded = await writes.createOrganization(await contextOf(services, ownerId), {
      key: answers.organization.key,
      name: answers.organization.name,
    });
    organizationId = founded.organizationId;
    const ownerContext = await contextOf(services, ownerId, organizationId);

    // The founder role is a default (`organization.founder_role`): make sure it is the owner role chosen.
    await writes.assignRole(ownerContext, { organizationId, userId: ownerId, roleId: owner.organizationRole.id });
    const { workspaceId } = await writes.createWorkspace(ownerContext, {
      organizationId,
      key: answers.workspace.key,
      name: answers.workspace.name,
    });
    await setWorkspaceRole(
      services,
      ownerContext,
      { organizationId, workspaceId, userId: ownerId },
      owner.workspaceRole,
      true,
    );

    for (const [index, member] of others.entries()) {
      const userId = otherIds[index];
      if (!userId) continue;
      await writes.addMember(ownerContext, { organizationId, userId });
      await writes.assignRole(ownerContext, { organizationId, userId, roleId: member.organizationRole.id });
      if (member.workspaceRole) {
        await writes.shareWorkspace(ownerContext, { organizationId, workspaceId, userId });
        await setWorkspaceRole(
          services,
          ownerContext,
          { organizationId, workspaceId, userId },
          member.workspaceRole,
          true,
        );
      }
    }
    return { organizationId };
  } catch (error) {
    await undo(prisma, organizationId, createdUsers);
    throw error;
  }
}

/**
 * Gives `role` in the workspace, or takes away whatever role the person was
 * given on joining when `role` is null (the creator's default for the owner).
 */
async function setWorkspaceRole(
  services: Services,
  context: Awaited<ReturnType<typeof contextOf>>,
  target: { organizationId: string; workspaceId: string; userId: string },
  role: SetupRole | null,
  joined: boolean,
): Promise<void> {
  if (role) {
    await services.writes.assignWorkspaceRole(context, { ...target, roleId: role.id });
    return;
  }
  if (!joined) return;
  const membership = await services.prisma.permMembership.findFirst({
    where: { organizationId: target.organizationId, userId: target.userId },
    select: {
      workspaces: { where: { workspaceId: target.workspaceId }, select: { roles: { select: { roleId: true } } } },
    },
  });
  for (const grant of membership?.workspaces[0]?.roles ?? []) {
    await services.writes.revokeWorkspaceRole(context, { ...target, roleId: grant.roleId });
  }
}

/** Removes this run's organization and accounts, after a failure part-way. */
async function undo(prisma: PrismaClient, organizationId: string | null, userIds: readonly string[]): Promise<void> {
  try {
    // Memberships, workspaces, roles and subscriptions cascade from the organization.
    if (organizationId) await prisma.permOrganization.deleteMany({ where: { id: organizationId } });
    if (userIds.length > 0) {
      // App roles hold the user's id as a bare string: nothing cascades to them.
      await prisma.permUserRole.deleteMany({ where: { userId: { in: [...userIds] } } });
      // Credentials and sessions cascade from the account.
      await prisma.authUser.deleteMany({ where: { id: { in: [...userIds] } } });
    }
  } catch (error) {
    console.error('⚠ Could not remove everything this run made:', error instanceof Error ? error.message : error);
  }
}

async function main(): Promise<void> {
  if (env.JOBS_RUNNER !== 'off') {
    throw new Error(
      'Run it with JOBS_RUNNER=off (the package script sets it): booting the app here must not start a second job runner.',
    );
  }
  const prompter = createPrompter();
  const [{ NestFactory }, { AppModule }, { PrismaService }] = await Promise.all([
    import('@nestjs/core'),
    import('../app.module.js'),
    import('../prisma/prisma.service.js'),
  ]);
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  try {
    await app.init();
    const services: Services = {
      prisma: app.get(PrismaService, { strict: false }),
      permissions: app.get(PermissionsService, { strict: false }),
      writes: app.get(PermissionsWriteService, { strict: false }),
    };

    const [organizations, superAdmins] = await Promise.all([
      services.prisma.permOrganization.count(),
      services.prisma.permUserRole.count({ where: { role: { key: SUPER_ADMIN_ROLE_KEY, organizationId: null } } }),
    ]);
    const refusal = checkNewInstall({ organizations, superAdmins });
    if (refusal) throw new Error(refusal);

    prompter.say('First setup: the organization, its first workspace, and the first people.');
    prompter.say('Nothing is written until you confirm the summary at the end.');
    prompter.say();
    const answers = await askEverything(prompter, services);

    prompter.say();
    prompter.say('Summary');
    for (const line of summaryLines(answers)) prompter.say(`  ${line}`);
    prompter.say();
    if (!(await askYesNo(prompter, 'Create all of this?', false))) {
      prompter.say('Stopped. Nothing was written.');
      return;
    }

    await apply(services, answers);
    prompter.say();
    prompter.say(`✓ ${answers.organization.name} is set up. Sign in at ${env.FRONTEND_URL}.`);
  } finally {
    prompter.close();
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
