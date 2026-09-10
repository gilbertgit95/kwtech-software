import { APP_DEFAULT } from '../src/defaults.js';
import { composeContext } from '../src/domain/grants.js';
import { LIMIT } from '../src/domain/limits.js';
import {
  assertNotAppLevel,
  assertRoleAssignable,
  assertRoleDefinable,
  PermissionWriteError,
} from '../src/domain/writes.js';
import { FEATURE, FEATURE_REGISTRY } from '../src/feature-keys.js';
import type { PermissionsWriteClient } from '../src/server/permissions.repository.js';
import { PermissionsWriteService } from '../src/server/permissions-write.service.js';
import type { PermissionContext } from '../src/types.js';

/**
 * M4 — the write path, and the three findings that could not be closed without
 * it: H1 (capacity advisory), C3 (cross-tenant grants writable), and
 * assertRoleFeatureLevels being exported and called by nothing.
 *
 * As with the read side, the structural client means no database: the fake
 * below records every call, so "did it refuse BEFORE writing" is testable and
 * not merely "did it throw".
 */

interface State {
  /**
   * `status` is OPTIONAL and absent means 'active'.
   *
   * Almost every test here is about something else and would have to opt into a
   * status it does not care about; defaulting keeps those unchanged while
   * letting the few that DO care — leaving as a suspended member, and the seat
   * counts that ignore one — say so.
   */
  memberships: { id: string; userId: string; organizationId: string; status?: string }[];
  workspaces: { id: string; organizationId: string; archivedAt: Date | null }[];
  workspaceMembers: { id: string; membershipId: string; workspaceId: string }[];
  membershipRoles: { membershipId: string; roleId: string }[];
  workspaceMemberRoles: { workspaceMemberId: string; roleId: string }[];
  roles: { id: string; key: string; label: string; level: string; organizationId: string | null }[];
  /** App-level grants, so the baseline default has something to check. */
  userRoles: { userId: string; role: Record<string, unknown> }[];
  organizations: { id: string; key: string; name: string; description?: string | null }[];
  invitations: {
    id: string;
    organizationId: string;
    email: string;
    roleId: string | null;
    invitedByUserId: string;
    tokenHash: string;
    status: string;
    expiresAt: Date;
  }[];
  plans: { key: string; label: string; isPublic: boolean; icon: string | null; archivedAt: Date | null }[];
  planFeatures: { planKey: string; featureKey: string }[];
  planLimits: { planKey: string; limitKey: string; value: number }[];
  /** Makes the fake host's mailer throw, for the delivery-failure case. */
  mailFails?: boolean;
  subscriptions: {
    id: string;
    organizationId: string;
    workspaceId: string | null;
    planKey: string;
    status: string;
    endedAt: Date | null;
  }[];
  /**
   * The platform's defaults, as stored.
   *
   * Empty in `emptyState`, which is the state every existing test here was
   * written against: unset defaults grant nothing, so every creation path
   * behaves exactly as it did before the table existed. A test that wants a
   * default applied says so.
   */
  defaults: { key: string; value: string | null }[];
}

const emptyState = (over: Partial<State> = {}): State => ({
  memberships: [],
  workspaces: [],
  workspaceMembers: [],
  membershipRoles: [],
  workspaceMemberRoles: [],
  roles: [],
  userRoles: [],
  /*
   * The tenant these tests act in.
   *
   * Not empty, despite the helper's name: `requireOrganization` refuses a write
   * naming an organization that does not exist, so a fake with no tenants would
   * make every addMember and createWorkspace fail for a reason the test is not
   * about. A test that wants the refusal passes `organizations: []` explicitly.
   */
  organizations: [{ id: 'org1', key: 'acme', name: 'Acme', description: null }],
  invitations: [],
  plans: [],
  planFeatures: [],
  planLimits: [],
  subscriptions: [],
  defaults: [],
  ...over,
});

/** Records writes so a refusal can be shown to have happened before one. */
interface Writes {
  organizations: unknown[];
  memberships: unknown[];
  userRoles: { userId: string; roleId: string }[];
  workspaces: unknown[];
  workspaceMembers: unknown[];
  membershipRoles: unknown[];
  workspaceMemberRoles: unknown[];
  plans: unknown[];
  planFeatures: unknown[];
  planLimits: unknown[];
  subscriptions: unknown[];
  defaults: { key: string; value: string | null }[];
  invitations: unknown[];
  /** Every invitation email the fake host was asked to send. */
  sent: { email: string; token: string; organization: { id: string; key: string; name: string } | null }[];
  transactions: number;
}

/** Absent means active — see `State.memberships`. */
const isActive = (membership: { status?: string }) => (membership.status ?? 'active') === 'active';

