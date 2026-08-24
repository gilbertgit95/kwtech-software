import { LIMIT } from '../src/domain/limits.js';
import { FEATURE } from '../src/feature-keys.js';
import type {
  MembershipRow,
  PermissionsPrismaClient,
  RoleWithFeatures,
  SubscriptionRow,
  UserRoleRow,
  WorkspaceMemberRow,
} from '../src/server/permissions.repository.js';
import { PermissionsService } from '../src/server/permissions.service.js';

/**
 * The service is exercised against a literal object, not a database.
 *
 * That is the payoff of `PermissionsPrismaClient` being a STRUCTURAL interface
 * the host injects: the module opens no connection, so its own tests need none.
 *
 * The suite is organised around the review's findings — C1/C2/C3, H2, H3 —
 * because those are the rules that, if they regress, regress silently.
 */

interface Db {
  userRoles?: UserRoleRow[];
  membership?: MembershipRow | null;
  workspace?: { id: string } | null;
  workspaceMember?: WorkspaceMemberRow | null;
  subscriptions?: SubscriptionRow[];
  counts?: Partial<Record<'membership' | 'workspace' | 'workspaceMember', number>>;
}

/** Records every query, so "did it ask at all" is testable, not just the answer. */
interface Calls {
  userRole: unknown[];
  membership: unknown[];
  workspace: unknown[];
  workspaceMember: unknown[];
  subscription: unknown[];
}

function fakePrisma(db: Db = {}): { client: PermissionsPrismaClient; calls: Calls } {
  const calls: Calls = { userRole: [], membership: [], workspace: [], workspaceMember: [], subscription: [] };
  const client: PermissionsPrismaClient = {
    permUserRole: {
      findMany: async (args) => {
        calls.userRole.push(args);
        return db.userRoles ?? [];
      },
    },
    permMembership: {
      findFirst: async (args) => {
        calls.membership.push(args);
        return db.membership ?? null;
      },
      count: async () => db.counts?.membership ?? 0,
    },
    permWorkspace: {
      findFirst: async (args) => {
        calls.workspace.push(args);
        return db.workspace === undefined ? { id: 'ws1' } : db.workspace;
      },
      count: async () => db.counts?.workspace ?? 0,
    },
    permWorkspaceMember: {
      findFirst: async (args) => {
        calls.workspaceMember.push(args);
        return db.workspaceMember ?? null;
      },
      count: async () => db.counts?.workspaceMember ?? 0,
    },
    permSubscription: {
      findMany: async (args) => {
        calls.subscription.push(args);
        return db.subscriptions ?? [];
      },
    },
  };
  return { client, calls };
}

const service = (db?: Db) => {
  const { client, calls } = fakePrisma(db);
  return { svc: new PermissionsService(client), calls };
};

/** A scoped (organization/workspace) role, as the membership queries return it. */
const role = (over: Partial<RoleWithFeatures> & Pick<RoleWithFeatures, 'key' | 'level'>): RoleWithFeatures => ({
  organizationId: null,
  features: [],
  ...over,
});

/**
 * An APP-level role. The only query that also includes limits — see the note on
 * RoleWithFeatures for why the two shapes are not one.
 */
const appRole = (
  over: Partial<UserRoleRow['role']> & Pick<UserRoleRow['role'], 'key' | 'level'>,
): UserRoleRow['role'] => ({ features: [], limits: [], ...over });

const membership = (over: Partial<MembershipRow> = {}): MembershipRow => ({
  id: 'm1',
  organizationId: 'org1',
  roles: [],
  workspaces: [],
  ...over,
});

const plan = (features: string[], limits: { limitKey: string; value: number }[] = []): SubscriptionRow => ({
  planKey: 'pro',
  workspaceId: null,
  plan: { features: features.map((featureKey) => ({ featureKey })), limits },
});

describe('loadContext — app level short-circuits', () => {
  it('answers from app roles alone, without touching membership or subscription', () => {
    // Not only an optimisation: querying a membership with no organization in
    // hand would pick an arbitrary one and answer a question nobody asked.
    const { svc, calls } = service({
      userRoles: [
        { role: appRole({ key: 'support', level: 'app', features: [{ featureKey: FEATURE.platformSupportAccess }] }) },
      ],
    });

    return svc.loadContext('u1').then((ctx) => {
      expect(ctx?.effective).toEqual([FEATURE.platformSupportAccess]);
      expect(ctx?.organizationId).toBeNull();
      expect(calls.membership).toHaveLength(0);
      expect(calls.subscription).toHaveLength(0);
    });
  });

  it('returns null for a user with no app roles and no organization asked about', () => {
    return service()
      .svc.loadContext('u1')
      .then((ctx) => expect(ctx).toBeNull());
  });

  it('resolves role-sourced limits at app level, where no subscription exists', () => {
    const { svc } = service({
      userRoles: [
        { role: appRole({ key: 'staff', level: 'app', limits: [{ limitKey: LIMIT.userOrganizations, value: 25 }] }) },
      ],
    });

    return svc.loadContext('u1').then((ctx) => expect(ctx?.limits[LIMIT.userOrganizations]).toBe(25));
  });
});

