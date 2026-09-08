import { LIMIT } from '../src/domain/limits.js';
import { FEATURE } from '../src/feature-keys.js';
import type {
  MembershipRow,
  OrganizationDetailRow,
  OrganizationRow,
  PermissionsPrismaClient,
  PlanDefinitionRow,
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
  roles?: import('../src/server/permissions.repository.js').RoleDefinitionRow[];
  userRoles?: UserRoleRow[];
  membership?: MembershipRow | null;
  workspace?: { id: string } | null;
  workspaceMember?: WorkspaceMemberRow | null;
  subscriptions?: SubscriptionRow[];
  plans?: PlanDefinitionRow[];
  organizations?: OrganizationRow[];
  organizationDetail?: OrganizationDetailRow | null;
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
    // The admin read path; no test here exercises it, but the interface is
    // structural, so a stub is what keeps the fake honest about its shape.
    permRole: { findMany: async () => db.roles ?? [] },
    permUserRole: {
      findMany: async (args) => {
        calls.userRole.push(args);
        return db.userRoles ?? [];
      },
      // The write path `assignAppRole` uses. No test here exercises it — the
      // interface is structural, so a stub is what keeps the fake honest about
      // its shape.
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({}),
    },
    permMembership: {
      // The user administration read. No test here exercises it — the interface
      // is structural, so a stub is what keeps the fake honest about its shape.
      findMany: async () => [],
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
      /*
       * OVERLOADED on the interface: the entitlement query and the admin list
       * ask the same table different questions and get different row shapes. An
       * object literal cannot declare overloads, so the implementation is
       * written once and asserted against the interface's own member type —
       * which still fails the moment that member changes shape, which is the
       * point of the fake being structural.
       *
       * Only the entitlement half is exercised here; `listSubscriptions` has
       * its own test below.
       */
      findMany: async (args) => {
        calls.subscription.push(args);
        return db.subscriptions ?? [];
      },
    },
    // The admin read paths. No permission decision consults either, but the
    // interface is structural, so a stub is what keeps the fake honest.
    permPlan: { findMany: async () => db.plans ?? [] },
    permOrganization: {
      findMany: async () => db.organizations ?? [],
      /*
       * The detail read, stubbed rather than exercised: `listOrganizationDetail`
       * is a projection with no decision in it. The stub is here because the
       * client is STRUCTURAL — leaving it out is a type error, which is the
       * property that stops the fake quietly drifting from the interface.
       */
      findFirst: async () => db.organizationDetail ?? null,
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
): UserRoleRow['role'] => ({ id: `role-${over.key}`, features: [], limits: [], label: over.key, icon: null, ...over });

const membership = (over: Partial<MembershipRow> = {}): MembershipRow => ({
  id: 'm1',
  organizationId: 'org1',
  roles: [],
  workspaces: [],
  ...over,
});

/**
 * One subscription row.
 *
 * Carries more than `loadContext` reads, because ONE row type serves both the
 * entitlement pipeline and the admin list — Prisma's generic `findMany` cannot
 * satisfy an overloaded interface member, so there is one signature and one
 * shape. See `SubscriptionRow`.
 */
const plan = (
  features: string[],
  limits: { limitKey: string; value: number }[] = [],
  over: Partial<Omit<SubscriptionRow, 'plan'>> & { plan?: Partial<SubscriptionRow['plan']> } = {},
): SubscriptionRow => ({
  id: 'sub1',
  organizationId: 'org1',
  planKey: 'pro',
  workspaceId: null,
  status: 'active',
  currentPeriodEnd: null,
  endedAt: null,
  ...over,
  plan: {
    key: 'pro',
    label: 'Pro',
    // Null: no test here draws one, and a plan without an icon is a real state
    // the screens fall back to the label for.
    icon: null,
    archivedAt: null,
    features: features.map((featureKey) => ({ featureKey })),
    limits,
    ...over.plan,
  },
});

describe('loadContext — app level short-circuits', () => {
  it('answers from app roles alone, without touching membership or subscription', () => {
    // Not only an optimisation: querying a membership with no organization in
    // hand would pick an arbitrary one and answer a question nobody asked.
    const { svc, calls } = service({
      userRoles: [
        {
          userId: 'u1',
          role: appRole({ key: 'support', level: 'app', features: [{ featureKey: FEATURE.platformSupportAccess }] }),
        },
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
        {
          userId: 'u1',
          role: appRole({ key: 'staff', level: 'app', limits: [{ limitKey: LIMIT.userOrganizations, value: 25 }] }),
        },
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
        {
          userId: 'u1',
          role: appRole({ key: 'support', level: 'app', features: [{ featureKey: FEATURE.platformSupportAccess }] }),
        },
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
              features: [{ featureKey: FEATURE.featuresRead }],
            }),
          },
        ],
      }),
    });

    return svc
      .loadContext('u1', { organizationId: 'org1' })
      .then((ctx) => expect(ctx?.granted).toEqual([FEATURE.featuresRead]));
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

  /**
   * An ARCHIVED plan must entitle nothing, and the filter has to be in the
   * QUERY rather than applied to what came back — the same call the
   * `disabledAt` and `deprecatedAt` filters beside it make. A row loaded and
   * then dropped still exists for something later to read by mistake, and a
   * column nothing reads is a switch that only looks like it works.
   */
  it('never loads an archived plan', () => {
    const { svc, calls } = service({ membership: membership() });

    return svc.loadContext('u1', { organizationId: 'org1' }).then(() => {
      expect(calls.subscription[0]).toMatchObject({ where: { plan: { archivedAt: null } } });
    });
  });
});