function fake(state: State = emptyState(), moduleOptions: { defaultAppRoleKey?: string } = {}) {
  const writes: Writes = {
    organizations: [],
    memberships: [],
    userRoles: [],
    workspaces: [],
    workspaceMembers: [],
    membershipRoles: [],
    workspaceMemberRoles: [],
    plans: [],
    planFeatures: [],
    planLimits: [],
    subscriptions: [],
    invitations: [],
    defaults: [],
    sent: [],
    transactions: 0,
  };
  let seq = 0;
  const id = (prefix: string) => `${prefix}${++seq}`;

  const client = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      writes.transactions += 1;
      return fn(client);
    },
    permOrganization: {
      findFirst: async (args: { where: { id: string } }) =>
        state.organizations.find((o) => o.id === args.where.id) ?? null,
      updateMany: async (args: { where: { id: string }; data: { key: string; name: string } }) => {
        const row = state.organizations.find((org) => org.id === args.where.id);
        if (!row) return { count: 0 };
        Object.assign(row, args.data);
        writes.organizations.push(args.data);
        return { count: 1 };
      },
      create: async (args: { data: { key: string; name: string } }) => {
        writes.organizations.push(args.data);
        const row = { id: id('org'), key: args.data.key, name: args.data.name };
        state.organizations.push(row);
        return row;
      },
    },
    permMembership: {
      /*
       * `status: 'active'` is honoured rather than ignored, which it was until
       * `leaveOrganization` had to tell an active member from a suspended one.
       * A fake that dropped the filter would make the seat counts agree with
       * the code by accident — and the one behaviour that depends on the
       * difference is exactly the one it would stop testing.
       */
      findFirst: async (args: { where: { userId: string; organizationId?: string; status?: 'active' } }) => {
        const row = state.memberships.find(
          (m) =>
            m.userId === args.where.userId &&
            (!args.where.organizationId || m.organizationId === args.where.organizationId) &&
            (args.where.status === undefined || isActive(m)),
        );
        return row ? { ...row, roles: [], workspaces: [] } : null;
      },
      count: async (args: { where: { organizationId?: string; userId?: string; status?: 'active' } }) =>
        state.memberships.filter(
          (m) =>
            (args.where.organizationId === undefined || m.organizationId === args.where.organizationId) &&
            (args.where.userId === undefined || m.userId === args.where.userId) &&
            (args.where.status === undefined || isActive(m)),
        ).length,
      create: async (args: { data: { userId: string; organizationId: string; status: 'active' } }) => {
        writes.memberships.push(args.data);
        const row = { id: id('m'), ...args.data };
        state.memberships.push(row);
        return { id: row.id };
      },
      deleteMany: async (args: { where: { userId: string; organizationId: string } }) => {
        const before = state.memberships.length;
        state.memberships = state.memberships.filter(
          (m) => !(m.userId === args.where.userId && m.organizationId === args.where.organizationId),
        );
        return { count: before - state.memberships.length };
      },
    },
    permWorkspace: {
      findFirst: async (args: { where: { id: string; organizationId: string } }) => {
        const row = state.workspaces.find(
          (w) => w.id === args.where.id && w.organizationId === args.where.organizationId && w.archivedAt === null,
        );
        return row ? { id: row.id } : null;
      },
      count: async (args: { where: { organizationId: string } }) =>
        state.workspaces.filter((w) => w.organizationId === args.where.organizationId && w.archivedAt === null).length,
      create: async (args: { data: { organizationId: string; key: string; name: string } }) => {
        writes.workspaces.push(args.data);
        const row = { id: id('ws'), organizationId: args.data.organizationId, archivedAt: null };
        state.workspaces.push(row);
        return { id: row.id };
      },
      updateMany: async (args: { where: { id: string; organizationId: string }; data: { archivedAt: Date } }) => {
        const row = state.workspaces.find(
          (w) => w.id === args.where.id && w.organizationId === args.where.organizationId,
        );
        if (!row) return { count: 0 };
        row.archivedAt = args.data.archivedAt;
        return { count: 1 };
      },
    },
    permWorkspaceMember: {
      findFirst: async (args: { where: { membershipId: string; workspaceId: string } }) => {
        const row = state.workspaceMembers.find(
          (w) => w.membershipId === args.where.membershipId && w.workspaceId === args.where.workspaceId,
        );
        return row ? { ...row, roles: [] } : null;
      },
      count: async (args: { where: { workspaceId: string } }) =>
        state.workspaceMembers.filter((w) => w.workspaceId === args.where.workspaceId).length,
      create: async (args: { data: { membershipId: string; workspaceId: string } }) => {
        writes.workspaceMembers.push(args.data);
        const row = { id: id('wm'), ...args.data };
        state.workspaceMembers.push(row);
        return { id: row.id };
      },
      deleteMany: async (args: { where: { membershipId: string; workspaceId: string } }) => {
        const before = state.workspaceMembers.length;
        state.workspaceMembers = state.workspaceMembers.filter(
          (w) => !(w.membershipId === args.where.membershipId && w.workspaceId === args.where.workspaceId),
        );
        return { count: before - state.workspaceMembers.length };
      },
    },
    permRole: {
      // By id everywhere, and by KEY for the baseline lookup — the app names
      // its seeded default by key, because an id differs between databases.
      /*
       * The LEVEL and `organizationId` clauses are applied, not ignored.
       *
       * They arrived with the platform defaults, where they are the whole
       * safety: a tenant-defined role as the founder default would try to grant
       * every new organization a role belonging to another company, and a role
       * at the wrong level would be granted and then filtered out by the
       * resolution order. A fake that matched on id alone would pass whichever
       * of those the service failed to check.
       */
      findFirst: async (args: {
        where: { id?: string; key?: string; level?: string; organizationId?: null; disabledAt?: null };
      }) =>
        state.roles.find(
          (r) =>
            (args.where.id === undefined || r.id === args.where.id) &&
            (args.where.key === undefined || r.key === args.where.key) &&
            (args.where.level === undefined || r.level === args.where.level) &&
            (args.where.organizationId === undefined || r.organizationId === null),
        ) ?? null,
    },
    permMembershipRole: {
      findFirst: async (args: { where: { membershipId: string; roleId: string } }) =>
        state.membershipRoles.find(
          (r) => r.membershipId === args.where.membershipId && r.roleId === args.where.roleId,
        ) ?? null,
      create: async (args: { data: { membershipId: string; roleId: string } }) => {
        writes.membershipRoles.push(args.data);
        state.membershipRoles.push(args.data);
        return {};
      },
      deleteMany: async (args: { where: { membershipId: string; roleId?: string } }) => {
        const before = state.membershipRoles.length;
        // `roleId` optional — omitted, this clears whatever the member holds,
        // which is what makes assignRole a replacement.
        state.membershipRoles = state.membershipRoles.filter(
          (r) =>
            !(
              r.membershipId === args.where.membershipId &&
              (args.where.roleId === undefined || r.roleId === args.where.roleId)
            ),
        );
        return { count: before - state.membershipRoles.length };
      },
    },
    permWorkspaceMemberRole: {
      findFirst: async (args: { where: { workspaceMemberId: string; roleId: string } }) =>
        state.workspaceMemberRoles.find(
          (r) => r.workspaceMemberId === args.where.workspaceMemberId && r.roleId === args.where.roleId,
        ) ?? null,
      create: async (args: { data: { workspaceMemberId: string; roleId: string } }) => {
        writes.workspaceMemberRoles.push(args.data);
        state.workspaceMemberRoles.push(args.data);
        return {};
      },
      deleteMany: async (args: { where: { workspaceMemberId: string; roleId?: string } }) => {
        const before = state.workspaceMemberRoles.length;
        // `roleId` optional — omitted, this clears whatever they hold, which is
        // what makes assignWorkspaceRole a replacement.
        state.workspaceMemberRoles = state.workspaceMemberRoles.filter(
          (r) =>
            !(
              r.workspaceMemberId === args.where.workspaceMemberId &&
              (args.where.roleId === undefined || r.roleId === args.where.roleId)
            ),
        );
        return { count: before - state.workspaceMemberRoles.length };
      },
    },
    /*
     * What a role carries, read by the no-escalation checks in `assignAppRole`
     * and `inviteUser`. Empty for these fixtures, which is the point: a role
     * granting nothing is one any granter may hand out, so the tests exercise
     * the REPLACEMENT rule rather than the escalation rule.
     */
    permRoleFeature: { findMany: async () => [] },
    permUserRole: {
      findMany: async () => state.userRoles.map((row) => ({ userId: row.userId, role: row.role })),
      create: async (args: { data: { userId: string; roleId: string } }) => {
        writes.userRoles.push(args.data);
        const role = state.roles.find((r) => r.id === args.data.roleId);
        state.userRoles.push({
          userId: args.data.userId,
          role: {
            id: args.data.roleId,
            key: role?.key ?? args.data.roleId,
            label: role?.label ?? args.data.roleId,
            level: role?.level ?? 'app',
            icon: null,
            features: [],
            limits: [],
          },
        });
        return {};
      },
      deleteMany: async (args: { where: { userId: string } }) => {
        const before = state.userRoles.length;
        state.userRoles = state.userRoles.filter((row) => row.userId !== args.where.userId);
        return { count: before - state.userRoles.length };
      },
    },
    permPlan: {
      findMany: async () =>
        state.plans.map((plan) => ({ ...plan, features: [], limits: [] })).sort((a, b) => a.key.localeCompare(b.key)),
      findFirst: async (args: { where: { key: string } }) => state.plans.find((p) => p.key === args.where.key) ?? null,
      create: async (args: { data: { key: string; label: string; isPublic: boolean; icon: string | null } }) => {
        writes.plans.push(args.data);
        const row = { ...args.data, archivedAt: null };
        state.plans.push(row);
        return { key: row.key };
      },
      update: async (args: {
        where: { key: string };
        data: { label?: string; isPublic?: boolean; icon?: string | null; archivedAt?: Date | null };
      }) => {
        const row = state.plans.find((p) => p.key === args.where.key);
        if (!row) throw new Error('no such plan');
        Object.assign(row, args.data);
        writes.plans.push(args.data);
        return { key: row.key };
      },
    },
    permPlanFeature: {
      findMany: async (args: { where: { planKey: string } }) =>
        state.planFeatures.filter((f) => f.planKey === args.where.planKey).map((f) => ({ featureKey: f.featureKey })),
      deleteMany: async (args: { where: { planKey: string; featureKey?: { notIn: string[] } } }) => {
        const before = state.planFeatures.length;
        const keep = args.where.featureKey?.notIn ?? [];
        state.planFeatures = state.planFeatures.filter(
          (f) => f.planKey !== args.where.planKey || keep.includes(f.featureKey),
        );
        return { count: before - state.planFeatures.length };
      },
      createMany: async (args: { data: { planKey: string; featureKey: string }[] }) => {
        writes.planFeatures.push(...args.data);
        for (const row of args.data) {
          if (!state.planFeatures.some((f) => f.planKey === row.planKey && f.featureKey === row.featureKey)) {
            state.planFeatures.push(row);
          }
        }
        return { count: args.data.length };
      },
    },
    permPlanLimit: {
      deleteMany: async (args: { where: { planKey: string; limitKey?: { notIn: string[] } } }) => {
        const before = state.planLimits.length;
        const keep = args.where.limitKey?.notIn ?? [];
        state.planLimits = state.planLimits.filter(
          (l) => l.planKey !== args.where.planKey || keep.includes(l.limitKey),
        );
        return { count: before - state.planLimits.length };
      },
      upsert: async (args: { create: { planKey: string; limitKey: string; value: number } }) => {
        writes.planLimits.push(args.create);
        const found = state.planLimits.find(
          (l) => l.planKey === args.create.planKey && l.limitKey === args.create.limitKey,
        );
        if (found) found.value = args.create.value;
        else state.planLimits.push({ ...args.create });
        return {};
      },
    },
    permDefault: {
      findMany: async () => state.defaults.map((row) => ({ ...row, updatedAt: new Date(), updatedByUserId: null })),
      upsert: async (args: { where: { key: string }; create: { key: string; value: string | null } }) => {
        writes.defaults.push({ key: args.where.key, value: args.create.value });
        return { key: args.where.key };
      },
    },
    permSubscription: {
      findMany: async () => [],
      findFirst: async (args: {
        where: { id?: string; organizationId?: string; workspaceId?: string | null; planKey?: string; endedAt?: null };
      }) =>
        state.subscriptions.find(
          (sub) =>
            (args.where.id === undefined || sub.id === args.where.id) &&
            (args.where.organizationId === undefined || sub.organizationId === args.where.organizationId) &&
            (args.where.workspaceId === undefined || sub.workspaceId === args.where.workspaceId) &&
            (args.where.planKey === undefined || sub.planKey === args.where.planKey) &&
            (args.where.endedAt === undefined || sub.endedAt === null),
        ) ?? null,
      create: async (args: {
        data: {
          organizationId: string;
          workspaceId: string | null;
          planKey: string;
          status: string;
          currentPeriodEnd: Date | null;
        };
      }) => {
        writes.subscriptions.push(args.data);
        const row = { id: id('sub'), ...args.data, endedAt: null };
        state.subscriptions.push(row);
        return { id: row.id };
      },
      update: async (args: {
        where: { id: string };
        data: { status?: string; currentPeriodEnd?: Date | null; endedAt?: Date | null };
      }) => {
        const row = state.subscriptions.find((sub) => sub.id === args.where.id);
        if (!row) throw new Error('no such subscription');
        Object.assign(row, args.data);
        writes.subscriptions.push(args.data);
        return { id: row.id };
      },
    },
    permInvitation: {
      findFirst: async (args: {
        where: { id?: string; tokenHash?: string; organizationId?: string; status?: string };
      }) => {
        const row = state.invitations.find(
          (inv) =>
            (args.where.id === undefined || inv.id === args.where.id) &&
            (args.where.tokenHash === undefined || inv.tokenHash === args.where.tokenHash) &&
            (args.where.organizationId === undefined || inv.organizationId === args.where.organizationId) &&
            (args.where.status === undefined || inv.status === args.where.status),
        );
        if (!row) return null;
        const organization = state.organizations.find((org) => org.id === row.organizationId);
        const role = state.roles.find((r) => r.id === row.roleId);
        return {
          ...row,
          organization: { key: organization?.key ?? '', name: organization?.name ?? '' },
          role: role ? { label: role.key } : null,
        };
      },
      findMany: async (args: { where: { organizationId: string; status: string } }) =>
        state.invitations.filter(
          (inv) => inv.organizationId === args.where.organizationId && inv.status === args.where.status,
        ),
      create: async (args: {
        data: {
          organizationId: string;
          email: string;
          roleId: string | null;
          invitedByUserId: string;
          tokenHash: string;
          expiresAt: Date;
        };
      }) => {
        writes.invitations.push(args.data);
        const row = { id: id('inv'), status: 'pending', ...args.data };
        state.invitations.push(row);
        return { id: row.id };
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = state.invitations.find((inv) => inv.id === args.where.id);
        if (!row) throw new Error('no such invitation');
        Object.assign(row, args.data);
        writes.invitations.push(args.data);
        return { id: row.id };
      },
    },
  } as unknown as PermissionsWriteClient;

  /*
   * A host that can deliver. `inviteMember` REFUSES without one — see the test
   * that constructs the service without options — so the default harness
   * supplies it and records what it was handed.
   */
  const options = {
    sendInvitationEmail: async (invite: {
      email: string;
      token: string;
      // Nullable since platform invitations landed: an invitation that names no
      // organization hands the hook a null rather than a placeholder.
      organization: { id: string; key: string; name: string } | null;
      appRole: { key: string; label: string } | null;
    }) => {
      if (state.mailFails) throw new Error('smtp is down');
      writes.sent.push({ email: invite.email, token: invite.token, organization: invite.organization });
    },
  };

  // `client` is handed back so a test can construct a service WITHOUT the
  // mailer, which is the configuration `inviteMember` refuses in.
  return { svc: new PermissionsWriteService(client, { ...options, ...moduleOptions }), client, writes, state };
}

const actor = (features: string[], limits: Record<string, number | null> = {}): PermissionContext => ({
  ...composeContext({
    subjectId: 'actor',
    organizationId: 'org1',
    workspaceId: 'ws1',
    roles: [{ roleKey: 'admin', level: 'organization', workspaceId: null, features }],
  }),
  limits: { [LIMIT.userOrganizations]: null, ...limits },
});

const reason = async (p: Promise<unknown>) => {
  try {
    await p;
    throw new Error('expected a refusal');
  } catch (error) {
    if (!(error instanceof PermissionWriteError)) throw error;
    return error.reason;
  }
};

describe('every write checks the actor, not just the guard in front of it', () => {
  // A worker, a CLI command and a seed script reach this service with no guard.
  // "The caller checked" is not a property this code can verify.
  it.each([
    [
      'addMember',
      (s: PermissionsWriteService, a: PermissionContext) => s.addMember(a, { organizationId: 'org1', userId: 'u2' }),
    ],
    [
      'removeMember',
      (s: PermissionsWriteService, a: PermissionContext) => s.removeMember(a, { organizationId: 'org1', userId: 'u2' }),
    ],
    [
      'assignRole',
      (s: PermissionsWriteService, a: PermissionContext) =>
        s.assignRole(a, { organizationId: 'org1', userId: 'u2', roleId: 'r1' }),
    ],
    [
      'createWorkspace',
      (s: PermissionsWriteService, a: PermissionContext) =>
        s.createWorkspace(a, { organizationId: 'org1', key: 'w', name: 'W' }),
    ],
    [
      'archiveWorkspace',
      (s: PermissionsWriteService, a: PermissionContext) =>
        s.archiveWorkspace(a, { organizationId: 'org1', workspaceId: 'ws1' }),
    ],
    [
      'shareWorkspace',
      (s: PermissionsWriteService, a: PermissionContext) =>
        s.shareWorkspace(a, { organizationId: 'org1', workspaceId: 'ws1', userId: 'u2' }),
    ],
    [
      'assignWorkspaceRole',
      (s: PermissionsWriteService, a: PermissionContext) =>
        s.assignWorkspaceRole(a, { organizationId: 'org1', workspaceId: 'ws1', userId: 'u2', roleId: 'r1' }),
    ],
  ])('%s refuses an actor holding nothing', async (_name, call) => {
    const { svc, writes } = fake();
    expect(await reason(call(svc, actor([])))).toBe('not_permitted');
    // Refused before any write, not rolled back after one.
    expect(writes.transactions).toBe(0);
  });
});

