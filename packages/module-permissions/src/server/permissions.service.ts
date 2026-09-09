import { Inject, Injectable } from '@nestjs/common';
import { composeContext, type PlanEntitlement, type RoleGrant } from '../domain/grants.js';
import { invitationState } from '../domain/invitation.js';
import { checkLimit, LIMIT, LIMIT_REGISTRY, type LimitDecision, type LimitKey } from '../domain/limits.js';
import { type PermissionContext, toRoleLevel } from '../types.js';
import { PERMISSIONS_PRISMA, type PermissionsPrismaClient } from './permissions.repository.js';

/**
 * Loads a caller's grants and their organization's entitlements, and hands back
 * the context every check consumes.
 *
 * This is the "process" half of the module: consuming apps call loadContext()
 * and are done. They do not touch perm_* tables, do not know the join path from
 * membership to plan, and do not reimplement role composition.
 */
/**
 * The most ids one `listAppRolesForUsers` call may name.
 *
 * The same number and the same reason as the app's `findUsersByIds`: an
 * uncapped `in` list is an unbounded query somebody can send, and the request
 * that finally hurts is never the one anybody tested.
 */
const MAX_USER_ROLE_LOOKUP = 200;

@Injectable()
export class PermissionsService {
  constructor(@Inject(PERMISSIONS_PRISMA) private readonly prisma: PermissionsPrismaClient) {}

  /**
   * @param scope.organizationId the active organization. Omitting it makes this
   * an APP-LEVEL question, answered by app-level roles alone — no membership is
   * consulted and no subscription applied. An app whose URLs do not carry the
   * organization id must supply it through `resolvePrincipal`, or its
   * organization roles will never participate.
   * @param scope.workspaceId the active workspace. Omit to ask the
   * organization-wide question — workspace-scoped grants are then excluded,
   * not treated as universal.
   */
  /**
   * Every role defined in one scope, for the admin screens.
   *
   * INCLUDES disabled roles, unlike every other role read in this file. The
   * grant paths filter them out because a disabled role must grant nothing; a
   * LIST must show them, or the switch looks like a delete and nobody can find
   * the role to turn it back on.
   *
   * `organizationId: null` is the shared scope — app-level roles and the
   * presets every organization can use. A tenant passes its own id and sees
   * only what it defined.
   */
  /**
   * The APP-level role each of these people holds.
   *
   * ## Why by ID, and why this is not a search
   *
   * The caller already HOLDS these ids — they came from a guarded list — so
   * this discloses nothing that was not already disclosed, which is what makes
   * a batch acceptable here. The same argument the app's `findUsersByIds`
   * makes, in the other direction.
   *
   * ## Missing people are simply absent
   *
   * An id with no app-level role returns no row rather than a null one. Most
   * accounts hold none, and a list of nulls the same length as the input is a
   * shape every caller then has to filter.
   *
   * Disabled roles are excluded, for the reason every read here excludes them:
   * a disabled role grants nothing, and showing one in a column would report a
   * power the holder does not have.
   */
  async listAppRolesForUsers(userIds: readonly string[]) {
    const unique = [...new Set(userIds.filter((id) => typeof id === 'string' && id.length > 0))].slice(
      0,
      MAX_USER_ROLE_LOOKUP,
    );
    if (unique.length === 0) return [];

    const rows = await this.prisma.permUserRole.findMany({
      where: { userId: { in: unique }, role: { disabledAt: null } },
      // The same include the context load uses — one signature, see the port.
      include: { role: { include: { features: { where: { feature: { deprecatedAt: null } } }, limits: true } } },
    });

    return rows
      .filter((row) => row.role.level === 'app')
      .map((row) => ({
        userId: row.userId,
        roleId: row.role.id,
        roleKey: row.role.key,
        roleLabel: row.role.label,
        roleIcon: row.role.icon,
      }));
  }

