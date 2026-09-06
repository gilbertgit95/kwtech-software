import { Inject, Injectable, Optional } from '@nestjs/common';
import { hasFeature } from '../check.js';
import { LIMIT, type LimitKey } from '../domain/limits.js';
import { type CloneMode, cloneFeatures, type RoleDraft, validateRoleDraft } from '../domain/role-draft.js';
import {
  type AssignableRole,
  assertNotAppLevel,
  assertRoleAssignable,
  PermissionWriteError,
} from '../domain/writes.js';
import { FEATURE, FEATURE_REGISTRY } from '../feature-keys.js';
import { type FeatureKey, type FeatureSpec, type PermissionContext, toRoleLevel } from '../types.js';
import type { PermissionsModuleOptions } from './permissions.module.js';
import {
  PERMISSIONS_PRISMA_WRITE,
  type PermissionsTransaction,
  type PermissionsWriteClient,
} from './permissions.repository.js';
import { PERMISSIONS_OPTIONS } from './permissions.tokens.js';

/**
 * Changing permissions, as opposed to answering questions about them.
 *
 * This is M4 in docs/PERMISSIONS-REVIEW.md, and it exists because three earlier
 * findings could not be closed without it:
 *
 *   H1  capacity was a method nobody was obliged to call. It now runs where the
 *       row is created, so a cap is a guarantee of this service rather than an
 *       obligation on every consuming app.
 *   C3  a cross-tenant grant could still be WRITTEN; the read side merely
 *       ignored it. The role is now read inside the transaction and refused.
 *   H1' assertRoleFeatureLevels was exported and called by nothing. Defining a
 *       role is now the moment it runs.
 *
 * Every method takes the ACTOR's context and checks it. That is deliberate
 * duplication of what FeatureGuard already does at the HTTP edge: a worker, a
 * CLI command and a seed script reach this service with no guard in front of
 * them, and "the caller checked" is not a property this code can verify. Fail
 * closed (§9 rule 7) applies to writes most of all — a write that skips its
 * check is not a wrong answer, it is a wrong row that outlives the request.
 *
 * NOT here, and deliberately:
 *
 *   subscriptions  written by the billing integration, not by a user action.
 *                  Who writes them, with what idempotency, and what happens
 *                  between a payment failing and `status` changing are open
 *                  questions (PERMISSIONS-REVIEW, "Missing information"), and
 *                  guessing at them would put a wrong answer in the one table a
 *                  permission check must not have to doubt.
 *   users          the module does not own identity (§12.12). It grants against
 *                  a userId it never issues.
 *   an audit trail M7. Every method below takes the actor, so recording WHO did
 *                  this becomes a new table and a call, not a change to every
 *                  signature.
 */
@Injectable()
export class PermissionsWriteService {
  constructor(
    @Optional() @Inject(PERMISSIONS_PRISMA_WRITE) private readonly prisma?: PermissionsWriteClient,
    @Optional() @Inject(PERMISSIONS_OPTIONS) private readonly options?: PermissionsModuleOptions,
  ) {}

  /**
   * Every registered feature, from wherever it was declared.
   *
   * Falls back to this module's own registry, which is right for an app that
   * mounts only this module. An app mounting several passes the composed list
   * through `PermissionsModule.forRoot({ featureRegistry })` — without it, a
   * role could never be given another module's key, and a clone would report a
   * perfectly valid feature as "not in the registry".
   */
  private get registry(): readonly FeatureSpec[] {
    return this.options?.featureRegistry ?? FEATURE_REGISTRY;
  }

  // ── organizations ─────────────────────────────────────────────────────────