describe('H1 — capacity is enforced where the row is created', () => {
  it('refuses a member beyond the seat cap', async () => {
    const { svc, writes } = fake(emptyState({ memberships: [{ id: 'm1', userId: 'u1', organizationId: 'org1' }] }));

    const decision = await reason(
      svc.addMember(actor([FEATURE.membersInvite], { [LIMIT.organizationMembers]: 1 }), {
        organizationId: 'org1',
        userId: 'u2',
      }),
    );

    // 'at_capacity', never 'not_permitted': a full organization is not an
    // unauthorised one, and "access denied" sends the ticket to the wrong team.
    expect(decision).toBe('at_capacity');
    expect(writes.memberships).toHaveLength(0);
  });

  it('allows the member that exactly fills the cap', async () => {
    const { svc } = fake(emptyState({ memberships: [{ id: 'm1', userId: 'u1', organizationId: 'org1' }] }));
    await expect(
      svc.addMember(actor([FEATURE.membersInvite], { [LIMIT.organizationMembers]: 2 }), {
        organizationId: 'org1',
        userId: 'u2',
      }),
    ).resolves.toMatchObject({ membershipId: expect.any(String) });
  });

  it('refuses a workspace beyond the workspace cap, and counts only live ones', async () => {
    const { svc } = fake(
      emptyState({
        workspaces: [
          { id: 'ws1', organizationId: 'org1', archivedAt: null },
          { id: 'ws2', organizationId: 'org1', archivedAt: new Date(0) },
        ],
      }),
    );
    const a = actor([FEATURE.workspacesCreate], { [LIMIT.organizationWorkspaces]: 2 });

    // The archived one does not count, so this fits.
    await expect(svc.createWorkspace(a, { organizationId: 'org1', key: 'b', name: 'B' })).resolves.toBeDefined();
    // Now two live ones exist.
    expect(await reason(svc.createWorkspace(a, { organizationId: 'org1', key: 'c', name: 'C' }))).toBe('at_capacity');
  });

  it('refuses a share beyond the workspace-member cap', async () => {
    const { svc, writes } = fake(
      emptyState({
        memberships: [{ id: 'm2', userId: 'u2', organizationId: 'org1' }],
        workspaces: [{ id: 'ws1', organizationId: 'org1', archivedAt: null }],
        workspaceMembers: [{ id: 'wm1', membershipId: 'm1', workspaceId: 'ws1' }],
      }),
    );

    expect(
      await reason(
        svc.shareWorkspace(actor([FEATURE.workspaceMembersAdd], { [LIMIT.workspaceMembers]: 1 }), {
          organizationId: 'org1',
          workspaceId: 'ws1',
          userId: 'u2',
        }),
      ),
    ).toBe('at_capacity');
    expect(writes.workspaceMembers).toHaveLength(0);
  });

  it('caps organizations per user from the actor’s app-level role, with no subscription involved', async () => {
    const { svc } = fake(emptyState({ memberships: [{ id: 'm1', userId: 'actor', organizationId: 'orgA' }] }));

    expect(
      await reason(svc.createOrganization(actor([], { [LIMIT.userOrganizations]: 1 }), { key: 'b', name: 'B' })),
    ).toBe('at_capacity');
  });

  it('treats a null cap as unrestricted', async () => {
    const { svc } = fake();
    await expect(
      svc.addMember(actor([FEATURE.membersInvite], { [LIMIT.organizationMembers]: null }), {
        organizationId: 'org1',
        userId: 'u2',
      }),
    ).resolves.toBeDefined();
  });

  it('counts inside the transaction, so a founder counts against their own cap immediately', async () => {
    // createOrganization inserts the membership in the same transaction as the
    // organization; the next call must see it.
    const { svc, state } = fake();
    const a = actor([], { [LIMIT.userOrganizations]: 1 });

    await svc.createOrganization(a, { key: 'a', name: 'A' });
    expect(state.memberships).toHaveLength(1);
    expect(await reason(svc.createOrganization(a, { key: 'b', name: 'B' }))).toBe('at_capacity');
  });
});

describe('C3 write side — a foreign role is refused, not merely ignored', () => {
  const withRole = (level: string, organizationId: string | null) =>
    fake(
      emptyState({
        memberships: [{ id: 'm2', userId: 'u2', organizationId: 'org1' }],
        roles: [{ id: 'r1', key: 'their-admin', label: 'their-admin', level, organizationId }],
      }),
    );

  it('refuses a role defined by another organization', async () => {
    const { svc, writes } = withRole('organization', 'org2');

    expect(
      await reason(
        svc.assignRole(actor([FEATURE.membersAssignRole]), { organizationId: 'org1', userId: 'u2', roleId: 'r1' }),
      ),
    ).toBe('role_foreign_to_organization');
    // The read side would have discarded it; this stops the row existing at all.
    expect(writes.membershipRoles).toHaveLength(0);
  });

  it('accepts a shared preset, which belongs to no organization', async () => {
    const { svc } = withRole('organization', null);
    await expect(
      svc.assignRole(actor([FEATURE.membersAssignRole]), { organizationId: 'org1', userId: 'u2', roleId: 'r1' }),
    ).resolves.toEqual({ granted: true, replaced: false });
  });

  it('refuses an organization-level role attached at workspace level', async () => {
    const { svc } = fake(
      emptyState({
        memberships: [{ id: 'm2', userId: 'u2', organizationId: 'org1' }],
        workspaceMembers: [{ id: 'wm1', membershipId: 'm2', workspaceId: 'ws1' }],
        roles: [{ id: 'r1', key: 'billing', label: 'billing', level: 'organization', organizationId: 'org1' }],
      }),
    );

    expect(
      await reason(
        svc.assignWorkspaceRole(actor([FEATURE.workspaceAssignRole]), {
          organizationId: 'org1',
          workspaceId: 'ws1',
          userId: 'u2',
          roleId: 'r1',
        }),
      ),
    ).toBe('role_level_mismatch');
  });

  it('refuses a workspace-level role attached at organization level', async () => {
    const { svc } = withRole('workspace', 'org1');
    expect(
      await reason(
        svc.assignRole(actor([FEATURE.membersAssignRole]), { organizationId: 'org1', userId: 'u2', roleId: 'r1' }),
      ),
    ).toBe('role_level_mismatch');
  });

  it('refuses an app-level role through a membership — it belongs on PermUserRole', async () => {
    const { svc } = withRole('app', null);
    expect(
      await reason(
        svc.assignRole(actor([FEATURE.membersAssignRole]), { organizationId: 'org1', userId: 'u2', roleId: 'r1' }),
      ),
    ).toBe('role_level_mismatch');
  });

  it('validates the stored level rather than casting it', async () => {
    const { svc } = withRole('Organization', 'org1');
    await expect(
      svc.assignRole(actor([FEATURE.membersAssignRole]), { organizationId: 'org1', userId: 'u2', roleId: 'r1' }),
    ).rejects.toThrow(/Unknown role level/);
  });

  it('refuses an unknown role id', async () => {
    const { svc } = fake(emptyState({ memberships: [{ id: 'm2', userId: 'u2', organizationId: 'org1' }] }));
    expect(
      await reason(
        svc.assignRole(actor([FEATURE.membersAssignRole]), { organizationId: 'org1', userId: 'u2', roleId: 'nope' }),
      ),
    ).toBe('not_found');
  });
});

describe('tenancy — a write never crosses an organization boundary', () => {
  it('refuses to grant a role to a non-member', async () => {
    const { svc } = fake(
      emptyState({ roles: [{ id: 'r1', key: 'a', label: 'a', level: 'organization', organizationId: null }] }),
    );
    expect(
      await reason(
        svc.assignRole(actor([FEATURE.membersAssignRole]), {
          organizationId: 'org1',
          userId: 'stranger',
          roleId: 'r1',
        }),
      ),
    ).toBe('not_found');
  });

  it('refuses to share another organization’s workspace', async () => {
    const { svc } = fake(
      emptyState({
        memberships: [{ id: 'm2', userId: 'u2', organizationId: 'org1' }],
        workspaces: [{ id: 'wsX', organizationId: 'org2', archivedAt: null }],
      }),
    );

    expect(
      await reason(
        svc.shareWorkspace(actor([FEATURE.workspaceMembersAdd]), {
          organizationId: 'org1',
          workspaceId: 'wsX',
          userId: 'u2',
        }),
      ),
    ).toBe('not_found');
  });

  it('refuses to share an archived workspace', async () => {
    const { svc } = fake(
      emptyState({
        memberships: [{ id: 'm2', userId: 'u2', organizationId: 'org1' }],
        workspaces: [{ id: 'ws1', organizationId: 'org1', archivedAt: new Date(0) }],
      }),
    );

    expect(
      await reason(
        svc.shareWorkspace(actor([FEATURE.workspaceMembersAdd]), {
          organizationId: 'org1',
          workspaceId: 'ws1',
          userId: 'u2',
        }),
      ),
    ).toBe('not_found');
  });

  it('scopes archiving by organization as well as by id', async () => {
    const { svc } = fake(emptyState({ workspaces: [{ id: 'wsX', organizationId: 'org2', archivedAt: null }] }));
    expect(
      await reason(
        svc.archiveWorkspace(actor([FEATURE.workspacesArchive]), { organizationId: 'org1', workspaceId: 'wsX' }),
      ),
    ).toBe('not_found');
  });
});

describe('a write naming an organization that does not exist', () => {
  /**
   * Refused as `not_found`, not left to the foreign key.
   *
   * The database WOULD stop it — every one of these columns has a constraint —
   * but it stops it as a Prisma error naming `perm_membership_organizationId_fkey`
   * through a stack trace, which is a message for whoever wrote the ORM rather
   * than for whoever typed the id. Found by calling the API with an empty
   * organizationId and getting exactly that.
   */
  it.each([
    [
      'addMember',
      (s: PermissionsWriteService, a: PermissionContext) => s.addMember(a, { organizationId: 'nope', userId: 'u2' }),
    ],
    [
      'createWorkspace',
      (s: PermissionsWriteService, a: PermissionContext) =>
        s.createWorkspace(a, { organizationId: 'nope', key: 'w', name: 'W' }),
    ],
  ])('%s refuses with not_found rather than a constraint violation', async (_name, call) => {
    const { svc } = fake();
    expect(await reason(call(svc, actor([FEATURE.membersInvite, FEATURE.workspacesCreate])))).toBe('not_found');
  });
});

