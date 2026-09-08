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
  /**
   * Every workspace this member belongs to — ids only, for the accessible list.
   *
   * FILTERED to this organization's live workspaces by the query; see the
   * `where` on the include. An unfiltered read leaked two ways at once.
   */
  workspaces: { workspaceId: string }[];
}

/** The active workspace's membership, with the roles held in it. */
export interface WorkspaceMemberRow {
  /** The read path never needed it; workspace role grants hang off it, so the write path does. */
  id: string;
  workspaceId: string;
  roles: { role: RoleWithFeatures }[];
}

/**
 * A subscription row, with its plan.
 *
 * ONE type for both readers — the entitlement pipeline and the admin list — and
 * that is forced rather than tidy. `permSubscription.findMany` cannot be
 * OVERLOADED: Prisma's generated `findMany` is a single generic method, and
 * TypeScript will not match it against a two-signature target, so the app's
 * `satisfies-modules.ts` assertion fails at build with the delegate collapsing
 * to `never`. One signature it is.
 *
 * The cost is small and worth naming: `loadContext` reads four of these fields
 * and pays for the rest, and the admin list fetches plan features it does not
 * render. What it buys is that neither reader can drift from the other's row
 * shape, and the app keeps binding one read client rather than two.
 *
 * Prisma returns every scalar of an included relation, so declaring the plan's
 * `key`, `label` and `archivedAt` here costs no extra query — they were always
 * in the payload.
 */
export interface SubscriptionRow {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  planKey: string;
  /** The enum, as a string. Validated with `toSubscriptionStatus`, never cast. */
  status: string;
  currentPeriodEnd: Date | null;
  /** Set when the subscription was ended. Rows are kept, never deleted. */
  endedAt: Date | null;
  plan: {
    key: string;
    label: string;
    /** An archived plan entitles nothing, however live the subscription looks. */
    archivedAt: Date | null;
    features: { featureKey: string }[];
    limits: { limitKey: string; value: number }[];
  };
}

/**
 * A plan as the ADMIN screens read it — the definition, not an entitlement.
 *
 * Distinct from the `plan` nested inside `SubscriptionRow`, which is loaded for
 * the plans one organization happens to be on. This is loaded for every plan,
 * and carries `isPublic`, which no entitlement decision consults.
 */
export interface PlanDefinitionRow {
  key: string;
  label: string;
  isPublic: boolean;
  /** Icon NAME, null for a plan that never named one. See PermPlan.icon. */
  icon: string | null;
  archivedAt: Date | null;
  features: { featureKey: string }[];
  limits: { limitKey: string; value: number }[];
}

/**
 * An organization and its workspaces.
 *
 * Archived workspaces are INCLUDED and flagged rather than filtered in the
 * query, because the two readers want opposite things: the subscription
 * picker must not offer an archived workspace, while the subscription LIST has
 * to be able to name one — a subscription outlives the workspace it was
 * attached to, and a row reading "—" where a name belongs explains nothing.
 * Filtering happens in `listOrganizations`, where the picker's need is local.
 */
export interface OrganizationRow {
  id: string;
  key: string;
  name: string;
  workspaces: { id: string; key: string; name: string; archivedAt: Date | null }[];
  /**
   * Ids only — enough to COUNT, and deliberately not enough to identify anyone.
   *
   * The list screen shows how many people are in each tenant; showing WHO is
   * the detail screen's job, behind its own query. Selecting `userId` here
   * would hand every caller of the subscription picker a roster of every
   * tenant, which is not what a picker needs.
   */
  memberships: { id: string; status: string }[];
}

/**
 * An invitation as the admin screens read it.
 *
 * ⚠ NO `tokenHash`, and never. The hash is the only thing standing between a
 * database read and a working invitation link; putting it on the read type
 * would put it one careless `select` away from a GraphQL field.
 */
export interface InvitationRow {
  id: string;
  email: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  /** Who sent it. An opaque id — the app joins the name. */
  invitedByUserId: string;
  /** Who accepted, which need not be who was invited: an address is a mailbox. */
  acceptedByUserId: string | null;
  role: { id: string; key: string; label: string; level: string; icon: string | null } | null;
}