  /**
   * Creates an organization and makes its creator the first member.
   *
   * Guarded by a LIMIT rather than by a feature: creating an organization is
   * not a right an organization grants — there is no organization yet to grant
   * it. `user:organizations` comes from the actor's app-level role, which is
   * why that limit is role-sourced and resolves even at app level.
   *
   * The membership is created in the same transaction. An organization whose
   * founder is not in it is unreachable by anyone, and would sit there counting
   * against nobody's cap.
   */
  async createOrganization(actor: PermissionContext, input: { key: string; name: string }) {
    const db = this.client();

    return db.$transaction(async (tx) => {
      await this.assertCapacity(tx, actor, LIMIT.userOrganizations, {});

      const organization = await tx.permOrganization.create({
        data: { key: input.key, name: input.name },
        select: { id: true },
      });
      const membership = await tx.permMembership.create({
        data: { userId: actor.subjectId, organizationId: organization.id, status: 'active' },
        select: { id: true },
      });

      return { organizationId: organization.id, membershipId: membership.id };
    });
  }

  // ── role definitions ──────────────────────────────────────────────────────
  //
  // Defining a role, as opposed to handing one out. `assignRole` below attaches
  // an existing role to a person; these three decide what a role IS.
  //
  // There is no delete. Every grant ever made points at the row, so removing it
  // either cascades that history away or fails on a foreign key at the worst
  // moment — `setRoleDisabled` is the reversible answer, and the read path
  // stops honouring a disabled role at all three levels.

  /**
   * Defines a new role.
   *
   * Two separate rights are checked, and the split is the point: `roles:create`
   * is the ordinary administrative act, while `roles:manage_app` is needed on
   * top when the role's own LEVEL is app. An app role applies in every
   * organization and skips the subscription filter, so minting one is a
   * platform operation wearing the same button as a tenant one.
   */
  async createRole(actor: PermissionContext, draft: RoleDraft) {
    this.assertPermitted(actor, FEATURE.rolesCreate);
    const db = this.client();

    return db.$transaction(async (tx) => {
      const errors = validateRoleDraft(draft, {
        registry: this.registry,
        // One namespace: every role written here is a shared preset, so a key
        // must be unique across all of them rather than per owner.
        existingKeys: await this.keysInScope(tx, null),
        actorFeatures: actor.effective,
        actorMayWriteAppRoles: hasFeature(actor, FEATURE.rolesManageApp),
      });
      assertNoDraftErrors(errors);

      const role = await tx.permRole.create({
        data: {
          key: draft.key.trim(),
          label: draft.label.trim(),
          level: toRoleLevel(draft.level),
          // Always a shared preset — see the note in domain/role-draft.ts.
          organizationId: null,
          icon: draft.icon.trim() || null,
          // Only the seeder writes system roles. One created here is an
          // ordinary row the screens may edit.
          isSystem: false,
        },
        select: { id: true },
      });
      await this.replaceRoleFeatures(tx, role.id, draft.features);

      return { roleId: role.id };
    });
  }

  /**
   * Changes what an existing role is and grants.
   *
   * The role's LEVEL and KEY are not changeable, and that is deliberate rather
   * than unimplemented. Both are read by grants that already exist: changing a
   * level silently re-interprets every grant made from it — an organization
   * role becoming a workspace one stops applying organization-wide, with no
   * event anywhere saying so — and changing a key breaks anything naming it.
   * Make a new role and disable the old one; the history stays legible.
   */
  async updateRole(actor: PermissionContext, roleId: string, draft: RoleDraft) {
    this.assertPermitted(actor, FEATURE.rolesUpdate);
    const db = this.client();

    return db.$transaction(async (tx) => {
      const existing = await this.requireWritableRole(tx, roleId, actor);

      const errors = validateRoleDraft(
        { ...draft, key: existing.key, level: existing.level },
        {
          registry: this.registry,
          actorFeatures: actor.effective,
          actorMayWriteAppRoles: hasFeature(actor, FEATURE.rolesManageApp),
        },
      );
      assertNoDraftErrors(errors);

      await tx.permRole.update({
        where: { id: roleId },
        data: { label: draft.label.trim(), icon: draft.icon.trim() || null },
        select: { id: true },
      });
      await this.replaceRoleFeatures(tx, roleId, draft.features);

      return { roleId };
    });
  }