describe('loadContext — a caller with no membership', () => {
  it('returns null when they hold no app role either', () => {
    const { svc } = service({ membership: null });
    return svc.loadContext('u1', { organizationId: 'org1' }).then((ctx) => expect(ctx).toBeNull());
  });

  it('still returns a usable context for platform staff, who belong to no organization', () => {
    // Returning null here would lock support out of every organization they
    // exist to help.
    const { svc } = service({
      membership: null,
      userRoles: [
        { role: appRole({ key: 'support', level: 'app', features: [{ featureKey: FEATURE.platformSupportAccess }] }) },
      ],
    });

    return svc.loadContext('u1', { organizationId: 'org1' }).then((ctx) => {
      expect(ctx?.organizationId).toBe('org1');
      expect(ctx?.effective).toEqual([FEATURE.platformSupportAccess]);
      // No subscription is loaded, so their access does not depend on this
      // customer's billing state.
      expect(ctx?.entitled).toBeNull();
    });
  });
});

describe('C2/H3 — the workspace must belong to the organization, and must not be archived', () => {
  it('returns null when the workspace does not resolve', () => {
    // Treated as not found rather than as a denial: the caller learns nothing
    // about whether the workspace exists elsewhere.
    const { svc } = service({ membership: membership(), workspace: null });
    return svc
      .loadContext('u1', { organizationId: 'org1', workspaceId: 'foreign' })
      .then((ctx) => expect(ctx).toBeNull());
  });

  it('scopes the lookup by organization AND archivedAt in one query', () => {
    const { svc, calls } = service({ membership: membership() });

    return svc.loadContext('u1', { organizationId: 'org1', workspaceId: 'ws1' }).then(() => {
      expect(calls.workspace[0]).toMatchObject({
        where: { id: 'ws1', organizationId: 'org1', archivedAt: null },
      });
    });
  });

  it('does not look a workspace up when none was asked about', () => {
    const { svc, calls } = service({ membership: membership() });
    return svc.loadContext('u1', { organizationId: 'org1' }).then(() => expect(calls.workspace).toHaveLength(0));
  });
});

describe('C3 — a role defined by one organization never grants in another', () => {
  it('discards an organization-level grant whose role belongs to another tenant', () => {
    const { svc } = service({
      membership: membership({
        roles: [
          {
            role: role({
              key: 'foreign',
              level: 'organization',
              organizationId: 'org2',
              features: [{ featureKey: FEATURE.billingManage }],
            }),
          },
          {
            role: role({
              key: 'ours',
              level: 'organization',
              organizationId: 'org1',
              features: [{ featureKey: FEATURE.membersManage }],
            }),
          },
        ],
      }),
    });

    return svc.loadContext('u1', { organizationId: 'org1' }).then((ctx) => {
      expect(ctx?.granted).toEqual([FEATURE.membersManage]);
    });
  });

  it('keeps a shared preset, which belongs to no organization', () => {
    const { svc } = service({
      membership: membership({
        roles: [
          {
            role: role({
              key: 'preset',
              level: 'organization',
              organizationId: null,
              features: [{ featureKey: FEATURE.adminAccess }],
            }),
          },
        ],
      }),
    });

    return svc
      .loadContext('u1', { organizationId: 'org1' })
      .then((ctx) => expect(ctx?.granted).toEqual([FEATURE.adminAccess]));
  });

  it('applies the same filter to workspace roles', () => {
    const { svc } = service({
      membership: membership(),
      workspaceMember: {
        id: 'wm1',
        workspaceId: 'ws1',
        roles: [
          {
            role: role({
              key: 'foreign',
              level: 'workspace',
              organizationId: 'org2',
              features: [{ featureKey: FEATURE.workspacesShare }],
            }),
          },
        ],
      },
    });

    return svc
      .loadContext('u1', { organizationId: 'org1', workspaceId: 'ws1' })
      .then((ctx) => expect(ctx?.granted).toEqual([]));
  });
});

describe('H2 — deprecation revokes', () => {
  it('filters role features on deprecatedAt in the query, for every read', () => {
    // Filtered in the query rather than in composeContext: the module's registry
    // holds only ITS features, so filtering there would drop every other
    // module's keys. PermFeature is the shared table and the only place that
    // can answer for all modules at once.
    const { svc, calls } = service({ membership: membership() });

    return svc.loadContext('u1', { organizationId: 'org1', workspaceId: 'ws1' }).then(() => {
      const active = { where: { feature: { deprecatedAt: null } } };
      expect(calls.userRole[0]).toMatchObject({ include: { role: { include: { features: active } } } });
      expect(calls.membership[0]).toMatchObject({
        include: { roles: { include: { role: { include: { features: active } } } } },
      });
      expect(calls.workspaceMember[0]).toMatchObject({
        include: { roles: { include: { role: { include: { features: active } } } } },
      });
    });
  });
});