describe('idempotence — retrying a write is not an error', () => {
  const shared = () =>
    fake(
      emptyState({
        memberships: [{ id: 'm2', userId: 'u2', organizationId: 'org1' }],
        workspaces: [{ id: 'ws1', organizationId: 'org1', archivedAt: null }],
        workspaceMembers: [{ id: 'wm1', membershipId: 'm2', workspaceId: 'ws1' }],
        roles: [{ id: 'r1', key: 'viewer', label: 'viewer', level: 'workspace', organizationId: null }],
      }),
    );

  it('re-granting a held role reports granted: false rather than throwing', async () => {
    const { svc } = fake(
      emptyState({
        memberships: [{ id: 'm2', userId: 'u2', organizationId: 'org1' }],
        roles: [{ id: 'r1', key: 'a', label: 'a', level: 'organization', organizationId: null }],
        membershipRoles: [{ membershipId: 'm2', roleId: 'r1' }],
      }),
    );

    await expect(
      svc.assignRole(actor([FEATURE.membersAssignRole]), { organizationId: 'org1', userId: 'u2', roleId: 'r1' }),
    ).resolves.toEqual({ granted: false, replaced: false });
  });

  it('re-sharing an already shared workspace reports shared: false', async () => {
    const { svc, writes } = shared();
    await expect(
      svc.shareWorkspace(actor([FEATURE.workspaceMembersAdd]), {
        organizationId: 'org1',
        workspaceId: 'ws1',
        userId: 'u2',
      }),
    ).resolves.toEqual({ shared: false });
    expect(writes.workspaceMembers).toHaveLength(0);
  });

  it('revoking a role nobody holds leaves the world as asked', async () => {
    const { svc } = fake(emptyState({ memberships: [{ id: 'm2', userId: 'u2', organizationId: 'org1' }] }));
    await expect(
      svc.revokeRole(actor([FEATURE.membersAssignRole]), { organizationId: 'org1', userId: 'u2', roleId: 'r1' }),
    ).resolves.toEqual({ revoked: false });
  });

  it('adding an existing member is an error, because it is not the same request twice', async () => {
    // Unlike a grant, "add this person" carries an intent that has already been
    // satisfied differently — silently succeeding would hide a stale invite.
    const { svc } = fake(emptyState({ memberships: [{ id: 'm2', userId: 'u2', organizationId: 'org1' }] }));
    expect(await reason(svc.addMember(actor([FEATURE.membersInvite]), { organizationId: 'org1', userId: 'u2' }))).toBe(
      'already_exists',
    );
  });
});

describe('workspace roles require workspace membership', () => {
  it('refuses a grant for someone not in the workspace', async () => {
    // Structural, not merely checked: the grant hangs off PermWorkspaceMember,
    // so there is nowhere to put a role for someone who is not there.
    const { svc } = fake(
      emptyState({
        memberships: [{ id: 'm2', userId: 'u2', organizationId: 'org1' }],
        roles: [{ id: 'r1', key: 'viewer', label: 'viewer', level: 'workspace', organizationId: null }],
      }),
    );

    expect(
      await reason(
        svc.assignWorkspaceRole(actor([FEATURE.workspaceAssignRole]), {
          organizationId: 'org1',
          workspaceId: 'ws1',
          userId: 'u2',
          roleId: 'r1',
        }),
      ),
    ).toBe('not_found');
  });

  it('grants once the workspace is shared', async () => {
    const { svc } = fake(
      emptyState({
        memberships: [{ id: 'm2', userId: 'u2', organizationId: 'org1' }],
        workspaceMembers: [{ id: 'wm1', membershipId: 'm2', workspaceId: 'ws1' }],
        roles: [{ id: 'r1', key: 'viewer', label: 'viewer', level: 'workspace', organizationId: null }],
      }),
    );

    await expect(
      svc.assignWorkspaceRole(actor([FEATURE.workspaceAssignRole]), {
        organizationId: 'org1',
        workspaceId: 'ws1',
        userId: 'u2',
        roleId: 'r1',
      }),
      // `replaced: false` — nobody held a role to displace.
    ).resolves.toEqual({ granted: true, replaced: false });
  });
});

describe('a read-only host gets a clear error, not a missing method', () => {
  it('refuses on first use when no write client was bound', async () => {
    const svc = new PermissionsWriteService();
    await expect(svc.createOrganization(actor([]), { key: 'a', name: 'A' })).rejects.toThrow(
      /Bind PERMISSIONS_PRISMA_WRITE/,
    );
  });
});

describe('the pure rules, without a service around them', () => {
  it('assertRoleAssignable passes a matching, own-tenant role', () => {
    expect(() =>
      assertRoleAssignable(
        { key: 'a', label: 'a', level: 'organization', organizationId: 'org1' },
        {
          organizationId: 'org1',
          level: 'organization',
        },
      ),
    ).not.toThrow();
  });

  it('assertRoleAssignable carries the offending ids in detail, for the message a user sees', () => {
    try {
      assertRoleAssignable(
        { key: 'a', label: 'a', level: 'organization', organizationId: 'org2' },
        {
          organizationId: 'org1',
          level: 'organization',
        },
      );
    } catch (error) {
      expect((error as PermissionWriteError).detail).toMatchObject({
        roleOrganizationId: 'org2',
        organizationId: 'org1',
      });
    }
  });

  it('assertNotAppLevel says to use the other table rather than to pick another level', () => {
    expect(() => assertNotAppLevel({ key: 'staff', label: 'staff', level: 'app', organizationId: null })).toThrow(
      /grant it to the user directly/,
    );
  });

  it('assertRoleDefinable rejects a workspace role collecting billing:manage', () => {
    // The rule existed and was called by nothing. Defining a role is now when
    // it runs.
    try {
      assertRoleDefinable(
        { key: 'ws-admin', label: 'WS admin', level: 'workspace', features: [FEATURE.billingManage] },
        FEATURE_REGISTRY,
      );
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as PermissionWriteError).reason).toBe('role_features_invalid');
    }
  });

  it('assertRoleDefinable accepts a coherent role', () => {
    expect(() =>
      assertRoleDefinable(
        { key: 'sharer', label: 'Sharer', level: 'workspace', features: [FEATURE.workspaceMembersAdd] },
        FEATURE_REGISTRY,
      ),
    ).not.toThrow();
  });
});

/**
 * ── plans and subscriptions ──────────────────────────────────────────────────
 *
 * The entitlement half of the write path, added when subscription writes moved
 * into this module (docs/PLAN.md §12). The rules under test are the ones that
 * regress silently: a plan selling a key entitlement never consults, a
 * duplicate live subscription double-entitling a tenant, and a workspace from
 * one tenant attached to another's plan.
 */

/** A registry feature that a plan may actually sell. */
const SELLABLE = FEATURE_REGISTRY.find((spec) => spec.level === 'organization')?.key as string;
/** One that it may not — app level is exempt from the entitlement filter. */
const APP_LEVEL = FEATURE_REGISTRY.find((spec) => spec.level === 'app')?.key as string;

const REQUIRED_LIMITS = {
  [LIMIT.organizationMembers]: '10',
  [LIMIT.organizationWorkspaces]: '3',
  [LIMIT.workspaceMembers]: '5',
};

const planDraft = (
  over: Partial<Parameters<PermissionsWriteService['createPlan']>[1]> = {},
): Parameters<PermissionsWriteService['createPlan']>[1] => ({
  key: 'team',
  label: 'Team',
  isPublic: true,
  icon: '',
  features: [] as string[],
  limits: REQUIRED_LIMITS,
  ...over,
});

describe('plan definitions', () => {
  const author = () => actor([FEATURE.plansCreate, FEATURE.plansUpdate, FEATURE.plansArchive]);

  it('refuses an actor holding nothing, before any write', async () => {
    const { svc, writes } = fake();
    expect(await reason(svc.createPlan(actor([]), planDraft()))).toBe('not_permitted');
    expect(writes.plans).toEqual([]);
  });

  it('writes the plan, its features and its caps together', async () => {
    const { svc, state } = fake();
    await svc.createPlan(author(), planDraft({ features: [SELLABLE] }));

    expect(state.plans).toEqual([{ key: 'team', label: 'Team', isPublic: true, icon: null, archivedAt: null }]);
    expect(state.planFeatures).toEqual([{ planKey: 'team', featureKey: SELLABLE }]);
    expect(state.planLimits).toContainEqual({ planKey: 'team', limitKey: LIMIT.organizationMembers, value: 10 });
  });

  it('stores a chosen icon, and null for a blank one', async () => {
    const { svc, state } = fake();
    await svc.createPlan(author(), planDraft({ key: 'with-icon', icon: '  gem  ' }));
    await svc.createPlan(author(), planDraft({ key: 'no-icon', icon: '   ' }));

    // Trimmed, and an empty string becomes null — a plan that named no icon
    // holds null rather than '', so the frontend's fallback is reached by one
    // check instead of two.
    expect(state.plans.find((p) => p.key === 'with-icon')?.icon).toBe('gem');
    expect(state.plans.find((p) => p.key === 'no-icon')?.icon).toBeNull();
  });

  /**
   * The rule the whole plan model rests on. App-level grants are unioned in
   * AFTER the entitlement filter, so a plan carrying one would read as a sold
   * feature in the catalogue and entitle nobody to anything.
   */
  it('refuses an app-level feature, which a plan can never sell', async () => {
    const { svc, writes } = fake();
    expect(await reason(svc.createPlan(author(), planDraft({ features: [APP_LEVEL] })))).toBe('draft_invalid');
    expect(writes.plans).toEqual([]);
  });

  /**
   * A plan that omits a required cap falls back to the registry floor of ONE
   * and silently caps a paying customer at a single seat.
   */
  it('refuses a plan missing a required cap', async () => {
    const { svc } = fake();
    const limits = { [LIMIT.organizationMembers]: '10' };
    expect(await reason(svc.createPlan(author(), planDraft({ limits })))).toBe('draft_invalid');
  });

  it('refuses a duplicate key', async () => {
    const { svc } = fake();
    await svc.createPlan(author(), planDraft());
    expect(await reason(svc.createPlan(author(), planDraft()))).toBe('draft_invalid');
  });

  /**
   * REPLACES rather than merges, the same rule the role path follows: the list
   * the caller sends is the whole truth about the plan, so a key removed in the
   * form is actually un-sold instead of lingering because nothing deleted it.
   */
  it('replaces the feature list on update rather than merging into it', async () => {
    const { svc, state } = fake();
    await svc.createPlan(author(), planDraft({ features: [SELLABLE] }));
    await svc.updatePlan(author(), 'team', planDraft({ features: [] }));

    expect(state.planFeatures).toEqual([]);
  });

  it('archives and restores, never deletes', async () => {
    const { svc, state } = fake();
    await svc.createPlan(author(), planDraft({ features: [SELLABLE] }));

    await svc.setPlanArchived(author(), 'team', true);
    expect(state.plans[0]?.archivedAt).toBeInstanceOf(Date);
    // The features stay put, so restoring gives customers back what they had.
    expect(state.planFeatures).toHaveLength(1);

    await svc.setPlanArchived(author(), 'team', false);
    expect(state.plans[0]?.archivedAt).toBeNull();
  });

  /**
   * The asymmetry with roles, asserted rather than only documented: a role
   * clone drops what the actor does not hold, because putting a right into a
   * role you lack is escalation. A plan entitles rather than grants, so the
   * whole catalogue is copyable by anyone who may write plans at all.
   */
  it('clones the whole catalogue, filtering only by level', async () => {
    const { svc } = fake();
    await svc.createPlan(author(), planDraft({ key: 'source', features: [SELLABLE] }));

    const preview = await svc.previewPlanClone(author(), { sourcePlanKey: 'source', current: [], mode: 'replace' });
    expect(preview.features).toEqual([SELLABLE]);
    expect(preview.skipped).toEqual([]);
  });
});