  /**
   * Turns a role off, or back on.
   *
   * Off means it grants nothing: the read path filters `disabledAt: null` at
   * every level, and `requireRole` refuses to hand a disabled role out. The row,
   * its feature list and every grant made from it stay exactly where they are,
   * so turning it back on restores what people had rather than asking somebody
   * to remember it.
   */
  async setRoleDisabled(actor: PermissionContext, roleId: string, disabled: boolean) {
    this.assertPermitted(actor, FEATURE.rolesDisable);
    const db = this.client();

    return db.$transaction(async (tx) => {
      await this.requireWritableRole(tx, roleId, actor);
      await tx.permRole.update({
        where: { id: roleId },
        data: { disabledAt: disabled ? this.now() : null },
        select: { id: true },
      });
      return { roleId, disabled };
    });
  }

  /**
   * What a clone WOULD do, without doing it.
   *
   * Returns the merged list plus what it had to drop, so the screen can show
   * "5 skipped — you do not hold them" BEFORE anyone commits. A clone that
   * silently granted less than the role it copied would be discovered as a
   * denial weeks later, by which time nobody remembers the clone.
   *
   * Nothing is written here. The result is staged into the form, and Save goes
   * through `updateRole` like any other edit — so a clone cannot bypass a rule
   * a manual edit obeys.
   */
  async previewRoleClone(
    actor: PermissionContext,
    input: { sourceRoleId: string; current: readonly FeatureKey[]; level: string; mode: CloneMode },
  ) {
    this.assertPermitted(actor, FEATURE.rolesUpdate);
    const db = this.client();

    const source = await db.permRole.findFirst({
      where: { id: input.sourceRoleId },
      select: { id: true, key: true, level: true, organizationId: true, isSystem: true, disabledAt: true },
    });
    if (!source) throw new PermissionWriteError('not_found', 'No such role', { roleId: input.sourceRoleId });

    const features = await db.permRoleFeature.findMany({
      where: { roleId: source.id },
      select: { featureKey: true },
    });

    return cloneFeatures(
      input.current,
      features.map((row: { featureKey: string }) => row.featureKey),
      input.mode,
      toRoleLevel(input.level),
      { registry: this.registry, actorFeatures: actor.effective },
    );
  }

  /**
   * The keys already taken in the scope a new role would join.
   *
   * Checked in application code because the DATABASE CANNOT check it for the
   * rows that matter most: `@@unique([organizationId, key])` does not constrain
   * app-level roles or shared presets, since organizationId is null there and
   * Postgres treats NULLs as distinct. See docs/PLAN.md §12.19.
   */
  private async keysInScope(tx: PermissionsTransaction, organizationId: string | null): Promise<string[]> {
    const rows = await tx.permRole.findMany({
      where: { organizationId },
      include: { features: { select: { featureKey: true } } },
      orderBy: { key: 'asc' },
    });
    return rows.map((row) => row.key);
  }

  /**
   * The role exists, and it is one the screens may write.
   *
   * A SYSTEM role is refused. `db:sync` replaces what those grant on every run
   * from the definitions in the checkout, so an edit here would look saved and
   * be silently reverted on the next deploy — the same trap the feature screens
   * are built around, and the reason they emit source instead of rows.
   */
  private async requireWritableRole(tx: PermissionsTransaction, roleId: string, actor: PermissionContext) {
    const role = await tx.permRole.findFirst({
      where: { id: roleId },
      select: { id: true, key: true, level: true, organizationId: true, isSystem: true, disabledAt: true },
    });
    if (!role) throw new PermissionWriteError('not_found', 'No such role', { roleId });

    if (role.isSystem) {
      throw new PermissionWriteError(
        'not_permitted',
        'That role is defined in the application and is replaced on every deploy. Copy it into a new role instead.',
        { roleId, key: role.key },
      );
    }
    if (toRoleLevel(role.level) === 'app' && !hasFeature(actor, FEATURE.rolesManageApp)) {
      throw new PermissionWriteError('not_permitted', 'You may not change app-level roles', { roleId });
    }
    return { ...role, level: toRoleLevel(role.level) };
  }