/**
 * One organization as the ADMIN screens read it: its people, its workspaces,
 * and what each person holds.
 *
 * A deep read, and deliberately ONE query rather than four: a members grid that
 * fetched roles per row would issue a request per person, and the whole point
 * of the screen is seeing at a glance who holds what.
 *
 * ⚠ `userId` is a bare string with NO name or email attached, and that is the
 * module boundary rather than an omission — this module does not own identity
 * (§12.12). The app joins the display names, because the app is the only layer
 * that may import both modules.
 */
export interface OrganizationDetailRow {
  id: string;
  key: string;
  name: string;
  workspaces: {
    id: string;
    key: string;
    name: string;
    archivedAt: Date | null;
    /**
     * Who is in it, and what they hold THERE.
     *
     * `roles` here are WORKSPACE-level and hang off this row rather than off the
     * membership — which is the schema making "a workspace role for somebody not
     * in the workspace" impossible to express rather than merely wrong.
     */
    members: {
      id: string;
      membershipId: string;
      roles: { role: { id: string; key: string; label: string; level: string; icon: string | null } }[];
    }[];
  }[];
  invitations: InvitationRow[];
  memberships: {
    id: string;
    userId: string;
    status: string;
    joinedAt: Date;
    roles: { role: { id: string; key: string; label: string; level: string; icon: string | null } }[];
    workspaces: { workspaceId: string }[];
  }[];
}

