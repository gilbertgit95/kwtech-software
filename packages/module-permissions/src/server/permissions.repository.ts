/**
 * The narrow slice of a Prisma client this module needs — declared structurally,
 * never imported from a generated client.
 *
 * This is what keeps the module database-agnostic. It opens no connection,
 * reads no DATABASE_URL, and has no @prisma/client dependency: the host app
 * injects its own client, so two apps consuming this module can sit on two
 * entirely different databases. Wiring stays one line per app:
 *
 *   { provide: PERMISSIONS_PRISMA, useExisting: PrismaService }
 *
 * It also means the implementation need not be Prisma at all — anything
 * satisfying this shape works, which is what makes the service testable with a
 * literal object and no database.
 *
 * The one thing each app DOES owe the module: its database must actually have
 * the perm_* tables. Compose prisma/permissions.prisma into that app's schema
 * and migrate. See ../../README.md.
 */
export const PERMISSIONS_PRISMA = 'kwtech:permissions-prisma';

export interface RoleWithFeatures {
  key: string;
  level: string;
  /**
   * Null for a system preset or an app-level role; otherwise the organization
   * that defined it. Read so grants can be rejected when a role belongs to a
   * different tenant than the membership it was attached to.
   */
  organizationId: string | null;
  features: { featureKey: string }[];
}

// NOTE: no `limits` here. Only the APP-level role query includes them (see
// UserRoleRow), because `user:organizations` is the sole role-sourced cap and
// it hangs off an app-level role. Declaring `limits` on this shared type made
// it a promise the membership and workspace-member queries never keep: their
// `include` asks for features alone, so a real Prisma client cannot satisfy
// this interface — which is how the lie was found. Nothing read the field.

/**
 * Nested filter applied wherever role features are read: a feature the seed has
 * deprecated stops granting, which is the point of deprecating it. Applied in
 * the query rather than after, so a deprecated key never reaches composition.
 */
export interface ActiveFeaturesInclude {
  where: { feature: { deprecatedAt: null } };
}

export interface MembershipRow {
  id: string;
  organizationId: string;
  /** Organization-level roles. Workspace roles hang off the workspace membership. */
  roles: { role: RoleWithFeatures }[];
  /** Every workspace this member belongs to — ids only, for the accessible list. */
  workspaces: { workspaceId: string }[];
}

/** The active workspace's membership, with the roles held in it. */
export interface WorkspaceMemberRow {
  /** The read path never needed it; workspace role grants hang off it, so the write path does. */
  id: string;
  workspaceId: string;
  roles: { role: RoleWithFeatures }[];
}

export interface SubscriptionRow {
  planKey: string;
  workspaceId: string | null;
  plan: {
    features: { featureKey: string }[];
    limits: { limitKey: string; value: number }[];
  };
}

export interface UserRoleRow {
  role: {
    key: string;
    level: string;
    /** Read for the badge, not for any check. See PermissionContext.appRoles. */
    label: string;
    /** Icon NAME, null for a role that never named one. See PermRole.icon. */
    icon: string | null;
    features: { featureKey: string }[];
    /** App-level roles carry 'user:organizations'. See domain/limits.ts. */
    limits: { limitKey: string; value: number }[];
  };
}