  /**
   * Which organizations each of these people belongs to, and as what.
   *
   * ## Why it exists
   *
   * The user administration screens could say what somebody may do across the
   * PLATFORM and nothing about where they belong — which is usually the first
   * question about an account. `listOrganizations` answers the opposite
   * question (every tenant) and `organizationDetail` answers it one tenant at a
   * time; neither goes from a person to their memberships.
   *
   * ## By ID, active only, capped
   *
   * The ids come from a list the caller was already allowed to see, so batching
   * discloses nothing new — the same argument `listAppRolesForUsers` and the
   * app's `findUsersByIds` make. Suspended memberships are excluded because the
   * question is where somebody belongs NOW, and a screen counting a suspended
   * one would be wrong in the direction that matters.
   *
   * Somebody in no organization simply has no rows. That is a normal and
   * increasingly common state: a platform invitation names no tenant at all.
   */
  async listOrganizationsForUsers(userIds: readonly string[]) {
    const unique = [...new Set(userIds.filter((id) => typeof id === 'string' && id.length > 0))].slice(
      0,
      MAX_USER_ROLE_LOOKUP,
    );
    if (unique.length === 0) return [];

    const rows = await this.prisma.permMembership.findMany({
      where: { userId: { in: unique }, status: 'active' },
      include: {
        organization: { select: { id: true, key: true, name: true, description: true } },
        roles: {
          where: { role: { disabledAt: null } },
          // `icon` alongside the label: the organization switcher draws the
          // viewer's role beside each tenant, and a second query to fetch one
          // name per row would be a round trip for a glyph.
          include: { role: { select: { key: true, label: true, icon: true } } },
        },
      },
    });

    return (
      rows
        .map((row) => ({
          userId: row.userId,
          organizationId: row.organization.id,
          organizationKey: row.organization.key,
          organizationName: row.organization.name,
          organizationDescription: row.organization.description,
          /*
           * At most one, enforced by `@@unique([membershipId])` on
           * PermMembershipRole — a member is one thing in an organization. Read
           * as a list because that is the shape the relation returns, and
           * flattened here so a screen does not have to know the constraint.
           */
          roleKey: row.roles[0]?.role.key ?? null,
          roleLabel: row.roles[0]?.role.label ?? null,
          roleIcon: row.roles[0]?.role.icon ?? null,
        }))
        // Stable and readable: a person's organizations in name order, so the
        // list does not reshuffle between renders.
        .sort((a, b) => a.organizationName.localeCompare(b.organizationName))
    );
  }

  async listRoles(organizationId: string | null = null) {
    const rows = await this.prisma.permRole.findMany({
      where: { organizationId },
      include: { features: { select: { featureKey: true } } },
      orderBy: { key: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      label: row.label,
      level: row.level,
      organizationId: row.organizationId,
      icon: row.icon,
      isSystem: row.isSystem,
      disabled: row.disabledAt !== null,
      features: row.features.map((feature) => feature.featureKey).sort(),
    }));
  }

  /**
   * Every plan the platform defines, for the catalogue screens.
   *
   * INCLUDES archived plans, unlike the entitlement query above — the same call
   * `listRoles` makes about disabled roles. An administrator has to see an
   * archived plan in order to bring it back, and a list that hid them would
   * make the switch look like a delete.
   */
  async listPlans() {
    const rows = await this.prisma.permPlan.findMany({
      include: {
        // Deprecated keys excluded: the plan editor loads this, and showing a
        // feature the registry no longer has would produce a draft that fails
        // its own validation on save.
        features: { where: { feature: { deprecatedAt: null } }, select: { featureKey: true } },
        limits: { select: { limitKey: true, value: true } },
      },
      orderBy: { key: 'asc' },
    });

    return rows.map((row) => ({
      key: row.key,
      label: row.label,
      isPublic: row.isPublic,
      icon: row.icon,
      archived: row.archivedAt !== null,
      features: row.features.map((feature) => feature.featureKey).sort(),
      limits: Object.fromEntries(row.limits.map((limit) => [limit.limitKey, limit.value])),
    }));
  }