export interface UserRoleRow {
  /**
   * Present because Prisma returns the row's own scalars, and needed the moment
   * one read asks about MANY people at once — `listAppRolesForUsers` has to say
   * which grant belongs to whom.
   */
  userId: string;
  role: {
    /** Needed to name a role in a write; the checks all read `key`. */
    id: string;
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

/**
 * A role as the ADMIN screens read it — the definition, not a grant.
 *
 * Distinct from `RoleWithFeatures`, which is what the permission pipeline
 * loads: this one carries `isSystem`, `disabledAt` and `icon`, none of which a
 * check ever consults, and it is loaded for every role rather than for the ones
 * a particular person holds.
 */
export interface RoleDefinitionRow {
  id: string;
  key: string;
  label: string;
  level: string;
  organizationId: string | null;
  icon: string | null;
  isSystem: boolean;
  disabledAt: Date | null;
  features: { featureKey: string }[];
}

export interface PermissionsPrismaClient {
  permRole: {
    /**
     * Every role in a scope, INCLUDING disabled ones.
     *
     * The opposite of the grant path deliberately: an administrator has to see
     * a disabled role in order to turn it back on, and a list that hid them
     * would make the switch look like a delete — which is the one thing it is
     * not.
     */
    findMany(args: {
      where: { organizationId: string | null };
      include: { features: { select: { featureKey: true } } };
      orderBy: { key: 'asc' };
    }): Promise<RoleDefinitionRow[]>;
  };
  permUserRole: {
    /*
     * ONE signature covering both readers — the person whose context is being
     * loaded, and a page asking about a screenful of people. `userId` widens to
     * an `in` list rather than the read growing an overload, which Prisma's
     * generic delegate cannot satisfy (see the invitation port for the same
     * lesson, learned twice).
     */
    findMany(args: {
      // `role: { disabledAt: null }` — a disabled role grants nothing, filtered
      // in the query for the same reason ActiveFeaturesInclude is.
      where: { userId: string | { in: string[] }; role: { disabledAt: null } };
      include: { role: { include: { features: ActiveFeaturesInclude; limits: true } } };
    }): Promise<UserRoleRow[]>;
    /*
     * ── the write path this table did not have ──────────────────────────────
     *
     * `perm_user_role` was readable and nothing wrote it: the app-level grants
     * in a live database had been inserted by hand, and PLAN §12 open decision
     * 37 recorded that as a gap. `assignAppRole` is what closes it, and both
     * methods below exist for it.
     *
     * DELETE THEN CREATE rather than an upsert, because the rule is "a person
     * is one thing at app level" — the delete is not cleanup for the create,
     * it is the replacement.
     */
    deleteMany(args: { where: { userId: string; roleId?: string } }): Promise<{ count: number }>;
    create(args: { data: { userId: string; roleId: string } }): Promise<unknown>;
  };
  permMembership: {
    count(args: { where: { organizationId?: string; userId?: string; status: 'active' } }): Promise<number>;
    findFirst(args: {
      where: { userId: string; organizationId?: string; status?: 'active' };
      include: {
        roles: {
          where: { role: { disabledAt: null } };
          include: { role: { include: { features: ActiveFeaturesInclude } } };
        };
        /**
         * ⚠ THE `where` IS LOAD-BEARING. Without it this read leaks two ways,
         * both demonstrated against a live database:
         *
         *   organizationId  nothing in the schema ties a workspace membership's
         *                   MEMBERSHIP to its WORKSPACE's organization — the row
         *                   references each independently. A cross-tenant row is
         *                   insertable, and it surfaced in
         *                   `accessibleWorkspaceIds`, so `canAccessWorkspace`
         *                   returned true for another tenant's workspace. The
         *                   guard still refused a request naming it, but a UI
         *                   would have linked somewhere the API turns away —
         *                   the exact mismatch one shared key exists to prevent.
         *   archivedAt      an archived workspace stops resolving, so listing it
         *                   as accessible promises something `loadContext`
         *                   refuses one call later.
         *
         * This is C3's defence, one table over: the write path already checks
         * both (see `shareWorkspace`), and the read refuses defensively rather
         * than trusting the row. Closing it in the SCHEMA needs a composite
         * foreign key — see docs/PLAN.md §12.34.
         */
        workspaces: {
          where: { workspace: { organizationId: string; archivedAt: null } };
          select: { workspaceId: true };
        };
      };
    }): Promise<MembershipRow | null>;
  };
  permWorkspaceMember: {
    findFirst(args: {
      where: { membershipId: string; workspaceId: string };
      include: {
        roles: {
          where: { role: { disabledAt: null } };
          include: { role: { include: { features: ActiveFeaturesInclude } } };
        };
      };
    }): Promise<WorkspaceMemberRow | null>;
    count(args: { where: { workspaceId: string } }): Promise<number>;
  };
  permPlan: {
    /**
     * Every plan, INCLUDING archived ones.
     *
     * The opposite of the entitlement path deliberately, and the same call
     * `permRole.findMany` makes above: an administrator has to see an archived
     * plan in order to bring it back, and a list that hid them would make the
     * switch look like a delete — which is the one thing it is not.
     */
    findMany(args: {
      include: {
        // Deprecated keys filtered, so the plan EDITOR never shows a feature the
        // registry no longer has — which it would then refuse to save, because
        // `validatePlanDraft` rejects an unregistered key.
        features: ActiveFeaturesInclude & { select: { featureKey: true } };
        limits: { select: { limitKey: true; value: true } };
      };
      orderBy: { key: 'asc' };
    }): Promise<PlanDefinitionRow[]>;
  };
  permSubscription: {
    /**
     * ONE signature, serving both the entitlement pipeline and the admin list.
     * See `SubscriptionRow` for why it cannot be two.
     *
     * Every `where` field is optional so the same shape expresses both
     * questions — "what entitles this request" (an organization, active, live
     * plan, this workspace or none) and "who is on what" (optionally one
     * organization, ended rows included). Optional does NOT mean the callers
     * are casual about it: `loadContext` passes all four, and omitting `status`
     * there would silently entitle a canceled subscription.
     */
    findMany(args: {
      where: {
        organizationId?: string;
        // The literal, not `string`. PermSubscriptionStatus is an enum in the
        // schema (H4), so a `string` here is wider than the column and stops a
        // generated Prisma client satisfying this interface at all.
        status?: 'active';
        /*
         * An ARCHIVED plan stops entitling, filtered in the query for exactly
         * the reason `deprecatedAt` and `disabledAt` are: a row that is loaded
         * and then dropped still exists in memory for something later to read
         * by mistake. A column nothing reads would be a switch that looks like
         * it works.
         */
        plan?: { archivedAt: null };
        endedAt?: null;
        // Organization-wide plans plus the active workspace's own, in one query.
        OR?: ({ workspaceId: null } | { workspaceId: string })[];
      };
      // Deprecated keys are filtered HERE, exactly as ActiveFeaturesInclude does
      // for role grants: a retired key must stop ENTITLING as well as stop
      // granting, and filtering in the query means it never reaches composition.
      include: { plan: { include: { features: ActiveFeaturesInclude; limits: true } } };
      orderBy?: { id: 'asc' };
    }): Promise<SubscriptionRow[]>;
  };
  permOrganization: {
    /**
     * ONE organization, with everything the detail screen shows.
     *
     * Includes ARCHIVED workspaces and non-active memberships: an administrator
     * has to see an archived workspace to know it existed, and a suspended
     * member to reinstate them. The grant paths filter both; a management view
     * must do the opposite, exactly as the roles and plans lists do.
     */
    findFirst(args: {
      where: { id: string };
      include: {
        // NO tokenHash in the select — see InvitationRow.
        invitations: {
          select: {
            id: true;
            email: true;
            status: true;
            expiresAt: true;
            createdAt: true;
            acceptedAt: true;
            revokedAt: true;
            invitedByUserId: true;
            acceptedByUserId: true;
            role: { select: { id: true; key: true; label: true; level: true; icon: true } };
          };
        };
        workspaces: {
          include: {
            members: {
              include: {
                roles: { include: { role: { select: { id: true; key: true; label: true; level: true; icon: true } } } };
              };
            };
          };
        };
        memberships: {
          include: {
            roles: { include: { role: { select: { id: true; key: true; label: true; level: true; icon: true } } } };
            workspaces: { select: { workspaceId: true } };
          };
        };
      };
    }): Promise<OrganizationDetailRow | null>;
    /**
     * The tenants, with their live workspaces, for the subscription form's two
     * pickers.
     *
     * Both in one query rather than a workspace lookup per organization: the
     * form has to know which workspaces belong to the organization it is
     * pointing at BEFORE anything is saved, since a workspace from another
     * tenant paired with this organization is a well-formed row entitling one
     * customer off another's subscription.
     */
    findMany(args: {
      include: {
        workspaces: { select: { id: true; key: true; name: true; archivedAt: true } };
        memberships: { select: { id: true; status: true } };
      };
      orderBy: { name: 'asc' };
    }): Promise<OrganizationRow[]>;
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

  permOrganization: PermissionsPrismaClient['permOrganization'] & {
    create(args: { data: { key: string; name: string }; select: { id: true } }): Promise<{ id: string }>;
    /**
     * Name and key alongside the id: the existence check that guards every
     * insert carrying an `organizationId` also feeds the invitation email,
     * which has to say WHICH organization somebody is being asked to join.
     */
    findFirst(args: {
      where: { id: string };
      select: { id: true; key: true; name: true };
    }): Promise<{ id: string; key: string; name: string } | null>;
    /**
     * Renaming. `updateMany` rather than `update` so a missing row is a count
     * of zero the caller can turn into a sentence, instead of Prisma throwing
     * for a stale link.
     */
    updateMany(args: { where: { id: string }; data: { key: string; name: string } }): Promise<{ count: number }>;
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
    /**
     * Archive AND rename, both scoped by `organizationId` as well as `id`.
     *
     * `updateMany` rather than `update` for exactly that: `update` takes a
     * unique `where`, which is the id alone — and nothing then stops one tenant
     * naming another's workspace. The extra column in the filter is the tenant
     * check, done by the database rather than remembered by the caller.
     *
     * `key` is renameable, unlike a role's or a plan's: nothing references a
     * workspace by key. It is addressed by `id` everywhere, and the key is
     * `@@unique([organizationId, key])` for humans reading URLs, not for joins.
     */
    updateMany(args: {
      where: { id: string; organizationId: string };
      data: { archivedAt?: Date | null; key?: string; name?: string };
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
  permRole: PermissionsPrismaClient['permRole'] & {
    findFirst(args: {
      /*
       * By id everywhere except the baseline lookup, which has only a KEY —
       * the app names its seeded default by key, because an id is generated and
       * differs between databases.
       */
      where: { id: string } | { key: string; level: 'app'; organizationId: null; disabledAt: null };
      select: {
        id: true;
        key: true;
        level: true;
        label: true;
        organizationId: true;
        isSystem: true;
        disabledAt: true;
      };
    }): Promise<{
      id: string;
      key: string;
      level: string;
      /** Read only where a role is NAMED to a person — an email, a screen. */
      label: string;
      organizationId: string | null;
      isSystem: boolean;
      disabledAt: Date | null;
    } | null>;
    create(args: {
      data: {
        key: string;
        label: string;
        level: 'app' | 'organization' | 'workspace';
        organizationId: string | null;
        icon: string | null;
        isSystem: boolean;
      };
      select: { id: true };
    }): Promise<{ id: string }>;
    update(args: {
      where: { id: string };
      // `level` is absent on purpose — see updateRole. Changing a role's level
      // re-interprets every grant ever made from it.
      data: { label?: string; icon?: string | null; disabledAt?: Date | null };
      select: { id: true };
    }): Promise<{ id: string }>;
  };

  permRoleFeature: {
    /** One role's feature list, for the clone preview. */
    findMany(args: { where: { roleId: string }; select: { featureKey: true } }): Promise<{ featureKey: string }[]>;
    deleteMany(args: { where: { roleId: string; featureKey?: { notIn: string[] } } }): Promise<{ count: number }>;
    createMany(args: {
      data: { roleId: string; featureKey: string }[];
      skipDuplicates: true;
    }): Promise<{ count: number }>;
  };

  /**
   * A plan is DEFINED here, unlike a subscription, which merely points at one.
   *
   * `key` is the primary key and is never updated: `PermPlanFeature`,
   * `PermPlanLimit` and every `PermSubscription` reference it, so renaming one
   * would either cascade the history away or fail on a foreign key — the same
   * argument `PermRole.key` makes about grants.
   */
  permPlan: PermissionsPrismaClient['permPlan'] & {
    findFirst(args: {
      where: { key: string };
      select: { key: true; label: true; isPublic: true; icon: true; archivedAt: true };
    }): Promise<{
      key: string;
      label: string;
      isPublic: boolean;
      icon: string | null;
      archivedAt: Date | null;
    } | null>;
    create(args: {
      data: { key: string; label: string; isPublic: boolean; icon: string | null };
      select: { key: true };
    }): Promise<{ key: string }>;
    update(args: {
      where: { key: string };
      data: { label?: string; isPublic?: boolean; icon?: string | null; archivedAt?: Date | null };
      select: { key: true };
    }): Promise<{ key: string }>;
  };

  permPlanFeature: {
    /** One plan's feature list, for the clone preview. */
    findMany(args: { where: { planKey: string }; select: { featureKey: true } }): Promise<{ featureKey: string }[]>;
    deleteMany(args: { where: { planKey: string; featureKey?: { notIn: string[] } } }): Promise<{ count: number }>;
    createMany(args: {
      data: { planKey: string; featureKey: string }[];
      skipDuplicates: true;
    }): Promise<{ count: number }>;
  };

  permPlanLimit: {
    deleteMany(args: { where: { planKey: string; limitKey?: { notIn: string[] } } }): Promise<{ count: number }>;
    upsert(args: {
      where: { planKey_limitKey: { planKey: string; limitKey: string } };
      create: { planKey: string; limitKey: string; value: number };
      update: { value: number };
    }): Promise<unknown>;
  };

  /**
   * Subscriptions are written by an ADMINISTRATOR here, not by a billing
   * provider — see docs/PLAN.md §12 for the reversal and what it costs.
   *
   * `create` and `update` only; there is no delete. A row is ended by setting
   * `endedAt`, because past entitlement has to stay reconstructable: "what was
   * this organization entitled to in March" is answered by reading rows, and a
   * deleted row answers it wrongly rather than not at all.
   */
  permSubscription: PermissionsPrismaClient['permSubscription'] & {
    findFirst(args: {
      where: { id?: string; organizationId?: string; workspaceId?: string | null; planKey?: string; endedAt?: null };
      select: {
        id: true;
        organizationId: true;
        workspaceId: true;
        planKey: true;
        status: true;
        endedAt: true;
      };
    }): Promise<{
      id: string;
      organizationId: string;
      workspaceId: string | null;
      planKey: string;
      status: string;
      endedAt: Date | null;
    } | null>;
    create(args: {
      data: {
        organizationId: string;
        workspaceId: string | null;
        planKey: string;
        status: 'active' | 'past_due' | 'canceled';
        currentPeriodEnd: Date | null;
      };
      select: { id: true };
    }): Promise<{ id: string }>;
    update(args: {
      where: { id: string };
      // Neither the target nor the plan is here, and that is deliberate: both
      // are read by every entitlement decision the row ever produced. See
      // domain/subscription-draft.ts.
      data: {
        status?: 'active' | 'past_due' | 'canceled';
        currentPeriodEnd?: Date | null;
        endedAt?: Date | null;
      };
      select: { id: true };
    }): Promise<{ id: string }>;
  };

  /**
   * Invitations are CREATED and UPDATED, never deleted.
   *
   * A revoked or accepted invitation is the record of somebody having been
   * asked — "who let them in" is answered by reading these rows, and a delete
   * answers it wrongly rather than not at all.
   */
  permInvitation: {
    /**
     * ONE signature, and every caller passes this whole select — including the
     * two joins, which only the preview reads.
     *
     * A second overload would be the natural way to express "sometimes with the
     * organization"; it cannot be used here. Prisma's delegate methods are
     * generic, and a generic method does not satisfy a two-signature target —
     * the app's `satisfies-modules.ts` check fails on it, which is how the
     * subscription delegate learned the same lesson. Over-fetching two columns
     * on the accept path is the cheaper mistake.
     */
    findFirst(args: {
      where: { id?: string; tokenHash?: string; organizationId?: string; status?: 'pending' };
      select: {
        id: true;
        organizationId: true;
        email: true;
        roleId: true;
        appRoleId: true;
        status: true;
        expiresAt: true;
        organization: { select: { key: true; name: true } };
        role: { select: { label: true } };
        appRole: { select: { label: true } };
      };
    }): Promise<{
      id: string;
      /** NULL for a platform invitation — an offer that names no tenant. */
      organizationId: string | null;
      email: string;
      roleId: string | null;
      appRoleId: string | null;
      status: string;
      expiresAt: Date;
      /** Null with `organizationId`. The two are absent together, always. */
      organization: { key: string; name: string } | null;
      /** Null when the invitation names no role, which is a normal invitation. */
      role: { label: string } | null;
      /** Null when it grants no app-level role — every members-screen invitation. */
      appRole: { label: string } | null;
    } | null>;
    /**
     * `expiresAt` is selected because expiry is DERIVED, not stored: a row that
     * has run out still reads `pending` in the column. Without the timestamp
     * the caller cannot tell a live invitation from a stale one, and one
     * forgotten invitation would block an address forever.
     */
    findMany(args: {
      /*
       * `organizationId: null` is the PLATFORM bucket, and it is a different
       * question from "any organization": a platform invitation and an
       * invitation to a tenant are separate offers to the same person, and
       * neither may block the other.
       */
      where: { organizationId: string | null; status: 'pending' };
      select: { email: true; status: true; expiresAt: true };
    }): Promise<{ email: string; status: string; expiresAt: Date }[]>;
    create(args: {
      data: {
        /** Null for a PLATFORM invitation, which names no tenant. */
        organizationId: string | null;
        /** The app-level role to grant on acceptance, when there is one. */
        appRoleId: string | null;
        email: string;
        roleId: string | null;
        invitedByUserId: string;
        tokenHash: string;
        expiresAt: Date;
      };
      select: { id: true };
    }): Promise<{ id: string }>;
    update(args: {
      where: { id: string };
      data: {
        status?: 'accepted' | 'revoked';
        acceptedAt?: Date | null;
        acceptedByUserId?: string | null;
        revokedAt?: Date | null;
      };
      select: { id: true };
    }): Promise<{ id: string }>;
  };

  permMembershipRole: {
    /** `roleId` optional: `assignRole` asks "what do they hold", not "do they hold this". */
    findFirst(args: { where: { membershipId: string; roleId?: string } }): Promise<{ roleId: string } | null>;
    create(args: { data: { membershipId: string; roleId: string } }): Promise<unknown>;
    /**
     * `roleId` is OPTIONAL, and that is what lets a role be REPLACED.
     *
     * A member holds at most one organization-level role (see the `@@unique`
     * on PermMembershipRole), so assigning one has to clear whatever was there
     * — otherwise the second grant hits the constraint and an ordinary
     * re-role becomes an error somebody has to work around by revoking first.
     */
    deleteMany(args: { where: { membershipId: string; roleId?: string } }): Promise<{ count: number }>;
  };

  permWorkspaceMemberRole: {
    findFirst(args: { where: { workspaceMemberId: string; roleId?: string } }): Promise<{ roleId: string } | null>;
    create(args: { data: { workspaceMemberId: string; roleId: string } }): Promise<unknown>;
    /**
     * `roleId` OPTIONAL, which is what lets a role be REPLACED — the same shape
     * `permMembershipRole.deleteMany` carries one level up, and for the same
     * reason: a workspace member holds at most one workspace-level role, so
     * assigning one has to clear whatever was there or the second grant hits
     * the constraint.
     */
    deleteMany(args: { where: { workspaceMemberId: string; roleId?: string } }): Promise<{ count: number }>;
  };
}

/**
 * Bound separately from PERMISSIONS_PRISMA so that granting the module write
 * access is an explicit line in the app, not something it inherits by having
 * wired the read client.
 */
export const PERMISSIONS_PRISMA_WRITE = 'kwtech:permissions-prisma-write';