export interface PermissionsPrismaClient {
  permUserRole: {
    findMany(args: {
      where: { userId: string };
      include: { role: { include: { features: ActiveFeaturesInclude; limits: true } } };
    }): Promise<UserRoleRow[]>;
  };
  permMembership: {
    count(args: { where: { organizationId?: string; userId?: string; status: 'active' } }): Promise<number>;
    findFirst(args: {
      where: { userId: string; organizationId?: string; status?: 'active' };
      include: {
        roles: { include: { role: { include: { features: ActiveFeaturesInclude } } } };
        workspaces: { select: { workspaceId: true } };
      };
    }): Promise<MembershipRow | null>;
  };
  permWorkspaceMember: {
    findFirst(args: {
      where: { membershipId: string; workspaceId: string };
      include: { roles: { include: { role: { include: { features: ActiveFeaturesInclude } } } } };
    }): Promise<WorkspaceMemberRow | null>;
    count(args: { where: { workspaceId: string } }): Promise<number>;
  };
  permSubscription: {
    findMany(args: {
      where: {
        organizationId: string;
        // The literal, not `string`. PermSubscriptionStatus is an enum in the
        // schema (H4), so a `string` here is wider than the column and stops a
        // generated Prisma client satisfying this interface at all.
        status: 'active';
        // Organization-wide plans plus the active workspace's own, in one query.
        OR: ({ workspaceId: null } | { workspaceId: string })[];
      };
      include: { plan: { include: { features: true; limits: true } } };
    }): Promise<SubscriptionRow[]>;
  };
  permWorkspace: {
    /**
     * Both conditions matter. organizationId proves the workspace in the URL
     * belongs to the organization in the URL — nothing else checks that a path
     * pairs two ids from the same tenant. archivedAt keeps an archived
     * workspace from resolving as a live one.
     */
    findFirst(args: {
      where: { id: string; organizationId: string; archivedAt: null };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    count(args: { where: { organizationId: string; archivedAt: null } }): Promise<number>;
  };
}

// ─── the write half ─────────────────────────────────────────────────────────
//
// Kept as a SEPARATE interface that extends the read one, so a host that only
// answers permission questions — a worker, a read replica, an app that
// administers grants elsewhere — satisfies PermissionsPrismaClient without
// having to expose a client that can write. Injecting a write-capable client is
// then a deliberate act, visible in the app's wiring.

/** The transaction handle a write runs inside. Structurally a client, like everything else here. */
export type PermissionsTransaction = Omit<PermissionsWriteClient, '$transaction'>;

export interface PermissionsWriteClient extends PermissionsPrismaClient {
  /**
   * Capacity is counted and the row inserted inside ONE transaction.
   *
   * Worth stating exactly what that does and does not buy, because a limit that
   * looks enforced and is not is worse than one documented as advisory: under
   * READ COMMITTED — Prisma's and Postgres's default — two concurrent invites
   * can both count N and both insert, giving N+2 against a cap of N+1. The
   * transaction narrows the window to the round trip; it does not close it.
   *
   * Closing it needs the host's help, because this module deliberately cannot
   * emit SQL: pass `isolationLevel: 'Serializable'` through the app's client, or
   * take an advisory lock on the organization in the app's own wrapper. For
   * seats and workspaces the residual overshoot is one row under concurrent
   * writes by the same administrator, which is why the default is left alone.
   */
  $transaction<T>(fn: (tx: PermissionsTransaction) => Promise<T>): Promise<T>;

  permOrganization: {
    create(args: { data: { key: string; name: string }; select: { id: true } }): Promise<{ id: string }>;
  };

  permMembership: PermissionsPrismaClient['permMembership'] & {
    create(args: {
      data: { userId: string; organizationId: string; status: 'active' };
      select: { id: true };
    }): Promise<{ id: string }>;
    deleteMany(args: { where: { userId: string; organizationId: string } }): Promise<{ count: number }>;
  };

  permWorkspace: PermissionsPrismaClient['permWorkspace'] & {
    create(args: {
      data: { organizationId: string; key: string; name: string };
      select: { id: true };
    }): Promise<{ id: string }>;
    updateMany(args: {
      where: { id: string; organizationId: string };
      data: { archivedAt: Date };
    }): Promise<{ count: number }>;
  };

  permWorkspaceMember: PermissionsPrismaClient['permWorkspaceMember'] & {
    create(args: {
      data: { membershipId: string; workspaceId: string };
      select: { id: true };
    }): Promise<{ id: string }>;
    deleteMany(args: { where: { membershipId: string; workspaceId: string } }): Promise<{ count: number }>;
  };

  /**
   * The role being granted is READ inside the same transaction as the insert,
   * never trusted from the caller: the caller supplies a roleId, and a roleId
   * from one tenant attached to a membership in another is precisely C3.
   */
  permRole: {
    findFirst(args: {
      where: { id: string };
      select: { id: true; key: true; level: true; organizationId: true };
    }): Promise<{ id: string; key: string; level: string; organizationId: string | null } | null>;
  };

  permMembershipRole: {
    findFirst(args: { where: { membershipId: string; roleId: string } }): Promise<{ roleId: string } | null>;
    create(args: { data: { membershipId: string; roleId: string } }): Promise<unknown>;
    deleteMany(args: { where: { membershipId: string; roleId: string } }): Promise<{ count: number }>;
  };

  permWorkspaceMemberRole: {
    findFirst(args: { where: { workspaceMemberId: string; roleId: string } }): Promise<{ roleId: string } | null>;
    create(args: { data: { workspaceMemberId: string; roleId: string } }): Promise<unknown>;
    deleteMany(args: { where: { workspaceMemberId: string; roleId: string } }): Promise<{ count: number }>;
  };
}

/**
 * Bound separately from PERMISSIONS_PRISMA so that granting the module write
 * access is an explicit line in the app, not something it inherits by having
 * wired the read client.
 */
export const PERMISSIONS_PRISMA_WRITE = 'kwtech:permissions-prisma-write';