  /**
   * REPLACES the feature list rather than merging into it.
   *
   * The same rule `upsertSystemRole` follows: the list the caller sends is the
   * whole truth about the role, so a key removed in the form is actually
   * revoked instead of lingering because nothing deleted it.
   */
  private async replaceRoleFeatures(tx: PermissionsTransaction, roleId: string, features: readonly FeatureKey[]) {
    const keep = [...new Set(features)];
    await tx.permRoleFeature.deleteMany({ where: { roleId, featureKey: { notIn: keep } } });
    if (keep.length > 0) {
      await tx.permRoleFeature.createMany({
        data: keep.map((featureKey) => ({ roleId, featureKey })),
        skipDuplicates: true,
      });
    }
  }

  // ── members ───────────────────────────────────────────────────────────────

  /**
   * Adds a user to an organization.
   *
   * The userId is taken on trust and stored without a foreign key: the module
   * does not own identity, so the user may live in another module, another
   * database or an external IdP. Verifying they exist is the app's job, and the
   * app is the only party that knows where to look.
   */
  async addMember(actor: PermissionContext, input: { organizationId: string; userId: string }) {
    this.assertPermitted(actor, FEATURE.membersManage);
    const db = this.client();

    return db.$transaction(async (tx) => {
      const existing = await tx.permMembership.findFirst({
        where: { userId: input.userId, organizationId: input.organizationId },
        include: {
          roles: activeRoleGrants,
          workspaces: { select: { workspaceId: true } },
        },
      });
      if (existing) {
        throw new PermissionWriteError('already_exists', 'That user is already a member of this organization', {
          userId: input.userId,
        });
      }

      await this.assertCapacity(tx, actor, LIMIT.organizationMembers, { organizationId: input.organizationId });

      const membership = await tx.permMembership.create({
        data: { userId: input.userId, organizationId: input.organizationId, status: 'active' },
        select: { id: true },
      });
      return { membershipId: membership.id };
    });
  }

  /**
   * Removes a user from an organization.
   *
   * Their role grants and workspace memberships go with them, by cascade — the
   * schema's onDelete, not a sweep here, so a membership row cannot outlive its
   * grants or the reverse.
   */
  async removeMember(actor: PermissionContext, input: { organizationId: string; userId: string }) {
    this.assertPermitted(actor, FEATURE.membersManage);
    const db = this.client();

    const { count } = await db.permMembership.deleteMany({
      where: { userId: input.userId, organizationId: input.organizationId },
    });
    if (count === 0) throw new PermissionWriteError('not_found', 'No such member in this organization', input);
    return { removed: count };
  }

  // ── organization-level role grants ────────────────────────────────────────

  /**
   * Grants an organization-level role to a member.
   *
   * The role is read INSIDE the transaction and judged there — never trusted
   * from the caller, who supplies only an id. A roleId from one tenant attached
   * to a membership in another is exactly C3, and the read side ignoring it is
   * not the same as it not being there.
   */
  async assignRole(actor: PermissionContext, input: { organizationId: string; userId: string; roleId: string }) {
    this.assertPermitted(actor, FEATURE.membersManage);
    const db = this.client();

    return db.$transaction(async (tx) => {
      const membership = await this.requireMembership(tx, input.organizationId, input.userId);
      const role = await this.requireRole(tx, input.roleId);

      assertNotAppLevel(role);
      assertRoleAssignable(role, { organizationId: input.organizationId, level: 'organization' });

      const already = await tx.permMembershipRole.findFirst({
        where: { membershipId: membership.id, roleId: input.roleId },
      });
      // Idempotent where it can be: re-granting a role someone already holds is
      // not an error, and making it one turns every retry into a support ticket.
      if (already) return { granted: false };

      await tx.permMembershipRole.create({ data: { membershipId: membership.id, roleId: input.roleId } });
      return { granted: true };
    });
  }