  /**
   * Who is on what.
   *
   * INCLUDES ended subscriptions, and for a different reason than the two
   * lists above: an ended row is not something anybody turns back on, it is
   * the HISTORY — "what was this organization entitled to in March" is
   * answered by reading these, and a list that showed only live rows would
   * make a plan change look like it had always been that way. The screen sorts
   * them apart rather than hiding them.
   *
   * @param organizationId narrows to one tenant. Null lists every one, which
   * is what platform staff administering subscriptions actually need — and is
   * why the query behind it is guarded by `subscriptions:read` rather than
   * being reachable from an organization-scoped route.
   */
  async listSubscriptions(organizationId: string | null = null) {
    /*
     * Two queries and a join in memory, rather than one query with the
     * organization and workspace relations included.
     *
     * Not a preference: `permSubscription.findMany` has ONE signature, because
     * Prisma's generated generic method cannot satisfy an overloaded one (see
     * `SubscriptionRow`), and widening that one signature's `include` to carry
     * the two relations would make `loadContext` — the hot path on every
     * request — fetch an organization row and a workspace row it never reads.
     *
     * The join is over the tenants, of which there are few, and this is an
     * administrative screen. If that stops being true, the answer is a
     * dedicated billing client interface, not a bigger include on the request
     * path.
     */
    const [rows, organizations] = await Promise.all([
      this.prisma.permSubscription.findMany({
        where: organizationId ? { organizationId } : {},
        // A retired key stops ENTITLING as well as granting — filtered in the
        // query, like the role-feature reads, so it never reaches composition.
        include: { plan: { include: { features: { where: { feature: { deprecatedAt: null } } }, limits: true } } },
        orderBy: { id: 'asc' },
      }),
      this.prisma.permOrganization.findMany({
        include: {
          workspaces: { select: { id: true, key: true, name: true, archivedAt: true } },
          memberships: { select: { id: true, status: true } },
        },
        orderBy: { name: 'asc' },
      }),
    ]);

    const organizationNames = new Map(organizations.map((row) => [row.id, row.name]));
    // Every workspace, ARCHIVED ONES INCLUDED: a subscription outlives the
    // workspace it was attached to, and a row with a blank where a name belongs
    // explains nothing to whoever is trying to work out what a customer had.
    const workspaceNames = new Map(
      organizations.flatMap((row) => row.workspaces.map((workspace) => [workspace.id, workspace.name] as const)),
    );

    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      /*
       * Falls back to the id rather than throwing or blanking. The organization
       * cascades its subscriptions away when deleted, so this should be
       * unreachable — and an admin screen that renders nothing because one row
       * is inconsistent is worse than one showing a cuid somebody can search on.
       */
      organizationName: organizationNames.get(row.organizationId) ?? row.organizationId,
      workspaceId: row.workspaceId,
      workspaceName: row.workspaceId ? (workspaceNames.get(row.workspaceId) ?? row.workspaceId) : null,
      planKey: row.planKey,
      planLabel: row.plan.label,
      /*
       * The plan's icon NAME, for a screen naming the plan. Carried beside the
       * label rather than looked up separately: the two are one identification
       * of the plan, and a caller that had to fetch the catalogue to draw a
       * glyph would be making a second request to render one field.
       */
      planIcon: row.plan.icon,
      // Read so a screen can explain why a live-looking subscription entitles
      // nothing: `loadContext` filters archived plans out, and a row pointing
      // at one is otherwise indistinguishable from a working subscription.
      planArchived: row.plan.archivedAt !== null,
      status: row.status,
      currentPeriodEnd: row.currentPeriodEnd,
      endedAt: row.endedAt,
    }));
  }

  /**
   * The tenants and their live workspaces, for the subscription form's pickers.
   *
   * The only place this module exposes the organization list, and it exists for
   * that one screen — see the `billing:manage` bindings in feature-keys.ts. It
   * is not the Organizations screen's query; that one arrives with its own key
   * when the screen does.
   */
  async listOrganizations() {
    const rows = await this.prisma.permOrganization.findMany({
      include: {
        workspaces: { select: { id: true, key: true, name: true, archivedAt: true } },
        memberships: { select: { id: true, status: true } },
      },
      orderBy: { name: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      // ACTIVE members only. An invited or suspended row is a person who cannot
      // act, and counting them would make a seat cap look breached when it is
      // not — `assertCapacity` counts the same way.
      memberCount: row.memberships.filter((membership) => membership.status === 'active').length,
      workspaceCount: row.workspaces.filter((workspace) => workspace.archivedAt === null).length,
      workspaces: row.workspaces
        /*
         * Archived workspaces are dropped HERE rather than in the query, and
         * only here. This list feeds a picker, and offering an archived
         * workspace would let somebody subscribe one that no longer resolves —
         * `loadContext` refuses an archived workspace outright. The
         * subscription LIST reads the same query and keeps them, because it has
         * to be able to name one. See `OrganizationRow`.
         */
        .filter((workspace) => workspace.archivedAt === null)
        .map((workspace) => ({ id: workspace.id, key: workspace.key, name: workspace.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }

  /**
   * One organization, with its people and workspaces, for the admin screens.
   *
   * Null when it does not exist — not an error. The caller is a screen loading
   * from a URL, and a stale bookmark is an ordinary state rather than a fault.
   *
   * Returns `userId` and nothing else about a person: this module does not own
   * identity (§12.12), so names and email addresses are the app's to join. That
   * is the same boundary `grantAppRole` keeps by taking a userId rather than an
   * email.
   */
  async listOrganizationDetail(organizationId: string) {
    const row = await this.prisma.permOrganization.findFirst({
      where: { id: organizationId },
      include: {
        // No tokenHash — see InvitationRow. It is the only thing between a
        // database read and a working link.
        invitations: {
          select: {
            id: true,
            email: true,
            status: true,
            expiresAt: true,
            createdAt: true,
            acceptedAt: true,
            revokedAt: true,
            invitedByUserId: true,
            acceptedByUserId: true,
            role: { select: { id: true, key: true, label: true, level: true, icon: true } },
          },
        },
        workspaces: {
          include: {
            members: {
              include: {
                roles: { include: { role: { select: { id: true, key: true, label: true, level: true, icon: true } } } },
              },
            },
          },
        },
        memberships: {
          include: {
            roles: { include: { role: { select: { id: true, key: true, label: true, level: true, icon: true } } } },
            workspaces: { select: { workspaceId: true } },
          },
        },
      },
    });
    if (!row) return null;

    /*
     * membershipId → userId, so a workspace's members can be named.
     *
     * The workspace rows carry a `membershipId`; every screen and every write
     * takes a `userId`. Resolving it HERE rather than in the client means the
     * two lists cannot disagree about who a membership belongs to — they came
     * from one query.
     */
    const userIdByMembership = new Map(row.memberships.map((membership) => [membership.id, membership.userId]));
    const now = new Date();

    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      invitations: row.invitations
        .map((invitation) => ({
          id: invitation.id,
          email: invitation.email,
          /*
           * The DERIVED state, not the column. An invitation that has run out
           * still reads `pending` in storage, and a list showing that would
           * disagree with the accept path one click later — see
           * `invitationState`, which is the one implementation both use.
           */
          state: invitationState(invitation, now),
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
          acceptedAt: invitation.acceptedAt,
          revokedAt: invitation.revokedAt,
          invitedByUserId: invitation.invitedByUserId,
          acceptedByUserId: invitation.acceptedByUserId,
          role: invitation.role,
        }))
        // Live ones first, then by most recently sent — an administrator opens
        // this to see who is still waiting, not to read history.
        .sort(
          (a, b) =>
            Number(a.state !== 'pending') - Number(b.state !== 'pending') ||
            b.createdAt.getTime() - a.createdAt.getTime(),
        ),
      workspaces: row.workspaces
        .map((workspace) => ({
          id: workspace.id,
          key: workspace.key,
          name: workspace.name,
          description: workspace.description,
          archived: workspace.archivedAt !== null,
          memberCount: workspace.members.length,
          members: workspace.members
            .map((member) => ({
              workspaceMemberId: member.id,
              membershipId: member.membershipId,
              /*
               * Empty for a membership that is not in this organization's list —
               * which should be unreachable, and is exactly the cross-tenant row
               * that WAS insertable (§12.34). Empty rather than thrown: an admin
               * screen that cannot render because one row is inconsistent is
               * worse than one showing a blank you can act on.
               */
              userId: userIdByMembership.get(member.membershipId) ?? '',
              roles: member.roles
                .map((link) => ({
                  id: link.role.id,
                  key: link.role.key,
                  label: link.role.label,
                  level: link.role.level,
                  icon: link.role.icon,
                }))
                .sort((a, b) => a.key.localeCompare(b.key)),
            }))
            .sort((a, b) => a.userId.localeCompare(b.userId)),
        }))
        // Live first, then archived; alphabetical within each. The same
        // ordering the plans list uses, and for the same reason: the switch
        // must not look like a delete, but retired rows belong at the bottom.
        .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name)),
      members: row.memberships
        .map((membership) => ({
          membershipId: membership.id,
          userId: membership.userId,
          status: membership.status,
          joinedAt: membership.joinedAt,
          roles: membership.roles
            .map((link) => ({
              id: link.role.id,
              key: link.role.key,
              label: link.role.label,
              level: link.role.level,
              icon: link.role.icon,
            }))
            .sort((a, b) => a.key.localeCompare(b.key)),
          workspaceIds: membership.workspaces.map((link) => link.workspaceId).sort(),
        }))
        // By userId, which is stable and total. Sorting by name is the app's
        // job once it has joined them — this layer has no name to sort on.
        .sort((a, b) => a.userId.localeCompare(b.userId)),
    };
  }

  /**
   * ONE workspace, plus the organization's member list, for the tenant screen.
   *
   * ## Why the members come along
   *
   * The screen's "add somebody" picker may only offer people who are already in
   * the ORGANIZATION — a workspace member is always an organization member
   * first — so the page needs both lists whatever it does. Fetching them
   * together means they cannot disagree about who is in what, which two round
   * trips eventually would.
   *
   * ## Built on `listOrganizationDetail`, and that is a deliberate second choice
   *
   * A dedicated workspace query was written first and reverted. The module
   * reaches the database through a hand-written structural interface, and
   * adding a second `permWorkspace.findFirst` shape means declaring an OVERLOAD
   * — which a generated Prisma delegate cannot satisfy, because TypeScript
   * cannot match its `findFirst<T extends Args>` generic against an overload
   * set. See the note on `permWorkspace` in permissions.repository.ts; the
   * app's `satisfies-modules.ts` is what caught it.
   *
   * So this over-fetches: it loads the organization's invitations and every
   * workspace's members to return one workspace and the member list. That is
   * the same trade the ADMIN workspace screen already makes, for the same
   * reason, and it costs one query rather than one query plus an interface that
   * the real client no longer fits.
   *
   * ## The SCOPE is not weakened by that
   *
   * Worth being explicit, because reading an organization-wide row to answer a
   * workspace-level question looks like a hole and is not. Whether the caller
   * may be here at all is decided by `FeatureGuard` before this runs:
   * `Query.myWorkspace` declares `@RequireScope('workspace')`, so
   * `canAccessWorkspace` is checked against the resolved context first. This
   * function is data access, and what it RETURNS is one workspace plus the pool
   * its picker may draw from — never the other workspaces it read past.
   *
   * Null when the workspace does not exist in this organization. The
   * organizationId is the row's own, so a workspace id from another tenant
   * finds nothing rather than returning somebody else's data.
   */
  async listWorkspaceDetail(organizationId: string, workspaceId: string) {
    const organization = await this.listOrganizationDetail(organizationId);
    if (!organization) return null;

    const workspace = organization.workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace) return null;

    return {
      organizationId: organization.id,
      organizationKey: organization.key,
      organizationName: organization.name,
      workspace,
      organizationMembers: organization.members,
    };
  }

  /**
   * The workspaces of one organization that a caller may actually ENTER.
   *
   * For the drawer's workspace selector, and shaped by the model rather than by
   * the screen: §12.33 makes workspace membership REQUIRED and says no role
   * widens it, so "which workspaces are in this organization" is the wrong
   * question — a picker answering it would offer rows the guard refuses on
   * arrival, which is the mismatch a shared key exists to prevent.
   *
   * @param accessibleWorkspaceIds straight from `PermissionContext`. An ARRAY is
   * the ids they were added to, and an empty one is a normal state — a member
   * who has been shared nothing yet. `null` means EVERY workspace and platform
   * support is the only thing that produces it, so the filter is dropped rather
   * than applied to nothing. Treating null as "some" locks support out;
   * treating empty as "all" opens everything.
   *
   * Archived workspaces are excluded, unlike the management lists: those must
   * show one so the switch does not read as a delete, while this one must not
   * offer somewhere nobody can go.
   */
  async listAccessibleWorkspaces(
    organizationId: string,
    userId: string,
    accessibleWorkspaceIds: readonly string[] | null,
  ) {
    // No ids and not the wildcard: they are in nothing here, so there is
    // nothing to ask the database.
    if (accessibleWorkspaceIds !== null && accessibleWorkspaceIds.length === 0) return [];

    const workspaces = await this.prisma.permWorkspace.findMany({
      where: {
        organizationId,
        archivedAt: null,
        ...(accessibleWorkspaceIds === null ? {} : { id: { in: [...accessibleWorkspaceIds] } }),
      },
      select: { id: true, key: true, name: true, description: true },
      // By name, so a picker does not reshuffle between renders — the order the
      // database returns is whatever the plan happened to produce.
      orderBy: { name: 'asc' },
    });
    if (workspaces.length === 0) return [];

    /*
     * The caller's WORKSPACE-level role in each, read separately and joined
     * here.
     *
     * It hangs off `PermWorkspaceMember` rather than off the organization
     * membership — the schema making "a workspace role for somebody not in the
     * workspace" impossible to express — so it cannot be read from the
     * organization side, and the workspace row does not carry it either.
     *
     * PLATFORM SUPPORT HOLDS NONE. Their `accessibleWorkspaceIds` is null
     * because they may enter every workspace without belonging to any, so this
     * read simply finds no rows and every workspace comes back with a null
     * role. That is the honest answer: they are visiting, exactly as the
     * organization switcher says when they are in a tenant they are not a
     * member of.
     */
    const memberships = await this.prisma.permWorkspaceMember.findMany({
      where: {
        workspaceId: { in: workspaces.map((workspace) => workspace.id) },
        // Scoped by BOTH, so a membership of the same person in ANOTHER
        // organization cannot supply a role here — the cross-tenant row §12.34
        // still permits is refused by the read rather than trusted.
        membership: { userId, organizationId },
      },
      select: {
        workspaceId: true,
        roles: {
          where: { role: { disabledAt: null } },
          select: { role: { select: { key: true, label: true, icon: true } } },
        },
      },
    });

    /*
     * At most one role each, enforced by `@@unique([workspaceMemberId])` — a
     * member is one thing in a workspace. Read as a list because that is the
     * shape the relation returns, and flattened here so a picker does not have
     * to know the constraint.
     */
    const roleByWorkspace = new Map(memberships.map((row) => [row.workspaceId, row.roles[0]?.role ?? null]));

    return workspaces.map((workspace) => {
      const role = roleByWorkspace.get(workspace.id) ?? null;
      return {
        ...workspace,
        roleKey: role?.key ?? null,
        roleLabel: role?.label ?? null,
        roleIcon: role?.icon ?? null,
      };
    });
  }

  async loadContext(
    userId: string,
    scope: { organizationId?: string | undefined; workspaceId?: string | null | undefined } = {},
  ): Promise<PermissionContext | null> {
    // App-level roles are granted to the user outright, with no organization in
    // the picture. Loaded first because a support engineer holding one has no
    // membership anywhere and must still get a usable context.
    /*
     * `disabledAt: null` at all three levels below, alongside the feature
     * filter that was already here.
     *
     * A disabled role must GRANT NOTHING — that is the entire meaning of the
     * switch, and it is enforced here rather than at the write path, because a
     * role can be disabled long after it was handed out. Filtering in the QUERY
     * rather than in code afterwards is the same call the `deprecatedAt` filter
     * beside it makes: a grant that is loaded and then dropped still exists in
     * memory for something later to read by mistake.
     */
    const appRoles = await this.prisma.permUserRole.findMany({
      where: { userId, role: { disabledAt: null } },
      include: { role: { include: { features: { where: { feature: { deprecatedAt: null } } }, limits: true } } },
    });

    const appRoleGrants: RoleGrant[] = appRoles.map((link) => ({
      roleKey: link.role.key,
      level: toRoleLevel(link.role.level),
      // Carried for the badge on the context, never for a check — see AppRole.
      label: link.role.label,
      icon: link.role.icon,
      features: link.role.features.map((rf) => rf.featureKey),
      workspaceId: null,
      // How many organizations this user may have rides on their app-level
      // role, so the caps travel with the grant that sets them.
      limits: Object.fromEntries(link.role.limits.map((limit) => [limit.limitKey, limit.value])),
    }));

    // An app-level request is answered by app-level roles alone, so neither the
    // membership nor the subscription is worth a round trip. Skipping them is
    // not just an optimisation: querying a membership with no organization in
    // hand would pick an arbitrary one, and answer a question nobody asked.
    if (!scope.organizationId) {
      if (appRoleGrants.length === 0) return null;
      return composeContext({ subjectId: userId, organizationId: null, roles: appRoleGrants });
    }

    const membership = await this.prisma.permMembership.findFirst({
      where: { userId, status: 'active', organizationId: scope.organizationId },
      include: {
        roles: {
          where: { role: { disabledAt: null } },
          include: { role: { include: { features: { where: { feature: { deprecatedAt: null } } } } } },
        },
        /*
         * Scoped to THIS organization's live workspaces. Both halves matter and
         * both were verified as real leaks — see the interface. Filtered in the
         * query rather than afterwards, like every other defensive filter here:
         * an id that is loaded and then dropped is still there for something
         * later to read by mistake.
         */
        workspaces: {
          where: { workspace: { organizationId: scope.organizationId, archivedAt: null } },
          select: { workspaceId: true },
        },
      },
    });
    // No membership is not the same as no access: platform staff legitimately
    // hold app-level roles and belong to no organization at all. Returning null
    // here would lock support out of the organizations they exist to help.
    if (!membership) {
      if (appRoleGrants.length === 0) return null;
      return composeContext({
        subjectId: userId,
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId ?? null,
        roles: appRoleGrants,
        // Their access does not depend on this customer's plan, so no
        // subscription is loaded and none is applied.
        plans: undefined,
      });
    }

    // The level filter is applied in composeContext, so the rule lives in one
    // pure, testable place rather than in a where clause every future caller has
    // to remember to repeat.
    // A role scoped to one organization must not grant anything in another.
    // Nothing on the write path enforces this yet (there is no write path), so
    // the read side refuses defensively rather than trusting the row.
    const ownedByThisTenant = (role: { organizationId: string | null }) =>
      role.organizationId === null || role.organizationId === membership.organizationId;

    const roles: RoleGrant[] = [...appRoleGrants];
    roles.push(
      ...membership.roles
        .filter((link) => ownedByThisTenant(link.role))
        .map((link) => ({
          roleKey: link.role.key,
          level: toRoleLevel(link.role.level),
          features: link.role.features.map((rf) => rf.featureKey),
          workspaceId: null,
        })),
    );

    // The workspace named in the path must belong to the organization named in
    // the path, and must not be archived. Nothing else checks that a URL pairs
    // two ids from the same tenant: without this, an administrator of one
    // organization addressing another's workspace is authorised for it by their
    // own organization's roles.
    //
    // Treated as not found rather than as a denial: the caller learns nothing
    // about whether the workspace exists elsewhere.
    const workspaceId = scope.workspaceId ?? null;
    if (workspaceId) {
      const workspace = await this.prisma.permWorkspace.findFirst({
        where: { id: workspaceId, organizationId: membership.organizationId, archivedAt: null },
        select: { id: true },
      });
      if (!workspace) return null;
    }

    if (workspaceId) {
      const workspaceMember = await this.prisma.permWorkspaceMember.findFirst({
        where: { membershipId: membership.id, workspaceId },
        include: {
          roles: {
            where: { role: { disabledAt: null } },
            include: { role: { include: { features: { where: { feature: { deprecatedAt: null } } } } } },
          },
        },
      });

      roles.push(
        ...(workspaceMember?.roles ?? [])
          .filter((link) => ownedByThisTenant(link.role))
          .map((link) => ({
            roleKey: link.role.key,
            level: toRoleLevel(link.role.level),
            features: link.role.features.map((rf) => rf.featureKey),
            workspaceId,
          })),
      );
    }

    // Organization-wide plans, plus the active workspace's own if it has one.
    // Additive: a workspace plan adds to what the organization bought.
    const subscriptions = await this.prisma.permSubscription.findMany({
      where: {
        organizationId: membership.organizationId,
        // Every field below is optional on the interface so ONE signature can
        // serve the admin list too. Omitting `status` here would silently
        // entitle a canceled subscription, which is why all four are passed.
        status: 'active',
        // An ARCHIVED plan stops entitling. Filtered in the query rather than
        // afterwards, exactly as `disabledAt` and `deprecatedAt` are above: a
        // row loaded and then dropped still exists for something later to read
        // by mistake, and a column nothing reads is a switch that looks like it
        // works.
        plan: { archivedAt: null },
        OR: workspaceId ? [{ workspaceId: null }, { workspaceId }] : [{ workspaceId: null }],
      },
      // A retired key stops ENTITLING as well as granting — filtered in the
      // query, like the role-feature reads, so it never reaches composition.
      include: { plan: { include: { features: { where: { feature: { deprecatedAt: null } } }, limits: true } } },
    });

    // An empty list, not undefined: no active subscription entitles nothing.
    // Undefined is reserved for apps with no subscription model at all.
    const plans: PlanEntitlement[] = subscriptions.map((sub) => ({
      planKey: sub.planKey,
      workspaceId: sub.workspaceId,
      features: sub.plan.features.map((pf) => pf.featureKey),
      limits: Object.fromEntries(sub.plan.limits.map((limit) => [limit.limitKey, limit.value])),
    }));

    return composeContext({
      subjectId: userId,
      organizationId: membership.organizationId,
      workspaceId,
      workspaceIds: membership.workspaces.map((link) => link.workspaceId),
      roles,
      plans,
    });
  }

  /**
   * Whether one more organization, member, workspace or workspace member fits.
   *
   * Asked when something is ADDED, never when something is read — a full
   * organization is not an unauthorised one, and answering "access denied" to
   * "invite a colleague" sends the ticket to the wrong team. Callers should
   * surface `limit` and `current` so the message can say what to do about it.
   */
  async checkCapacity(
    ctx: PermissionContext,
    key: LimitKey,
    target: { organizationId?: string; workspaceId?: string } = {},
  ): Promise<LimitDecision> {
    const organizationId = target.organizationId ?? ctx.organizationId;
    const workspaceId = target.workspaceId ?? ctx.workspaceId;

    // An unregistered key would resolve to no cap and quietly allow everything,
    // so a typo fails loudly instead.
    if (!LIMIT_REGISTRY.some((spec) => spec.key === key)) {
      throw new Error(`Unknown limit '${key}'. Add it to LIMIT_REGISTRY before checking it.`);
    }

    let current = 0;
    if (key === LIMIT.userOrganizations) {
      current = await this.prisma.permMembership.count({ where: { userId: ctx.subjectId, status: 'active' } });
    } else if (key === LIMIT.organizationMembers && organizationId) {
      current = await this.prisma.permMembership.count({ where: { organizationId, status: 'active' } });
    } else if (key === LIMIT.organizationWorkspaces && organizationId) {
      current = await this.prisma.permWorkspace.count({ where: { organizationId, archivedAt: null } });
    } else if (key === LIMIT.workspaceMembers && workspaceId) {
      current = await this.prisma.permWorkspaceMember.count({ where: { workspaceId } });
    }

    return checkLimit(ctx.limits, key, current);
  }
}
