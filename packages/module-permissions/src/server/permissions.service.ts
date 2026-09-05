import { Inject, Injectable } from '@nestjs/common';
import { composeContext, type PlanEntitlement, type RoleGrant } from '../domain/grants.js';
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
  async loadContext(
    userId: string,
    scope: { organizationId?: string | undefined; workspaceId?: string | null | undefined } = {},
  ): Promise<PermissionContext | null> {
    // App-level roles are granted to the user outright, with no organization in
    // the picture. Loaded first because a support engineer holding one has no
    // membership anywhere and must still get a usable context.
    const appRoles = await this.prisma.permUserRole.findMany({
      where: { userId },
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
        roles: { include: { role: { include: { features: { where: { feature: { deprecatedAt: null } } } } } } },
        workspaces: { select: { workspaceId: true } },
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
          roles: { include: { role: { include: { features: { where: { feature: { deprecatedAt: null } } } } } } },
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
        status: 'active',
        OR: workspaceId ? [{ workspaceId: null }, { workspaceId }] : [{ workspaceId: null }],
      },
      include: { plan: { include: { features: true, limits: true } } },
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