  async revokeRole(actor: PermissionContext, input: { organizationId: string; userId: string; roleId: string }) {
    this.assertPermitted(actor, FEATURE.membersManage);
    const db = this.client();

    return db.$transaction(async (tx) => {
      const membership = await this.requireMembership(tx, input.organizationId, input.userId);
      const { count } = await tx.permMembershipRole.deleteMany({
        where: { membershipId: membership.id, roleId: input.roleId },
      });
      // Revoking a role nobody holds leaves the world in the state asked for.
      return { revoked: count > 0 };
    });
  }

  // ── workspaces ────────────────────────────────────────────────────────────

  async createWorkspace(actor: PermissionContext, input: { organizationId: string; key: string; name: string }) {
    this.assertPermitted(actor, FEATURE.workspacesManage);
    const db = this.client();

    return db.$transaction(async (tx) => {
      await this.assertCapacity(tx, actor, LIMIT.organizationWorkspaces, { organizationId: input.organizationId });

      const workspace = await tx.permWorkspace.create({
        data: { organizationId: input.organizationId, key: input.key, name: input.name },
        select: { id: true },
      });
      return { workspaceId: workspace.id };
    });
  }

  /**
   * Archives a workspace rather than deleting it.
   *
   * An archived workspace stops resolving (H3), so it stops granting; its rows
   * stay, so past access remains reconstructable. The update is scoped by
   * organizationId as well as id — nothing else stops one tenant naming
   * another's workspace.
   */
  async archiveWorkspace(actor: PermissionContext, input: { organizationId: string; workspaceId: string }) {
    this.assertPermitted(actor, FEATURE.workspacesManage);
    const db = this.client();

    const { count } = await db.permWorkspace.updateMany({
      where: { id: input.workspaceId, organizationId: input.organizationId },
      data: { archivedAt: this.now() },
    });
    if (count === 0) throw new PermissionWriteError('not_found', 'No such workspace in this organization', input);
    return { archived: true };
  }

  /**
   * Shares a workspace with an organization member.
   *
   * Routed through the membership, not the user: you cannot be in a workspace
   * of an organization you do not belong to, and going via the membership makes
   * that impossible to express rather than merely wrong.
   */
  async shareWorkspace(
    actor: PermissionContext,
    input: { organizationId: string; workspaceId: string; userId: string },
  ) {
    this.assertPermitted(actor, FEATURE.workspacesShare);
    const db = this.client();

    return db.$transaction(async (tx) => {
      const membership = await this.requireMembership(tx, input.organizationId, input.userId);
      await this.requireWorkspace(tx, input.organizationId, input.workspaceId);

      const existing = await tx.permWorkspaceMember.findFirst({
        where: { membershipId: membership.id, workspaceId: input.workspaceId },
        include: { roles: activeRoleGrants },
      });
      if (existing) return { shared: false };

      await this.assertCapacity(tx, actor, LIMIT.workspaceMembers, { workspaceId: input.workspaceId });

      const member = await tx.permWorkspaceMember.create({
        data: { membershipId: membership.id, workspaceId: input.workspaceId },
        select: { id: true },
      });
      return { shared: true, workspaceMemberId: member.id };
    });
  }

  async unshareWorkspace(
    actor: PermissionContext,
    input: { organizationId: string; workspaceId: string; userId: string },
  ) {
    this.assertPermitted(actor, FEATURE.workspacesShare);
    const db = this.client();

    return db.$transaction(async (tx) => {
      const membership = await this.requireMembership(tx, input.organizationId, input.userId);
      const { count } = await tx.permWorkspaceMember.deleteMany({
        where: { membershipId: membership.id, workspaceId: input.workspaceId },
      });
      // Workspace role grants cascade off the membership row, so removing
      // someone from a workspace cannot leave a role behind that would let them
      // back in.
      return { unshared: count > 0 };
    });
  }

  // ── workspace-level role grants ───────────────────────────────────────────

