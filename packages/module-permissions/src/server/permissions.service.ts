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