describe('subscriptions', () => {
  const biller = () => actor([FEATURE.billingManage, FEATURE.plansCreate]);

  const seeded = async () => {
    const context = fake(
      emptyState({
        organizations: [
          { id: 'org1', key: 'acme', name: 'Acme' },
          { id: 'org2', key: 'other', name: 'Other' },
        ],
        workspaces: [
          { id: 'ws1', organizationId: 'org1', archivedAt: null },
          { id: 'wsOther', organizationId: 'org2', archivedAt: null },
        ],
      }),
    );
    await context.svc.createPlan(biller(), planDraft({ features: [SELLABLE] }));
    return context;
  };

  it('refuses an actor holding nothing, before any write', async () => {
    const { svc, writes } = await seeded();
    const draft = {
      organizationId: 'org1',
      workspaceId: null,
      planKey: 'team',
      status: 'active',
      currentPeriodEnd: '',
    };
    expect(await reason(svc.startSubscription(actor([]), draft))).toBe('not_permitted');
    expect(writes.subscriptions).toEqual([]);
  });

  it('attaches a plan to an organization', async () => {
    const { svc, state } = await seeded();
    await svc.startSubscription(biller(), {
      organizationId: 'org1',
      workspaceId: null,
      planKey: 'team',
      status: 'active',
      currentPeriodEnd: '2026-03-01',
    });

    expect(state.subscriptions[0]).toMatchObject({ organizationId: 'org1', workspaceId: null, status: 'active' });
  });

  /**
   * C3's entitlement twin. A workspace id from one tenant paired with an
   * organization id from another is a perfectly well-formed request that would
   * entitle one customer's workspace off another customer's plan — so the
   * pairing is re-read inside the transaction rather than trusted.
   */
  it('refuses a workspace that belongs to another organization', async () => {
    const { svc, writes } = await seeded();
    expect(
      await reason(
        svc.startSubscription(biller(), {
          organizationId: 'org1',
          workspaceId: 'wsOther',
          planKey: 'team',
          status: 'active',
          currentPeriodEnd: '',
        }),
      ),
    ).toBe('not_found');
    expect(writes.subscriptions).toEqual([]);
  });

  it('refuses an archived plan', async () => {
    const { svc } = await seeded();
    await svc.setPlanArchived(actor([FEATURE.plansArchive]), 'team', true);

    expect(
      await reason(
        svc.startSubscription(biller(), {
          organizationId: 'org1',
          workspaceId: null,
          planKey: 'team',
          status: 'active',
          currentPeriodEnd: '',
        }),
      ),
    ).toBe('not_found');
  });

  /**
   * IDEMPOTENCY, and the one place this path is deliberately NOT idempotent.
   *
   * `assignRole` returns a no-op when the grant is already there, because
   * re-granting leaves the world in the state asked for. A subscription carries
   * a status and a period the caller did not send, so silently succeeding would
   * report "subscribed" while the dates stayed whatever they were. Refusing is
   * what stops a retry double-entitling a tenant.
   */
  it('refuses a second live subscription to the same plan', async () => {
    const { svc, state } = await seeded();
    const draft = {
      organizationId: 'org1',
      workspaceId: null,
      planKey: 'team',
      status: 'active',
      currentPeriodEnd: '',
    };
    await svc.startSubscription(biller(), draft);

    expect(await reason(svc.startSubscription(biller(), draft))).toBe('already_exists');
    expect(state.subscriptions).toHaveLength(1);
  });

  it('allows the same plan again once the first has ended', async () => {
    const { svc, state } = await seeded();
    const draft = {
      organizationId: 'org1',
      workspaceId: null,
      planKey: 'team',
      status: 'active',
      currentPeriodEnd: '',
    };
    const { subscriptionId } = await svc.startSubscription(biller(), draft);

    await svc.endSubscription(biller(), subscriptionId);
    await svc.startSubscription(biller(), draft);

    // TWO rows, not one reopened: the gap stays visible, which is what makes
    // past entitlement reconstructable.
    expect(state.subscriptions).toHaveLength(2);
  });

  it('ends by setting both endedAt and the status, never by deleting', async () => {
    const { svc, state } = await seeded();
    const { subscriptionId } = await svc.startSubscription(biller(), {
      organizationId: 'org1',
      workspaceId: null,
      planKey: 'team',
      status: 'active',
      currentPeriodEnd: '',
    });

    await svc.endSubscription(biller(), subscriptionId);

    // Both, because they answer different questions: WHEN it stopped being the
    // current answer, and WHY. A row saying `active` forever would show in
    // every list and every export.
    expect(state.subscriptions[0]?.endedAt).toBeInstanceOf(Date);
    expect(state.subscriptions[0]?.status).toBe('canceled');
  });

  it('refuses to edit a subscription that has already ended', async () => {
    const { svc } = await seeded();
    const { subscriptionId } = await svc.startSubscription(biller(), {
      organizationId: 'org1',
      workspaceId: null,
      planKey: 'team',
      status: 'active',
      currentPeriodEnd: '',
    });
    await svc.endSubscription(biller(), subscriptionId);

    // A row with an endedAt that reads `active` in a list and entitles nothing
    // is the worst of both, and unexplainable afterwards.
    expect(
      await reason(svc.updateSubscription(biller(), subscriptionId, { status: 'active', currentPeriodEnd: '' })),
    ).toBe('not_found');
  });

  it('changes status and renewal date, and nothing else', async () => {
    const { svc, state } = await seeded();
    const { subscriptionId } = await svc.startSubscription(biller(), {
      organizationId: 'org1',
      workspaceId: null,
      planKey: 'team',
      status: 'past_due',
      currentPeriodEnd: '',
    });

    await svc.updateSubscription(biller(), subscriptionId, { status: 'active', currentPeriodEnd: '2026-03-01' });

    expect(state.subscriptions[0]).toMatchObject({ status: 'active', planKey: 'team', organizationId: 'org1' });
  });
});

/**
 * ── one organization role per member ─────────────────────────────────────────
 *
 * A person is one thing in an organization. Wanting the rights of two roles is
 * a reason to define a third carrying both, not a reason to stack them — and
 * the database says so with `@@unique([membershipId])`, so `assignRole` has to
 * replace rather than add or the second grant hits the constraint.
 */
describe('a member holds one organization role', () => {
  const withMember = () =>
    fake(
      emptyState({
        memberships: [{ id: 'm1', userId: 'u2', organizationId: 'org1' }],
        roles: [
          { id: 'r-admin', key: 'admin', label: 'admin', level: 'organization', organizationId: null },
          { id: 'r-owner', key: 'owner', label: 'owner', level: 'organization', organizationId: null },
        ],
      }),
    );

  const grant = (svc: PermissionsWriteService, roleId: string) =>
    svc.assignRole(actor([FEATURE.membersAssignRole]), { organizationId: 'org1', userId: 'u2', roleId });

  it('replaces the previous role rather than adding to it', async () => {
    const { svc, state } = withMember();
    await grant(svc, 'r-admin');

    const result = await grant(svc, 'r-owner');

    expect(result).toEqual({ granted: true, replaced: true });
    // ONE row, and it is the new one. Two would be the constraint violation
    // this method exists to avoid reaching.
    expect(state.membershipRoles).toEqual([{ membershipId: 'm1', roleId: 'r-owner' }]);
  });

  it('says when something was displaced, and when nothing was', async () => {
    const { svc } = withMember();

    // Nobody lost anything: they held none.
    expect(await grant(svc, 'r-admin')).toEqual({ granted: true, replaced: false });
    // This one cost them the admin role, which a screen has to be able to say.
    expect(await grant(svc, 'r-owner')).toEqual({ granted: true, replaced: true });
  });

  it('is still idempotent, and writes nothing when the role is already held', async () => {
    const { svc, state } = withMember();
    await grant(svc, 'r-admin');

    const result = await grant(svc, 'r-admin');

    expect(result).toEqual({ granted: false, replaced: false });
    expect(state.membershipRoles).toEqual([{ membershipId: 'm1', roleId: 'r-admin' }]);
  });

  it('leaves them with none after a revoke, which is a legitimate state', async () => {
    const { svc, state } = withMember();
    await grant(svc, 'r-admin');

    await svc.revokeRole(actor([FEATURE.membersAssignRole]), {
      organizationId: 'org1',
      userId: 'u2',
      roleId: 'r-admin',
    });

    expect(state.membershipRoles).toEqual([]);
  });

  /**
   * The SAME rule one level down, added when the organization one was extended:
   * a workspace member holds at most one workspace-level role, enforced by
   * `@@unique([workspaceMemberId])`. This test used to assert the opposite.
   */
  it('applies to workspace roles too — the second replaces the first', async () => {
    const { svc, state } = fake(
      emptyState({
        memberships: [{ id: 'm1', userId: 'u2', organizationId: 'org1' }],
        workspaces: [{ id: 'ws1', organizationId: 'org1', archivedAt: null }],
        workspaceMembers: [{ id: 'wm1', membershipId: 'm1', workspaceId: 'ws1' }],
        roles: [
          { id: 'r-a', key: 'a', label: 'a', level: 'workspace', organizationId: null },
          { id: 'r-b', key: 'b', label: 'b', level: 'workspace', organizationId: null },
        ],
      }),
    );
    const act = actor([FEATURE.workspaceAssignRole]);
    const input = { organizationId: 'org1', workspaceId: 'ws1', userId: 'u2' };

    expect(await svc.assignWorkspaceRole(act, { ...input, roleId: 'r-a' })).toEqual({
      granted: true,
      replaced: false,
    });
    expect(await svc.assignWorkspaceRole(act, { ...input, roleId: 'r-b' })).toEqual({
      granted: true,
      replaced: true,
    });

    expect(state.workspaceMemberRoles).toEqual([{ workspaceMemberId: 'wm1', roleId: 'r-b' }]);
  });

  it('is still idempotent at workspace level', async () => {
    const { svc, state } = fake(
      emptyState({
        memberships: [{ id: 'm1', userId: 'u2', organizationId: 'org1' }],
        workspaces: [{ id: 'ws1', organizationId: 'org1', archivedAt: null }],
        workspaceMembers: [{ id: 'wm1', membershipId: 'm1', workspaceId: 'ws1' }],
        roles: [{ id: 'r-a', key: 'a', label: 'a', level: 'workspace', organizationId: null }],
      }),
    );
    const act = actor([FEATURE.workspaceAssignRole]);
    const input = { organizationId: 'org1', workspaceId: 'ws1', userId: 'u2', roleId: 'r-a' };

    await svc.assignWorkspaceRole(act, input);
    expect(await svc.assignWorkspaceRole(act, input)).toEqual({ granted: false, replaced: false });
    expect(state.workspaceMemberRoles).toHaveLength(1);
  });
});

