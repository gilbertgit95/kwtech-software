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
  memberships: { id: string; userId: string; organizationId: string }[];
  workspaces: { id: string; organizationId: string; archivedAt: Date | null }[];
  workspaceMembers: { id: string; membershipId: string; workspaceId: string }[];
  membershipRoles: { membershipId: string; roleId: string }[];
  workspaceMemberRoles: { workspaceMemberId: string; roleId: string }[];
  roles: { id: string; key: string; label: string; level: string; organizationId: string | null }[];
  /** App-level grants, so the baseline default has something to check. */
  userRoles: { userId: string; role: Record<string, unknown> }[];
  organizations: { id: string; key: string; name: string }[];
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
  organizations: [{ id: 'org1', key: 'acme', name: 'Acme' }],
  invitations: [],
  plans: [],
  planFeatures: [],
  planLimits: [],
  subscriptions: [],
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
  invitations: unknown[];
  /** Every invitation email the fake host was asked to send. */
  sent: { email: string; token: string; organization: { id: string; key: string; name: string } | null }[];
  transactions: number;
}

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
      findFirst: async (args: { where: { userId: string; organizationId?: string } }) => {
        const row = state.memberships.find(
          (m) =>
            m.userId === args.where.userId &&
            (!args.where.organizationId || m.organizationId === args.where.organizationId),
        );
        return row ? { ...row, roles: [], workspaces: [] } : null;
      },
      count: async (args: { where: { organizationId?: string; userId?: string } }) =>
        state.memberships.filter(
          (m) =>
            (args.where.organizationId === undefined || m.organizationId === args.where.organizationId) &&
            (args.where.userId === undefined || m.userId === args.where.userId),
        ).length,
      create: async (args: { data: { userId: string; organizationId: string } }) => {
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
      findFirst: async (args: { where: { id: string } | { key: string } }) =>
        state.roles.find((r) => ('id' in args.where ? r.id === args.where.id : r.key === args.where.key)) ?? null,
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
      svc.addMember(actor([FEATURE.membersManage], { [LIMIT.organizationMembers]: 1 }), {
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
      svc.addMember(actor([FEATURE.membersManage], { [LIMIT.organizationMembers]: 2 }), {
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
    const a = actor([FEATURE.workspacesManage], { [LIMIT.organizationWorkspaces]: 2 });

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
        svc.shareWorkspace(actor([FEATURE.workspacesShare], { [LIMIT.workspaceMembers]: 1 }), {
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
      svc.addMember(actor([FEATURE.membersManage], { [LIMIT.organizationMembers]: null }), {
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
        svc.assignRole(actor([FEATURE.membersManage]), { organizationId: 'org1', userId: 'u2', roleId: 'r1' }),
      ),
    ).toBe('role_foreign_to_organization');
    // The read side would have discarded it; this stops the row existing at all.
    expect(writes.membershipRoles).toHaveLength(0);
  });

  it('accepts a shared preset, which belongs to no organization', async () => {
    const { svc } = withRole('organization', null);
    await expect(
      svc.assignRole(actor([FEATURE.membersManage]), { organizationId: 'org1', userId: 'u2', roleId: 'r1' }),
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
        svc.assignWorkspaceRole(actor([FEATURE.workspacesShare]), {
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
        svc.assignRole(actor([FEATURE.membersManage]), { organizationId: 'org1', userId: 'u2', roleId: 'r1' }),
      ),
    ).toBe('role_level_mismatch');
  });

  it('refuses an app-level role through a membership — it belongs on PermUserRole', async () => {
    const { svc } = withRole('app', null);
    expect(
      await reason(
        svc.assignRole(actor([FEATURE.membersManage]), { organizationId: 'org1', userId: 'u2', roleId: 'r1' }),
      ),
    ).toBe('role_level_mismatch');
  });

  it('validates the stored level rather than casting it', async () => {
    const { svc } = withRole('Organization', 'org1');
    await expect(
      svc.assignRole(actor([FEATURE.membersManage]), { organizationId: 'org1', userId: 'u2', roleId: 'r1' }),
    ).rejects.toThrow(/Unknown role level/);
  });

  it('refuses an unknown role id', async () => {
    const { svc } = fake(emptyState({ memberships: [{ id: 'm2', userId: 'u2', organizationId: 'org1' }] }));
    expect(
      await reason(
        svc.assignRole(actor([FEATURE.membersManage]), { organizationId: 'org1', userId: 'u2', roleId: 'nope' }),
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
        svc.assignRole(actor([FEATURE.membersManage]), { organizationId: 'org1', userId: 'stranger', roleId: 'r1' }),
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
        svc.shareWorkspace(actor([FEATURE.workspacesShare]), {
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
        svc.shareWorkspace(actor([FEATURE.workspacesShare]), {
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
        svc.archiveWorkspace(actor([FEATURE.workspacesManage]), { organizationId: 'org1', workspaceId: 'wsX' }),
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
    expect(await reason(call(svc, actor([FEATURE.membersManage, FEATURE.workspacesManage])))).toBe('not_found');
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
      svc.assignRole(actor([FEATURE.membersManage]), { organizationId: 'org1', userId: 'u2', roleId: 'r1' }),
    ).resolves.toEqual({ granted: false, replaced: false });
  });

  it('re-sharing an already shared workspace reports shared: false', async () => {
    const { svc, writes } = shared();
    await expect(
      svc.shareWorkspace(actor([FEATURE.workspacesShare]), {
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
      svc.revokeRole(actor([FEATURE.membersManage]), { organizationId: 'org1', userId: 'u2', roleId: 'r1' }),
    ).resolves.toEqual({ revoked: false });
  });

  it('adding an existing member is an error, because it is not the same request twice', async () => {
    // Unlike a grant, "add this person" carries an intent that has already been
    // satisfied differently — silently succeeding would hide a stale invite.
    const { svc } = fake(emptyState({ memberships: [{ id: 'm2', userId: 'u2', organizationId: 'org1' }] }));
    expect(await reason(svc.addMember(actor([FEATURE.membersManage]), { organizationId: 'org1', userId: 'u2' }))).toBe(
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
        svc.assignWorkspaceRole(actor([FEATURE.workspacesShare]), {
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
      svc.assignWorkspaceRole(actor([FEATURE.workspacesShare]), {
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
        { key: 'sharer', label: 'Sharer', level: 'workspace', features: [FEATURE.workspacesShare] },
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
    svc.assignRole(actor([FEATURE.membersManage]), { organizationId: 'org1', userId: 'u2', roleId });

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

    await svc.revokeRole(actor([FEATURE.membersManage]), {
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
    const act = actor([FEATURE.workspacesShare]);
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
    const act = actor([FEATURE.workspacesShare]);
    const input = { organizationId: 'org1', workspaceId: 'ws1', userId: 'u2', roleId: 'r-a' };

    await svc.assignWorkspaceRole(act, input);
    expect(await svc.assignWorkspaceRole(act, input)).toEqual({ granted: false, replaced: false });
    expect(state.workspaceMemberRoles).toHaveLength(1);
  });
});

describe('invitations', () => {
  const inviter = () => actor([FEATURE.membersManage]);

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
