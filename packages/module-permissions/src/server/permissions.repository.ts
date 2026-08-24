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
  /** Only app-level roles carry these. See domain/limits.ts. */
  limits: { limitKey: string; value: number }[];
}

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
        status: string;
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