  /**
   * Grants a workspace-level role, which requires workspace membership first.
   *
   * That order is structural rather than checked: the grant hangs off
   * PermWorkspaceMember, so there is nowhere to put a role for someone who is
   * not in the workspace. Hence the explicit not_found rather than an implicit
   * insert of both.
   */
  async assignWorkspaceRole(
    actor: PermissionContext,
    input: { organizationId: string; workspaceId: string; userId: string; roleId: string },
  ) {
    this.assertPermitted(actor, FEATURE.workspacesShare);
    const db = this.client();

    return db.$transaction(async (tx) => {
      const membership = await this.requireMembership(tx, input.organizationId, input.userId);
      const member = await tx.permWorkspaceMember.findFirst({
        where: { membershipId: membership.id, workspaceId: input.workspaceId },
        include: { roles: activeRoleGrants },
      });
      if (!member) {
        throw new PermissionWriteError('not_found', 'Share the workspace with them before granting a role in it', {
          userId: input.userId,
          workspaceId: input.workspaceId,
        });
      }

      const role = await this.requireRole(tx, input.roleId);
      assertNotAppLevel(role);
      assertRoleAssignable(role, { organizationId: input.organizationId, level: 'workspace' });

      const workspaceMemberId = await this.workspaceMemberId(tx, membership.id, input.workspaceId);
      const already = await tx.permWorkspaceMemberRole.findFirst({
        where: { workspaceMemberId, roleId: input.roleId },
      });
      if (already) return { granted: false };

      await tx.permWorkspaceMemberRole.create({ data: { workspaceMemberId, roleId: input.roleId } });
      return { granted: true };
    });
  }

