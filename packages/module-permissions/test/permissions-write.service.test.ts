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
  roles: { id: string; key: string; level: string; organizationId: string | null }[];
}

const emptyState = (over: Partial<State> = {}): State => ({
  memberships: [],
  workspaces: [],
  workspaceMembers: [],
  membershipRoles: [],
  workspaceMemberRoles: [],
  roles: [],
  ...over,
});

/** Records writes so a refusal can be shown to have happened before one. */
interface Writes {
  organizations: unknown[];
  memberships: unknown[];
  workspaces: unknown[];
  workspaceMembers: unknown[];
  membershipRoles: unknown[];
  workspaceMemberRoles: unknown[];
  transactions: number;
}

function fake(state: State = emptyState()) {
  const writes: Writes = {
    organizations: [],
    memberships: [],
    workspaces: [],
    workspaceMembers: [],
    membershipRoles: [],
    workspaceMemberRoles: [],
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
      create: async (args: { data: { key: string; name: string } }) => {
        writes.organizations.push(args.data);
        return { id: id('org') };
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
      findFirst: async (args: { where: { id: string } }) => state.roles.find((r) => r.id === args.where.id) ?? null,
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
      deleteMany: async (args: { where: { membershipId: string; roleId: string } }) => {
        const before = state.membershipRoles.length;
        state.membershipRoles = state.membershipRoles.filter(
          (r) => !(r.membershipId === args.where.membershipId && r.roleId === args.where.roleId),
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
      deleteMany: async (args: { where: { workspaceMemberId: string; roleId: string } }) => {
        const before = state.workspaceMemberRoles.length;
        state.workspaceMemberRoles = state.workspaceMemberRoles.filter(
          (r) => !(r.workspaceMemberId === args.where.workspaceMemberId && r.roleId === args.where.roleId),
        );
        return { count: before - state.workspaceMemberRoles.length };
      },
    },
    permUserRole: { findMany: async () => [] },
    permSubscription: { findMany: async () => [] },
  } as unknown as PermissionsWriteClient;

  return { svc: new PermissionsWriteService(client), writes, state };
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
        roles: [{ id: 'r1', key: 'their-admin', level, organizationId }],
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
    ).resolves.toEqual({ granted: true });
  });

  it('refuses an organization-level role attached at workspace level', async () => {
    const { svc } = fake(
      emptyState({
        memberships: [{ id: 'm2', userId: 'u2', organizationId: 'org1' }],
        workspaceMembers: [{ id: 'wm1', membershipId: 'm2', workspaceId: 'ws1' }],
        roles: [{ id: 'r1', key: 'billing', level: 'organization', organizationId: 'org1' }],
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
    const { svc } = fake(emptyState({ roles: [{ id: 'r1', key: 'a', level: 'organization', organizationId: null }] }));
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

describe('idempotence — retrying a write is not an error', () => {
  const shared = () =>
    fake(
      emptyState({
        memberships: [{ id: 'm2', userId: 'u2', organizationId: 'org1' }],
        workspaces: [{ id: 'ws1', organizationId: 'org1', archivedAt: null }],
        workspaceMembers: [{ id: 'wm1', membershipId: 'm2', workspaceId: 'ws1' }],
        roles: [{ id: 'r1', key: 'viewer', level: 'workspace', organizationId: null }],
      }),
    );

  it('re-granting a held role reports granted: false rather than throwing', async () => {
    const { svc } = fake(
      emptyState({
        memberships: [{ id: 'm2', userId: 'u2', organizationId: 'org1' }],
        roles: [{ id: 'r1', key: 'a', level: 'organization', organizationId: null }],
        membershipRoles: [{ membershipId: 'm2', roleId: 'r1' }],
      }),
    );

    await expect(
      svc.assignRole(actor([FEATURE.membersManage]), { organizationId: 'org1', userId: 'u2', roleId: 'r1' }),
    ).resolves.toEqual({ granted: false });
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
        roles: [{ id: 'r1', key: 'viewer', level: 'workspace', organizationId: null }],
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
        roles: [{ id: 'r1', key: 'viewer', level: 'workspace', organizationId: null }],
      }),
    );

    await expect(
      svc.assignWorkspaceRole(actor([FEATURE.workspacesShare]), {
        organizationId: 'org1',
        workspaceId: 'ws1',
        userId: 'u2',
        roleId: 'r1',
      }),
    ).resolves.toEqual({ granted: true });
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
        { key: 'a', level: 'organization', organizationId: 'org1' },
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
        { key: 'a', level: 'organization', organizationId: 'org2' },
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
    expect(() => assertNotAppLevel({ key: 'staff', level: 'app', organizationId: null })).toThrow(
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