describe('invitations', () => {
  const inviter = () => actor([FEATURE.membersInvite]);
  /*
   * A PLATFORM inviter: `roles:grant_app` for the app-level role, and the
   * feature the granted role carries, because `inviteUser` refuses to hand out
   * more than the granter holds.
   */
  const granter = () => actor([FEATURE.rolesGrantApp, FEATURE.membersInvite]);

  it('sends the token to the host and never returns it', async () => {
    const h = fake();
    const result = await h.svc.inviteMember(inviter(), 'org1', { email: ' Ada@Example.COM ', roleId: '' });

    /*
     * The whole reason there is a hook: the token reaches the mailer and
     * nothing else. A caller holding one would be holding a working way into
     * somebody else's organization.
     */
    expect(Object.keys(result).sort()).toEqual(['delivered', 'invitationId']);
    expect(result.delivered).toBe(true);
    expect(h.writes.sent).toHaveLength(1);
    expect(h.writes.sent[0]?.token).toMatch(/^[0-9a-f]{64}$/);
    // Normalised on the way in, so an invitation to 'Ada@Example.COM' is the
    // one a sign-up as 'ada@example.com' can accept.
    expect(h.writes.sent[0]?.email).toBe('ada@example.com');
    expect(h.state.invitations[0]?.email).toBe('ada@example.com');
    // Stored as a HASH. Anything else means a database read yields live links.
    expect(h.state.invitations[0]?.tokenHash).not.toBe(h.writes.sent[0]?.token);
  });

  it('refuses before writing when the host wired no mailer', async () => {
    // An invitation nobody can be told about is worse than none: it looks like
    // success and it blocks the address from being invited again.
    const h = fake();
    const withoutMailer = new PermissionsWriteService(h.client);

    expect(await reason(withoutMailer.inviteMember(inviter(), 'org1', { email: 'a@b.com', roleId: '' }))).toBe(
      'not_configured',
    );
    expect(h.state.invitations).toHaveLength(0);
  });

  it('reports a delivery failure while keeping the invitation', async () => {
    const h = fake(emptyState({ mailFails: true }));
    const result = await h.svc.inviteMember(inviter(), 'org1', { email: 'a@b.com', roleId: '' });

    // The row is valid and live. Rolling it back would lose a real invitation
    // to a mail outage; saying "sent" would be a lie found out a week later.
    expect(result.delivered).toBe(false);
    expect(h.state.invitations).toHaveLength(1);
  });

  it('blocks a second live invitation to one address, but not a stale one', async () => {
    const h = fake();
    await h.svc.inviteMember(inviter(), 'org1', { email: 'a@b.com', roleId: '' });
    expect(await reason(h.svc.inviteMember(inviter(), 'org1', { email: 'a@b.com', roleId: '' }))).toBe('draft_invalid');

    /*
     * Expiry is DERIVED, so this row still reads `pending` in its column. Were
     * the check reading the column rather than `isAcceptable`, one forgotten
     * invitation would block an address forever.
     */
    const first = h.state.invitations[0];
    if (first) first.expiresAt = new Date(Date.now() - 1000);
    await expect(h.svc.inviteMember(inviter(), 'org1', { email: 'a@b.com', roleId: '' })).resolves.toBeDefined();
  });

  it('accepts with the token alone, and joins the organization', async () => {
    const h = fake();
    await h.svc.inviteMember(inviter(), 'org1', { email: 'a@b.com', roleId: '' });
    const token = h.writes.sent[0]?.token ?? '';

    // NO actor: the person accepting holds nothing in the organization, which
    // is the entire point of an invitation.
    const result = await h.svc.acceptInvitation({ token, userId: 'newcomer' });

    expect(result.joined).toBe(true);
    expect(result.organizationId).toBe('org1');
    expect(h.state.memberships.some((m) => m.userId === 'newcomer')).toBe(true);
    expect(h.state.invitations[0]?.status).toBe('accepted');
  });

  /**
   * The baseline app-level role.
   *
   * The model is ADDITIVE, so there is no default-on: an account with no
   * app-level role holds nothing at all — the seeded organization roles carry
   * no features either — and lands on a settings page whose Save button is
   * hidden. A real account created by an organization invitation was in exactly
   * that state, which is what put `defaultAppRoleKey` in the options.
   */
  const withBaseline = (over: Partial<Parameters<typeof emptyState>[0]> = {}) =>
    fake(
      emptyState({
        roles: [{ id: 'baseline', key: 'normal-user', label: 'Normal user', level: 'app', organizationId: null }],
        ...over,
      }),
      { defaultAppRoleKey: 'normal-user' },
    );

  it('grants the baseline app role to somebody the invitation gave none', async () => {
    const h = withBaseline();
    await h.svc.inviteMember(inviter(), 'org1', { email: 'a@b.com', roleId: '' });
    const token = h.writes.sent[0]?.token ?? '';

    await h.svc.acceptInvitation({ token, userId: 'newcomer' });

    // Without this they would join, sign in, and find they cannot edit their
    // own name — `account:profile_write` comes from an app-level role.
    expect(h.writes.userRoles).toEqual([{ userId: 'newcomer', roleId: 'baseline' }]);
  });

  it('never replaces an app role, even when the invitation names one', async () => {
    /*
     * The demotion this closes: the platform invite form defaults to the
     * least-privileged role, and an inviter is looking at an ADDRESS rather
     * than at an account. Without this, inviting an existing super admin would
     * have demoted them the moment they followed the link.
     *
     * Giving a role is what an invitation may do; changing one is
     * `assignAppRole`, from a screen showing what they hold today.
     */
    const h = withBaseline({
      roles: [
        { id: 'baseline', key: 'normal-user', label: 'Normal user', level: 'app', organizationId: null },
        { id: 'crown', key: 'super-admin', label: 'Super admin', level: 'app', organizationId: null },
      ],
      userRoles: [
        {
          userId: 'staff',
          role: {
            id: 'crown',
            key: 'super-admin',
            label: 'Super admin',
            level: 'app',
            icon: null,
            features: [],
            limits: [],
          },
        },
      ],
    });
    await h.svc.inviteUser(granter(), { email: 'a@b.com', roleId: '', appRoleId: 'baseline' });
    const token = h.writes.sent[0]?.token ?? '';

    await h.svc.acceptInvitation({ token, userId: 'staff' });

    expect(h.writes.userRoles).toHaveLength(0);
  });

  it('leaves an existing app role alone rather than demoting to the baseline', async () => {
    const h = withBaseline({
      userRoles: [
        {
          userId: 'staff',
          role: {
            id: 'crown',
            key: 'super-admin',
            label: 'Super admin',
            level: 'app',
            icon: null,
            features: [],
            limits: [],
          },
        },
      ],
    });
    await h.svc.inviteMember(inviter(), 'org1', { email: 'a@b.com', roleId: '' });
    const token = h.writes.sent[0]?.token ?? '';

    await h.svc.acceptInvitation({ token, userId: 'staff' });

    // A super admin accepting an organization invitation must not be quietly
    // demoted. The default fills a hole; it never overwrites an answer.
    expect(h.writes.userRoles).toHaveLength(0);
  });

  it('accepts normally when no baseline is configured', async () => {
    const h = fake();
    await h.svc.inviteMember(inviter(), 'org1', { email: 'a@b.com', roleId: '' });
    const token = h.writes.sent[0]?.token ?? '';

    // An unset option is the behaviour that existed before, and joining must
    // not depend on a role having been configured.
    await expect(h.svc.acceptInvitation({ token, userId: 'newcomer' })).resolves.toMatchObject({ joined: true });
    expect(h.writes.userRoles).toHaveLength(0);
  });

  it('lets the invited person decline, with no session and no account', async () => {
    const h = fake();
    await h.svc.inviteMember(inviter(), 'org1', { email: 'a@b.com', roleId: '' });
    const token = h.writes.sent[0]?.token ?? '';

    /*
     * NO actor and no userId. Requiring an account to refuse an invitation
     * would mean creating one in order to say no.
     */
    const result = await h.svc.declineInvitation({ token });

    expect(result.declined).toBe(true);
    expect(h.state.invitations[0]?.status).toBe('declined');
    // Nothing is created for anybody: declining closes the offer and no more.
    expect(h.state.memberships).toHaveLength(0);
    expect(h.writes.userRoles).toHaveLength(0);
  });

  it('cannot be accepted after it was declined, and cannot be declined twice', async () => {
    const h = fake();
    await h.svc.inviteMember(inviter(), 'org1', { email: 'a@b.com', roleId: '' });
    const token = h.writes.sent[0]?.token ?? '';
    await h.svc.declineInvitation({ token });

    // The same one refusal every dead end gives — the difference between them
    // is what somebody probing tokens wants.
    expect(await reason(h.svc.acceptInvitation({ token, userId: 'u9' }))).toBe('not_found');
    expect(await reason(h.svc.declineInvitation({ token }))).toBe('not_found');
    expect(h.state.memberships).toHaveLength(0);
  });

  it('gives one refusal for an unknown token and a revoked one', async () => {
    const h = fake();
    await h.svc.inviteMember(inviter(), 'org1', { email: 'a@b.com', roleId: '' });
    const token = h.writes.sent[0]?.token ?? '';

    expect(await reason(h.svc.acceptInvitation({ token: 'nonsense', userId: 'u9' }))).toBe('not_found');

    await h.svc.revokeInvitation(inviter(), 'org1', h.state.invitations[0]?.id ?? '');
    // The same answer: the difference is exactly what somebody probing tokens
    // wants, and the honest holder has to ask the sender either way.
    expect(await reason(h.svc.acceptInvitation({ token, userId: 'u9' }))).toBe('not_found');
    expect(h.state.memberships).toHaveLength(0);
  });

  it("will not revoke another tenant's invitation", async () => {
    const h = fake(
      emptyState({
        organizations: [
          { id: 'org1', key: 'acme', name: 'Acme' },
          { id: 'org2', key: 'other', name: 'Other' },
        ],
      }),
    );
    await h.svc.inviteMember(inviter(), 'org1', { email: 'a@b.com', roleId: '' });
    const id = h.state.invitations[0]?.id ?? '';

    // Scoped by organizationId as well as id — nothing else stops it.
    expect(await reason(h.svc.revokeInvitation(inviter(), 'org2', id))).toBe('not_found');
    expect(h.state.invitations[0]?.status).toBe('pending');
  });

  it('previews a live invitation and nothing else', async () => {
    const h = fake();
    await h.svc.inviteMember(inviter(), 'org1', { email: 'a@b.com', roleId: '' });
    const token = h.writes.sent[0]?.token ?? '';

    await expect(h.svc.previewInvitation(token)).resolves.toMatchObject({
      organizationName: 'Acme',
      email: 'a@b.com',
    });

    const row = h.state.invitations[0];
    if (row) row.expiresAt = new Date(Date.now() - 1000);
    // Null rather than a stale preview: the page must not offer to join on a
    // link the accept path is about to refuse.
    await expect(h.svc.previewInvitation(token)).resolves.toBeNull();
  });
});

describe('renaming an organization', () => {
  const manager = () => actor([FEATURE.organizationsManage]);

  it('renames, and trims what it is given', async () => {
    const h = fake();
    await expect(
      h.svc.updateOrganization(manager(), { organizationId: 'org1', key: ' acme-co ', name: '  Acme Co.  ' }),
    ).resolves.toEqual({ organizationId: 'org1', renamed: true });

    expect(h.state.organizations[0]).toMatchObject({ key: 'acme-co', name: 'Acme Co.' });
  });

  it('needs its own key, not the one that merely reads organizations', async () => {
    // Support staff look at tenants constantly and rename one almost never.
    // Sharing a key would hand every support engineer the second.
    const h = fake();
    expect(
      await reason(
        h.svc.updateOrganization(actor([FEATURE.organizationsRead]), {
          organizationId: 'org1',
          key: 'x',
          name: 'X',
        }),
      ),
    ).toBe('not_permitted');
    expect(h.writes.organizations).toHaveLength(0);
  });

  it('refuses a blank name or key before writing', async () => {
    const h = fake();
    expect(
      await reason(h.svc.updateOrganization(manager(), { organizationId: 'org1', key: 'acme', name: '   ' })),
    ).toBe('draft_invalid');
    expect(h.writes.organizations).toHaveLength(0);
  });

  it('says so when the organization is gone, rather than throwing from Prisma', async () => {
    // Why the write is `updateMany` over a unique id: a stale link is a
    // sentence, not a 500.
    const h = fake();
    expect(await reason(h.svc.updateOrganization(manager(), { organizationId: 'nope', key: 'a', name: 'A' }))).toBe(
      'not_found',
    );
  });
});

/**
 * ── the tenant's own writes ─────────────────────────────────────────────────
 *
 * The `/organizations/*` half of PLAN §12.13: a customer acting on the
 * organization they are STANDING IN, as opposed to the platform writes above,
 * which act on any tenant.
 */