  async revokeWorkspaceRole(
    actor: PermissionContext,
    input: { organizationId: string; workspaceId: string; userId: string; roleId: string },
  ) {
    this.assertPermitted(actor, FEATURE.workspacesShare);
    const db = this.client();

    return db.$transaction(async (tx) => {
      const membership = await this.requireMembership(tx, input.organizationId, input.userId);
      const workspaceMemberId = await this.workspaceMemberId(tx, membership.id, input.workspaceId);
      const { count } = await tx.permWorkspaceMemberRole.deleteMany({
        where: { workspaceMemberId, roleId: input.roleId },
      });
      return { revoked: count > 0 };
    });
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * A write-capable client is bound separately from the read one, so an app
   * that wired only reads gets a clear error here rather than a method that is
   * silently absent at the first call.
   */
  private client(): PermissionsWriteClient {
    if (!this.prisma) {
      throw new Error(
        'PermissionsWriteService needs a write-capable client. Bind PERMISSIONS_PRISMA_WRITE in PermissionsModule.forRoot.',
      );
    }
    return this.prisma;
  }

  /** Overridable in tests; a write path should not be the reason a clock is untestable. */
  protected now(): Date {
    return new Date();
  }

  private assertPermitted(actor: PermissionContext | undefined, feature: FeatureKey): void {
    if (!hasFeature(actor, feature)) {
      throw new PermissionWriteError('not_permitted', `Requires ${feature}`, { feature });
    }
  }

  /**
   * Capacity, counted and refused where the row is created.
   *
   * The count runs on the transaction handle, so it sees this transaction's own
   * inserts — createOrganization's membership counts against the organizations
   * cap the moment it exists, not on the next call.
   */
  private async assertCapacity(
    tx: PermissionsTransaction,
    actor: PermissionContext,
    key: LimitKey,
    target: { organizationId?: string; workspaceId?: string },
  ): Promise<void> {
    const limit = actor.limits[key] ?? null;
    if (limit === null) return;

    let current = 0;
    if (key === LIMIT.userOrganizations) {
      current = await tx.permMembership.count({ where: { userId: actor.subjectId, status: 'active' } });
    } else if (key === LIMIT.organizationMembers && target.organizationId) {
      current = await tx.permMembership.count({ where: { organizationId: target.organizationId, status: 'active' } });
    } else if (key === LIMIT.organizationWorkspaces && target.organizationId) {
      current = await tx.permWorkspace.count({ where: { organizationId: target.organizationId, archivedAt: null } });
    } else if (key === LIMIT.workspaceMembers && target.workspaceId) {
      current = await tx.permWorkspaceMember.count({ where: { workspaceId: target.workspaceId } });
    }

    if (current >= limit) {
      // 'at_capacity', never 'not_permitted'. A full organization is not an
      // unauthorised one, and answering "access denied" to "invite a colleague"
      // sends the ticket to the wrong team.
      throw new PermissionWriteError('at_capacity', `Limit '${key}' reached`, { limit: key, cap: limit, current });
    }
  }

  private async requireMembership(tx: PermissionsTransaction, organizationId: string, userId: string) {
    const membership = await tx.permMembership.findFirst({
      where: { userId, organizationId, status: 'active' },
      include: {
        roles: activeRoleGrants,
        workspaces: { select: { workspaceId: true } },
      },
    });
    if (!membership) {
      throw new PermissionWriteError('not_found', 'No such member in this organization', { userId, organizationId });
    }
    return membership;
  }

  private async requireWorkspace(tx: PermissionsTransaction, organizationId: string, workspaceId: string) {
    const workspace = await tx.permWorkspace.findFirst({
      where: { id: workspaceId, organizationId, archivedAt: null },
      select: { id: true },
    });
    if (!workspace) {
      throw new PermissionWriteError('not_found', 'No such workspace in this organization', {
        workspaceId,
        organizationId,
      });
    }
    return workspace;
  }

  private async requireRole(tx: PermissionsTransaction, roleId: string): Promise<AssignableRole> {
    const role = await tx.permRole.findFirst({
      where: { id: roleId },
      select: { id: true, key: true, level: true, organizationId: true, isSystem: true, disabledAt: true },
    });
    if (!role) throw new PermissionWriteError('not_found', 'No such role', { roleId });

    /*
     * A DISABLED role cannot be handed out.
     *
     * The read path already ignores it, so assigning one would write a row that
     * grants nothing — and then look, in every members list, exactly like a
     * grant that works. Refusing here means "why does this person have no
     * access" never has this answer.
     */
    if (role.disabledAt) {
      throw new PermissionWriteError('not_found', 'That role is disabled and cannot be assigned', { roleId });
    }

    // Validated, not cast: a row holding 'Organization' would otherwise pass
    // every check here and then match nothing on the read side.
    return { key: role.key, level: toRoleLevel(role.level), organizationId: role.organizationId };
  }

  private async workspaceMemberId(
    tx: PermissionsTransaction,
    membershipId: string,
    workspaceId: string,
  ): Promise<string> {
    const member = await tx.permWorkspaceMember.findFirst({
      where: { membershipId, workspaceId },
      include: { roles: activeRoleGrants },
    });
    if (!member) {
      throw new PermissionWriteError('not_found', 'That member is not in this workspace', { workspaceId });
    }
    return member.id;
  }
}

/** The deprecation filter every role-feature read carries (H2). */
const activeFeatures = { where: { feature: { deprecatedAt: null } } } as const;

/**
 * Role grants that still count.
 *
 * The write path re-derives the ACTOR's own context from these rows before
 * deciding whether they may proceed, so a disabled role must drop out here for
 * exactly the reason it drops out of the read path: the switch means "grants
 * nothing", and a write authorised by a role somebody turned off is the one
 * place that would be hardest to explain afterwards.
 */
const activeRoleGrants = {
  where: { role: { disabledAt: null } },
  include: { role: { include: { features: activeFeatures } } },
} as const;

/**
 * Turns a field-keyed error map into the write path's own refusal.
 *
 * The FORM shows these per field; an API caller gets one sentence naming every
 * problem at once, for the same reason `validateRoleDraft` returns them all:
 * an endpoint that reports one error per request makes a client play twenty
 * questions with it.
 */
function assertNoDraftErrors(errors: Record<string, string | undefined>): void {
  const problems = Object.entries(errors)
    .filter(([, message]) => message)
    .map(([field, message]) => `${field}: ${message}`);
  if (problems.length > 0) {
    throw new PermissionWriteError('role_features_invalid', problems.join('; '), {});
  }
}