describe('loadContext — subscriptions', () => {
  it('loads organization-wide plans plus the active workspace’s own, additively', () => {
    const { svc, calls } = service({ membership: membership() });

    return svc.loadContext('u1', { organizationId: 'org1', workspaceId: 'ws1' }).then(() => {
      expect(calls.subscription[0]).toMatchObject({
        where: { organizationId: 'org1', status: 'active', OR: [{ workspaceId: null }, { workspaceId: 'ws1' }] },
      });
    });
  });

  it('asks only for organization-wide plans when no workspace is active', () => {
    const { svc, calls } = service({ membership: membership() });

    return svc.loadContext('u1', { organizationId: 'org1' }).then(() => {
      expect(calls.subscription[0]).toMatchObject({ where: { OR: [{ workspaceId: null }] } });
    });
  });

  it('entitles nothing — not everything — when a member’s organization has no active plan', () => {
    const { svc } = service({
      membership: membership({
        roles: [
          { role: role({ key: 'admin', level: 'organization', features: [{ featureKey: FEATURE.membersManage }] }) },
        ],
      }),
      subscriptions: [],
    });

    return svc.loadContext('u1', { organizationId: 'org1' }).then((ctx) => {
      expect(ctx?.entitled).toEqual([]);
      expect(ctx?.effective).toEqual([]);
      expect(ctx?.granted).toEqual([FEATURE.membersManage]);
    });
  });

  it('reads plan LIMITS as well as plan features', () => {
    // Regression test. The query previously included only `features` while the
    // mapping below it read `sub.plan.limits`, so every plan-sourced cap threw
    // on the first guarded request that reached a subscription.
    const { svc, calls } = service({
      membership: membership(),
      subscriptions: [plan([FEATURE.membersManage], [{ limitKey: LIMIT.organizationMembers, value: 50 }])],
    });

    return svc.loadContext('u1', { organizationId: 'org1' }).then((ctx) => {
      expect(calls.subscription[0]).toMatchObject({ include: { plan: { include: { limits: true } } } });
      expect(ctx?.limits[LIMIT.organizationMembers]).toBe(50);
    });
  });
});

describe('loadContext — accessible workspaces', () => {
  it('lists the member’s workspaces', () => {
    const { svc } = service({
      membership: membership({ workspaces: [{ workspaceId: 'ws1' }, { workspaceId: 'ws2' }] }),
    });
    return svc
      .loadContext('u1', { organizationId: 'org1' })
      .then((ctx) => expect(ctx?.accessibleWorkspaceIds).toEqual(['ws1', 'ws2']));
  });

  it('is null for an organization admin holding workspaces:access_all', () => {
    const { svc } = service({
      membership: membership({
        roles: [
          {
            role: role({
              key: 'admin',
              level: 'organization',
              features: [{ featureKey: FEATURE.workspacesAccessAll }],
            }),
          },
        ],
      }),
      subscriptions: [plan([FEATURE.workspacesAccessAll])],
    });

    return svc
      .loadContext('u1', { organizationId: 'org1' })
      .then((ctx) => expect(ctx?.accessibleWorkspaceIds).toBeNull());
  });
});

describe('checkCapacity', () => {
  const ctx = {
    subjectId: 'u1',
    organizationId: 'org1',
    workspaceId: 'ws1',
    granted: [],
    grantedAtAppLevel: [],
    effective: [],
    accessibleWorkspaceIds: null,
    entitled: null,
    limits: { [LIMIT.organizationMembers]: 3, [LIMIT.userOrganizations]: 2 },
  } as const;

  it('counts current members against the plan cap', () => {
    const { svc } = service({ counts: { membership: 2 } });
    return svc
      .checkCapacity(ctx, LIMIT.organizationMembers)
      .then((d) => expect(d).toEqual({ allowed: true, limit: 3, current: 2, remaining: 1 }));
  });

  it('refuses once the cap is reached', () => {
    const { svc } = service({ counts: { membership: 3 } });
    return svc.checkCapacity(ctx, LIMIT.organizationMembers).then((d) => expect(d.allowed).toBe(false));
  });

  it('throws on an unregistered key rather than resolving it to "no cap"', () => {
    // An unknown key would otherwise come back unrestricted and quietly allow
    // everything, so a typo fails loudly.
    return expect(service().svc.checkCapacity(ctx, 'made:up')).rejects.toThrow(/Unknown limit 'made:up'/);
  });

  it('counts organizations per user for the role-sourced cap', () => {
    const { svc } = service({ counts: { membership: 2 } });
    return svc
      .checkCapacity(ctx, LIMIT.userOrganizations)
      .then((d) => expect(d).toMatchObject({ allowed: false, limit: 2, current: 2 }));
  });

  it('honours an explicit target over the context’s own scope', () => {
    const { svc } = service({ counts: { workspaceMember: 0 } });
    return svc
      .checkCapacity(ctx, LIMIT.workspaceMembers, { workspaceId: 'other' })
      .then((d) => expect(d).toMatchObject({ allowed: true, limit: null }));
  });
});