describe('a tenant renames its OWN organization', () => {
  const owner = () => actor([FEATURE.organizationUpdate]);

  it('renames, and trims what it is given', async () => {
    const h = fake();
    await expect(
      h.svc.renameMyOrganization(owner(), { organizationId: 'org1', key: ' acme-co ', name: '  Acme Co.  ' }),
    ).resolves.toEqual({ organizationId: 'org1', renamed: true });
    expect(h.state.organizations[0]).toMatchObject({ key: 'acme-co', name: 'Acme Co.' });
  });

  /**
   * The two keys are one letter apart, and this is what makes the near
   * collision safe rather than merely documented: neither stands in for the
   * other, in either direction.
   *
   *   organizations:manage  APP  — rename ANY tenant. Support.
   *   organization:manage   ORG  — rename THIS one. A customer's owner.
   */
  it('does not accept the APP-level key in place of its own', async () => {
    const h = fake();
    expect(
      await reason(
        h.svc.renameMyOrganization(actor([FEATURE.organizationsManage]), {
          organizationId: 'org1',
          key: 'x',
          name: 'X',
        }),
      ),
    ).toBe('not_permitted');
    expect(h.writes.organizations).toHaveLength(0);
  });

  it('and the platform mutation does not accept the ORGANIZATION-level one either', async () => {
    const h = fake();
    expect(
      await reason(
        h.svc.updateOrganization(actor([FEATURE.organizationUpdate]), {
          organizationId: 'org1',
          key: 'x',
          name: 'X',
        }),
      ),
    ).toBe('not_permitted');
  });

  /**
   * The check the guard cannot make for a worker, a CLI or a seed script: a
   * context resolved in one organization must not write to another. On the HTTP
   * path the guard resolved the actor from this same id, so the two cannot
   * disagree — everywhere else they can, and the failure would be a
   * cross-tenant write.
   */
  it('refuses an organization other than the one the actor resolved in', async () => {
    const h = fake(
      emptyState({
        organizations: [
          { id: 'org1', key: 'acme', name: 'Acme' },
          { id: 'org2', key: 'b', name: 'B' },
        ],
      }),
    );
    expect(await reason(h.svc.renameMyOrganization(owner(), { organizationId: 'org2', key: 'x', name: 'X' }))).toBe(
      'not_permitted',
    );
    expect(h.writes.organizations).toHaveLength(0);
  });

  /** An APP-level actor carries no organization, which is what lets staff act anywhere. */
  it('lets an actor with no organization through — that check asks "somewhere else", not "anywhere"', async () => {
    const h = fake();
    const staff: PermissionContext = { ...owner(), organizationId: null, workspaceId: null };
    await expect(
      h.svc.renameMyOrganization(staff, { organizationId: 'org1', key: 'acme-co', name: 'Acme Co.' }),
    ).resolves.toMatchObject({ renamed: true });
  });
});

describe('leaving an organization', () => {
  const twoMembers = () =>
    emptyState({
      memberships: [
        { id: 'm-actor', userId: 'actor', organizationId: 'org1', status: 'active' },
        { id: 'm-other', userId: 'other', organizationId: 'org1', status: 'active' },
      ],
    });

  /**
   * NO FEATURE IS REQUIRED. Walking out is the other end of the membership that
   * put you there — a key for it would be one an administrator could withhold
   * to keep somebody in, and an ordinary member who administers nothing must
   * still be able to leave.
   */
  it('needs no feature at all', async () => {
    const h = fake(twoMembers());
    await expect(h.svc.leaveOrganization(actor([]), { organizationId: 'org1' })).resolves.toEqual({ removed: 1 });
    expect(h.state.memberships.map((m) => m.userId)).toEqual(['other']);
  });

  /** Takes no userId: the subject is the caller, so there is nobody else to pass. */
  it('removes the ACTOR, not an id it was handed', async () => {
    const h = fake(twoMembers());
    await h.svc.leaveOrganization(actor([]), { organizationId: 'org1' });
    expect(h.state.memberships.some((m) => m.userId === 'actor')).toBe(false);
  });

  /**
   * An organization with nobody in it is unreachable by every tenant screen —
   * `loadContext` resolves no context there for anyone — so it would sit
   * counting against nobody's cap with no way back short of platform staff.
   * The mirror of `createOrganization` making its founder the first member.
   */
  it('refuses the LAST member, and rolls the delete back', async () => {
    const h = fake(
      emptyState({ memberships: [{ id: 'm-actor', userId: 'actor', organizationId: 'org1', status: 'active' }] }),
    );
    expect(await reason(h.svc.leaveOrganization(actor([]), { organizationId: 'org1' }))).toBe('not_permitted');
    // Still there, and never deleted in the first place: the count is taken and
    // refused BEFORE the delete rather than rolled back after it, so the rule
    // holds for a caller that arrives without a transaction too.
    expect(h.state.memberships).toHaveLength(1);
  });

  /**
   * A suspended member occupies no active seat, so their leaving cannot empty
   * the organization. Without the second count they would be refused about a
   * seat they do not hold — and leaving is exactly what somebody suspended is
   * most likely to want to do.
   */
  it('lets a SUSPENDED member leave even when one active member remains', async () => {
    const h = fake(
      emptyState({
        memberships: [
          { id: 'm-actor', userId: 'actor', organizationId: 'org1', status: 'suspended' },
          { id: 'm-other', userId: 'other', organizationId: 'org1', status: 'active' },
        ],
      }),
    );
    await expect(h.svc.leaveOrganization(actor([]), { organizationId: 'org1' })).resolves.toEqual({ removed: 1 });
    expect(h.state.memberships.map((m) => m.userId)).toEqual(['other']);
  });

  it('says so when the caller is not a member, rather than reporting a silent success', async () => {
    const h = fake(twoMembers());
    const stranger: PermissionContext = { ...actor([]), subjectId: 'nobody' };
    expect(await reason(h.svc.leaveOrganization(stranger, { organizationId: 'org1' }))).toBe('not_found');
  });
});

/**
 * A gap the tenant screens surfaced rather than created.
 *
 * §12.33 made workspace membership REQUIRED — no role widens which workspaces
 * you may enter. `createWorkspace` added no member, so a tenant administrator
 * could create a workspace and then be refused entry to it, with the only way
 * in being `workspaces:share`, which is itself a WORKSPACE-level key and so
 * resolves inside a workspace they may not enter. A tenant could reach a state
 * it could not leave without platform staff, and nothing said so.
 */
describe('creating a workspace puts its creator in it', () => {
  const creator = () => actor([FEATURE.workspacesCreate]);
  const member = () =>
    emptyState({ memberships: [{ id: 'm-actor', userId: 'actor', organizationId: 'org1', status: 'active' }] });

  it('adds the creator as a workspace member, in the same transaction', async () => {
    const h = fake(member());
    const result = await h.svc.createWorkspace(creator(), { organizationId: 'org1', key: 'ws', name: 'WS' });

    expect(result.joined).toBe(true);
    expect(h.state.workspaceMembers).toHaveLength(1);
    expect(h.state.workspaceMembers[0]).toMatchObject({ membershipId: 'm-actor', workspaceId: result.workspaceId });
  });

  /**
   * NO ROLE comes with it, only entry. Being able to open a workspace and being
   * able to change it are the split the model makes everywhere else, and
   * creating one should not quietly hand over both.
   */
  it('grants no workspace role with the membership', async () => {
    const h = fake(member());
    await h.svc.createWorkspace(creator(), { organizationId: 'org1', key: 'ws', name: 'WS' });
    expect(h.state.workspaceMemberRoles).toHaveLength(0);
  });

  /**
   * Platform staff hold no membership in the tenant, so there is no row to hang
   * a workspace member off. Correct rather than a shortfall: they enter by
   * `platform:support_access`, the single exemption from membership, and
   * writing them a membership would make a support visit look like joining the
   * company.
   */
  it('creates no membership for an actor who is not in the organization', async () => {
    const h = fake();
    const result = await h.svc.createWorkspace(creator(), { organizationId: 'org1', key: 'ws', name: 'WS' });

    expect(result.joined).toBe(false);
    expect(h.state.workspaceMembers).toHaveLength(0);
    // The workspace itself is still created — support creating one on a
    // customer's behalf is a legitimate act.
    expect(h.state.workspaces).toHaveLength(1);
  });
});

/**
 * ── THE PLATFORM'S DEFAULTS, APPLIED ────────────────────────────────────────
 *
 * Four creation paths that used to end with somebody holding nothing now
 * consult the defaults. The properties worth pinning are not "the role is
 * granted" — that is one line — but the three that decide whether this feature
 * is safe:
 *
 *   IT NEVER GATES.       Unset, deleted, disabled, archived: every failure is
 *                         silent and the thing is still created. A convenience
 *                         that can fail a sign-up is worse than no convenience.
 *   IT NEVER OVERWRITES.  A default fills a hole; it does not replace a choice
 *                         somebody made, and it does not touch an existing
 *                         member.
 *   IT RESPECTS LEVEL.    A role's level is immutable and the wrong one would
 *                         be granted and then filtered out by the resolution
 *                         order, which is a state no screen could explain.
 */