describe('the admin read paths', () => {
  /**
   * The opposite of the entitlement query, deliberately — the same argument
   * `listRoles` makes about disabled roles. An administrator has to see an
   * archived plan in order to restore it, and a list that hid them would make
   * the switch read as a delete.
   */
  it('shows archived plans, and flattens their limits into a map', () => {
    const { svc } = service({
      plans: [
        {
          key: 'legacy',
          label: 'Legacy',
          isPublic: false,
          icon: 'gem',
          archivedAt: new Date(),
          features: [{ featureKey: FEATURE.membersManage }],
          limits: [{ limitKey: LIMIT.organizationMembers, value: 50 }],
        },
      ],
    });

    return svc.listPlans().then((plans) => {
      expect(plans).toHaveLength(1);
      expect(plans[0]?.archived).toBe(true);
      expect(plans[0]?.isPublic).toBe(false);
      // Presentation, carried through untouched — the grid draws it, nothing
      // branches on it.
      expect(plans[0]?.icon).toBe('gem');
      expect(plans[0]?.limits).toEqual({ [LIMIT.organizationMembers]: 50 });
    });
  });

  /**
   * Ended subscriptions are shown for a DIFFERENT reason than archived plans:
   * they have no switch to flip, they are the history. And `planArchived` is
   * carried so a screen can explain a row that reads `active` and is entitling
   * nobody.
   */
  it('joins the organization and workspace names, and says whether the plan is archived', () => {
    const { svc } = service({
      subscriptions: [plan([], [], { workspaceId: 'ws1', plan: { archivedAt: new Date() } })],
      organizations: [
        {
          id: 'org1',
          key: 'acme',
          name: 'Acme',
          memberships: [],
          workspaces: [{ id: 'ws1', key: 'lab', name: 'Lab', archivedAt: null }],
        },
      ],
    });

    return svc.listSubscriptions().then((rows) => {
      expect(rows[0]).toMatchObject({
        organizationName: 'Acme',
        workspaceName: 'Lab',
        // The row reads `active` and entitles nobody, because the plan behind
        // it is archived. Without this field no screen could say why.
        status: 'active',
        planArchived: true,
      });
    });
  });

  /**
   * A subscription outlives the workspace it was attached to, so the LIST keeps
   * archived workspaces where the picker drops them. A row with a blank where a
   * name belongs explains nothing to whoever is working out what a customer had.
   */
  it('still names a workspace that has since been archived', () => {
    const db = {
      subscriptions: [plan([], [], { workspaceId: 'ws1' })],
      organizations: [
        {
          id: 'org1',
          key: 'acme',
          name: 'Acme',
          memberships: [],
          workspaces: [{ id: 'ws1', key: 'lab', name: 'Lab', archivedAt: new Date() }],
        },
      ],
    };

    return Promise.all([service(db).svc.listSubscriptions(), service(db).svc.listOrganizations()]).then(
      ([subscriptions, organizations]) => {
        expect(subscriptions[0]?.workspaceName).toBe('Lab');
        // The picker, on the same query, offers nothing archived.
        expect(organizations[0]?.workspaces).toEqual([]);
      },
    );
  });

  it('reads an organization-wide subscription as one with no workspace', () => {
    const { svc } = service({
      subscriptions: [plan([])],
      organizations: [{ id: 'org1', key: 'acme', name: 'Acme', memberships: [], workspaces: [] }],
    });

    return svc.listSubscriptions().then((rows) => {
      expect(rows[0]?.workspaceId).toBeNull();
      expect(rows[0]?.workspaceName).toBeNull();
      expect(rows[0]?.planArchived).toBe(false);
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

  /**
   * Even an organization administrator sees only the workspaces they were added
   * to. Membership is required and no role widens it — see `composeContext`.
   */
  /**
   * ⚠ REGRESSION TEST FOR A DEMONSTRATED LEAK.
   *
   * Nothing in the schema ties a workspace membership's MEMBERSHIP to its
   * WORKSPACE's organization — the row references each independently, so a
   * cross-tenant row is insertable and one was, against a live database. It
   * surfaced in `accessibleWorkspaceIds`, and `canAccessWorkspace` then returned
   * true for another tenant's workspace. The guard still refused a request
   * naming it, but the UI would have linked somewhere the API turns away.
   *
   * The fix is a `where` on the include, so this asserts the QUERY rather than
   * the result — a fake cannot reproduce a foreign key the schema does not have,
   * and the filter is the thing that must not be removed.
   */
  it('asks only for THIS organization’s live workspaces', () => {
    const { svc, calls } = service({ membership: membership() });

    return svc.loadContext('u1', { organizationId: 'org1' }).then(() => {
      expect(calls.membership[0]).toMatchObject({
        include: { workspaces: { where: { workspace: { organizationId: 'org1', archivedAt: null } } } },
      });
    });
  });

  it('is not widened for an organization admin, however privileged the role', () => {
    const { svc } = service({
      membership: membership({
        workspaces: [{ workspaceId: 'ws1' }],
        roles: [
          {
            role: role({
              key: 'admin',
              level: 'organization',
              features: [{ featureKey: FEATURE.membersManage }, { featureKey: FEATURE.workspacesManage }],
            }),
          },
        ],
      }),
      subscriptions: [plan([FEATURE.membersManage, FEATURE.workspacesManage])],
    });

    return svc
      .loadContext('u1', { organizationId: 'org1' })
      .then((ctx) => expect(ctx?.accessibleWorkspaceIds).toEqual(['ws1']));
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
    appRoles: [],
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

/**
 * A DISABLED role must grant nothing.
 *
 * That is the entire meaning of the switch, and it is enforced in the READ
 * path rather than at the write — a role can be disabled long after it was
 * handed out, so filtering at grant time would leave every existing holder
 * unaffected.
 *
 * These assert the QUERY carries the filter, at all three levels, because that
 * is where the guarantee lives. A row-shape test would pass just as happily
 * against a query that fetched disabled roles and forgot to drop them, which is
 * exactly the regression worth catching: it fails open, silently, and only for
 * the roles somebody deliberately switched off.
 */
describe('disabled roles are excluded from every grant path', () => {
  it('filters app-level roles granted to the user outright', async () => {
    const { svc, calls } = service({ userRoles: [{ userId: 'u1', role: appRole({ key: 'staff', level: 'app' }) }] });
    await svc.loadContext('u1');

    expect(calls.userRole[0]).toMatchObject({ where: { userId: 'u1', role: { disabledAt: null } } });
  });

  it('filters organization-level roles held through a membership', async () => {
    const { svc, calls } = service({ membership: membership() });
    await svc.loadContext('u1', { organizationId: 'org1' });

    expect(calls.membership[0]).toMatchObject({
      include: { roles: { where: { role: { disabledAt: null } } } },
    });
  });

  it('filters workspace-level roles held through a workspace membership', async () => {
    const { svc, calls } = service({
      membership: membership(),
      workspaceMember: { id: 'wm1', workspaceId: 'ws1', roles: [] },
    });
    await svc.loadContext('u1', { organizationId: 'org1', workspaceId: 'ws1' });

    expect(calls.workspaceMember[0]).toMatchObject({
      include: { roles: { where: { role: { disabledAt: null } } } },
    });
  });

  it('reports the disabled state to the admin list, which must SHOW them', () => {
    /*
     * The opposite of the grant paths, deliberately. An administrator has to
     * see a disabled role in order to turn it back on; a list that hid them
     * would make the switch read as a delete.
     */
    const { svc } = service({
      roles: [
        {
          id: 'r1',
          key: 'off',
          label: 'Off',
          level: 'app',
          organizationId: null,
          icon: null,
          isSystem: false,
          disabledAt: new Date(),
          features: [{ featureKey: 'admin:access' }],
        },
      ],
    });

    return svc.listRoles().then((roles) => {
      expect(roles).toHaveLength(1);
      expect(roles[0]?.disabled).toBe(true);
    });
  });
});