describe('the platform defaults', () => {
  const orgRole = { id: 'r-org', key: 'owner', label: 'Owner', level: 'organization', organizationId: null };
  const wsRole = { id: 'r-ws', key: 'ws-admin', label: 'Workspace admin', level: 'workspace', organizationId: null };
  const appRole = { id: 'r-app', key: 'normal-user', label: 'Normal user', level: 'app', organizationId: null };

  describe('setDefault', () => {
    it('refuses a key this build does not declare', async () => {
      const { svc } = fake();
      expect(await reason(svc.setDefault(actor([FEATURE.defaultsManage]), { key: 'made.up', value: null }))).toBe(
        'not_found',
      );
    });

    it('refuses without defaults:manage', async () => {
      const { svc } = fake(emptyState({ roles: [orgRole] }));
      expect(
        await reason(svc.setDefault(actor([]), { key: APP_DEFAULT.organizationFounderRole, value: 'r-org' })),
      ).toBe('not_permitted');
    });

    /**
     * ⚠ THE LEVEL CHECK, from the write side. The screen filters its picker the
     * same way, so this is the second of two readings rather than the only one
     * — but it is the one an API caller cannot skip.
     */
    it('refuses a role at the wrong level for the slot', async () => {
      const { svc } = fake(emptyState({ roles: [orgRole] }));
      expect(
        await reason(svc.setDefault(actor([FEATURE.defaultsManage]), { key: APP_DEFAULT.accountRole, value: 'r-org' })),
      ).toBe('not_found');
    });

    it('refuses a value whose shape is wrong for its kind', async () => {
      const { svc } = fake();
      const a = actor([FEATURE.defaultsManage]);
      expect(await reason(svc.setDefault(a, { key: APP_DEFAULT.organizationPlanPeriodDays, value: '0' }))).toBe(
        'draft_invalid',
      );
      expect(await reason(svc.setDefault(a, { key: APP_DEFAULT.organizationPlanStatus, value: 'Active' }))).toBe(
        'draft_invalid',
      );
    });

    /**
     * Clearing writes NULL rather than deleting the row: "nobody ever set this"
     * and "somebody deliberately turned it off" are different facts, and only
     * the second has an author worth recording.
     */
    it('clears by writing null, and treats an empty string the same way', async () => {
      const { svc, writes } = fake(emptyState({ roles: [orgRole] }));
      const a = actor([FEATURE.defaultsManage]);

      await svc.setDefault(a, { key: APP_DEFAULT.organizationFounderRole, value: '' });
      expect(writes.defaults).toEqual([{ key: APP_DEFAULT.organizationFounderRole, value: null }]);
    });
  });

  describe('createOrganization', () => {
    const founder = () => actor([], { [LIMIT.userOrganizations]: null });

    it('grants the founder the default organization role', async () => {
      const { svc, state } = fake(
        emptyState({ roles: [orgRole], defaults: [{ key: APP_DEFAULT.organizationFounderRole, value: 'r-org' }] }),
      );

      const { membershipId } = await svc.createOrganization(founder(), { key: 'new', name: 'New' });
      expect(state.membershipRoles).toEqual([{ membershipId, roleId: 'r-org' }]);
    });

    /**
     * ⚠ WITHOUT THE ACTOR HOLDING THE ROLE'S OWN FEATURES, and that is the
     * design rather than a hole. `assignRole` refuses a role carrying features
     * the granter does not hold; a founder holds `user:organizations` and
     * nothing else, so routing this through that check would mean the default
     * never applied to the one person it exists for. The authorisation happened
     * once, on `defaults:manage`.
     */
    it('does so even though the founder could not grant that role by hand', async () => {
      const { svc, state } = fake(
        emptyState({ roles: [orgRole], defaults: [{ key: APP_DEFAULT.organizationFounderRole, value: 'r-org' }] }),
      );

      await svc.createOrganization(founder(), { key: 'new', name: 'New' });
      expect(state.membershipRoles).toHaveLength(1);
    });

    it('still creates the organization when the default points at a role that is gone', async () => {
      const { svc, state } = fake(
        emptyState({ roles: [], defaults: [{ key: APP_DEFAULT.organizationFounderRole, value: 'deleted' }] }),
      );

      const { organizationId } = await svc.createOrganization(founder(), { key: 'new', name: 'New' });
      expect(organizationId).toBeTruthy();
      expect(state.membershipRoles).toEqual([]);
    });

    it('starts the default plan, organization-wide and active', async () => {
      const { svc, writes } = fake(
        emptyState({
          plans: [{ key: 'pro', label: 'Pro', isPublic: true, icon: null, archivedAt: null }],
          defaults: [{ key: APP_DEFAULT.organizationPlan, value: 'pro' }],
        }),
      );

      await svc.createOrganization(founder(), { key: 'new', name: 'New' });
      expect(writes.subscriptions).toHaveLength(1);
      expect(writes.subscriptions[0]).toMatchObject({ planKey: 'pro', workspaceId: null, status: 'active' });
    });

    /**
     * ⚠ An ARCHIVED plan is SKIPPED, not refused. `setDefault` refuses to set
     * one, but a plan can be archived long after it became the default — and an
     * archived plan entitles nothing, so subscribing to it would create a row
     * that looks live and grants nothing. No row is the clearer answer.
     */
    it('skips an archived default plan rather than subscribing to it', async () => {
      const { svc, writes } = fake(
        emptyState({
          plans: [{ key: 'old', label: 'Old', isPublic: true, icon: null, archivedAt: new Date() }],
          defaults: [{ key: APP_DEFAULT.organizationPlan, value: 'old' }],
        }),
      );

      await svc.createOrganization(founder(), { key: 'new', name: 'New' });
      expect(writes.subscriptions).toEqual([]);
    });

    it('writes no subscription at all when no plan default is set', async () => {
      const { svc, writes } = fake(emptyState({ plans: [] }));
      await svc.createOrganization(founder(), { key: 'new', name: 'New' });
      expect(writes.subscriptions).toEqual([]);
    });
  });

  describe('createWorkspace', () => {
    const creator = () => actor([FEATURE.workspacesCreate]);

    it('grants the creator the default workspace role', async () => {
      const { svc, state } = fake(
        emptyState({
          memberships: [{ id: 'm1', userId: 'actor', organizationId: 'org1' }],
          roles: [wsRole],
          defaults: [{ key: APP_DEFAULT.workspaceCreatorRole, value: 'r-ws' }],
        }),
      );

      await svc.createWorkspace(creator(), { organizationId: 'org1', key: 'ws', name: 'WS' });
      expect(state.workspaceMemberRoles).toHaveLength(1);
      expect(state.workspaceMemberRoles[0]?.roleId).toBe('r-ws');
    });

    /**
     * ⚠ PLATFORM STAFF JOIN NOTHING, so there is no workspace member row to
     * hang a role off. That is correct rather than a shortfall: they enter by
     * `platform:support_access`, the single exemption from membership, and
     * writing them a role would make a support visit look like joining.
     */
    it('grants nothing to a creator who is not a member of the tenant', async () => {
      const { svc, state } = fake(
        emptyState({
          memberships: [],
          roles: [wsRole],
          defaults: [{ key: APP_DEFAULT.workspaceCreatorRole, value: 'r-ws' }],
        }),
      );

      const result = await svc.createWorkspace(creator(), { organizationId: 'org1', key: 'ws', name: 'WS' });
      expect(result.joined).toBe(false);
      expect(state.workspaceMemberRoles).toEqual([]);
    });
  });

  /**
   * ⚠ THE DATABASE SETTING LAYERS OVER THE MODULE OPTION, and the order is the
   * whole migration story.
   *
   * `defaultAppRoleKey` was the first answer to "what does a new account hold"
   * and is now the FALLBACK. It is kept rather than removed so a deployment
   * that never opens the Defaults screen goes on behaving exactly as it did —
   * every default starts unset and the migration seeds nothing, so on the day
   * this shipped, nothing changed anywhere.
   */
  describe('the account role default', () => {
    const invitation = (h: ReturnType<typeof fake>) =>
      h.svc.inviteMember(actor([FEATURE.membersInvite]), 'org1', { email: 'a@b.com', roleId: '' });

    it('falls back to the module option when nothing is set', async () => {
      const h = fake(emptyState({ roles: [appRole] }), { defaultAppRoleKey: 'normal-user' });
      await invitation(h);
      await h.svc.acceptInvitation({ token: h.writes.sent[0]?.token ?? '', userId: 'newcomer' });

      expect(h.writes.userRoles).toEqual([{ userId: 'newcomer', roleId: 'r-app' }]);
    });

    it('prefers the stored default over the module option', async () => {
      const chosen = { id: 'r-app2', key: 'staff', label: 'Staff', level: 'app', organizationId: null };
      const h = fake(
        emptyState({ roles: [appRole, chosen], defaults: [{ key: APP_DEFAULT.accountRole, value: 'r-app2' }] }),
        { defaultAppRoleKey: 'normal-user' },
      );
      await invitation(h);
      await h.svc.acceptInvitation({ token: h.writes.sent[0]?.token ?? '', userId: 'newcomer' });

      expect(h.writes.userRoles).toEqual([{ userId: 'newcomer', roleId: 'r-app2' }]);
    });

    /**
     * Clearing on the screen hands the question BACK to the option rather than
     * turning the baseline off. A row with a null value and no row are the same
     * answer here — "nobody has decided" — and the deployment's own
     * configuration is what decided before anybody could.
     */
    it('returns to the module option when the stored default is cleared', async () => {
      const h = fake(emptyState({ roles: [appRole], defaults: [{ key: APP_DEFAULT.accountRole, value: null }] }), {
        defaultAppRoleKey: 'normal-user',
      });
      await invitation(h);
      await h.svc.acceptInvitation({ token: h.writes.sent[0]?.token ?? '', userId: 'newcomer' });

      expect(h.writes.userRoles).toEqual([{ userId: 'newcomer', roleId: 'r-app' }]);
    });
  });

  describe('addMember', () => {
    it('grants the default member role to somebody joining', async () => {
      const { svc, state } = fake(
        emptyState({ roles: [orgRole], defaults: [{ key: APP_DEFAULT.organizationMemberRole, value: 'r-org' }] }),
      );

      const { membershipId } = await svc.addMember(actor([FEATURE.membersInvite]), {
        organizationId: 'org1',
        userId: 'u2',
      });
      expect(state.membershipRoles).toEqual([{ membershipId, roleId: 'r-org' }]);
    });
  });

  describe('acceptInvitation', () => {
    /**
     * ⚠ THE DEFAULT NEVER OVERWRITES AN EXISTING MEMBER'S ROLE. An invitation
     * naming no role is not a request to change anything, and the inviter is
     * looking at an ADDRESS rather than at an account — the same lesson the
     * app-role half of this method already learned the hard way.
     */
    it('leaves an existing member’s role alone', async () => {
      const h = fake(
        emptyState({
          memberships: [{ id: 'm1', userId: 'u2', organizationId: 'org1' }],
          membershipRoles: [{ membershipId: 'm1', roleId: 'r-other' }],
          roles: [orgRole],
          defaults: [{ key: APP_DEFAULT.organizationMemberRole, value: 'r-org' }],
        }),
      );
      await h.svc.inviteMember(actor([FEATURE.membersInvite]), 'org1', { email: 'a@b.com', roleId: '' });
      const token = h.writes.sent[0]?.token ?? '';

      await h.svc.acceptInvitation({ token, userId: 'u2' });
      expect(h.state.membershipRoles).toEqual([{ membershipId: 'm1', roleId: 'r-other' }]);
    });

    /** But somebody genuinely JOINING gets it — the hole the default fills. */
    it('grants it to somebody actually joining', async () => {
      const h = fake(
        emptyState({ roles: [orgRole], defaults: [{ key: APP_DEFAULT.organizationMemberRole, value: 'r-org' }] }),
      );
      await h.svc.inviteMember(actor([FEATURE.membersInvite]), 'org1', { email: 'a@b.com', roleId: '' });
      const token = h.writes.sent[0]?.token ?? '';

      await h.svc.acceptInvitation({ token, userId: 'newcomer' });
      expect(h.state.membershipRoles.map((row) => row.roleId)).toEqual(['r-org']);
    });
  });
});

/**
 * The one default that points at neither a role nor a plan.
 *
 * Added after the first eight, and the reason the catalogue exists as a
 * catalogue: it needed no schema change, no mutation and no screen work — one
 * entry in `APP_DEFAULT_REGISTRY` and one call site.
 */
describe('the invitation lifetime default', () => {
  const inviter = () => actor([FEATURE.membersInvite]);

  /**
   * ⚠ EXPIRY IS DERIVED on every read — `isAcceptable` compares the column to
   * the clock rather than trusting a status — so the figure written here is
   * what that comparison uses for the life of the row.
   */
  it('writes the configured invitation lifetime onto the row', async () => {
    const h = fake(emptyState({ defaults: [{ key: APP_DEFAULT.invitationExpiryDays, value: '2' }] }));
    await h.svc.inviteMember(inviter(), 'org1', { email: 'a@b.com', roleId: '' });

    const expiresAt = h.state.invitations[0]?.expiresAt.getTime() ?? 0;
    const twoDays = Date.now() + 2 * 24 * 60 * 60 * 1000;
    // A minute of slack: the service reads its own clock, not the test's.
    expect(Math.abs(expiresAt - twoDays)).toBeLessThan(60_000);
  });

  /**
   * A lifetime that cannot be read must NOT become zero — every invitation sent
   * from that moment would arrive already expired, which is the one failure a
   * fail-soft default must not have.
   */
  it('falls back to seven days when the value is unusable', async () => {
    const h = fake(emptyState({ defaults: [{ key: APP_DEFAULT.invitationExpiryDays, value: 'soon' }] }));
    await h.svc.inviteMember(inviter(), 'org1', { email: 'a@b.com', roleId: '' });

    const expiresAt = h.state.invitations[0]?.expiresAt.getTime() ?? 0;
    expect(Math.abs(expiresAt - (Date.now() + 7 * 24 * 60 * 60 * 1000))).toBeLessThan(60_000);
  });
});
