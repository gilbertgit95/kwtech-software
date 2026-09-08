import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { hasFeature } from '../check.js';
import type { CloneMode } from '../domain/feature-merge.js';
import {
  INVITATION_TTL_MS,
  type InvitationDraft,
  isAcceptable,
  normaliseInviteEmail,
  validateInvitationDraft,
} from '../domain/invitation.js';
import { assertPlanLimits, LIMIT, type LimitKey } from '../domain/limits.js';
import { clonePlanFeatures, type PlanDraft, planLimitValues, validatePlanDraft } from '../domain/plan-draft.js';
import { cloneFeatures, type RoleDraft, validateRoleDraft } from '../domain/role-draft.js';
import {
  type SubscriptionDraft,
  subscriptionPeriodEnd,
  validateSubscriptionDraft,
} from '../domain/subscription-draft.js';
import {
  type AssignableRole,
  assertNotAppLevel,
  assertRoleAssignable,
  PermissionWriteError,
  type WriteRefusalReason,
} from '../domain/writes.js';
import { FEATURE, FEATURE_REGISTRY } from '../feature-keys.js';
import {
  type FeatureKey,
  type FeatureSpec,
  type PermissionContext,
  toRoleLevel,
  toSubscriptionStatus,
} from '../types.js';
import type { PermissionsModuleOptions } from './permissions.module.js';
import { NULL_PUBSUB, PERMISSIONS_EVENT, PERMISSIONS_PUBSUB, type PermissionsPubSub } from './permissions.pubsub.js';
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
 *   users          the module does not own identity (§12.12). It grants against
 *                  a userId it never issues.
 *   an audit trail M7. Every method below takes the actor, so recording WHO did
 *                  this becomes a new table and a call, not a change to every
 *                  signature.
 *
 * ## Subscriptions are written here now, and they were not
 *
 * This service previously refused to touch `perm_subscription` on the grounds
 * that billing owns it and the idempotency questions were unanswered. That
 * decision is reversed (docs/PLAN.md §12), and the questions it deferred are
 * answered rather than dropped:
 *
 *   who writes    an administrator holding `billing:manage`, through the
 *                 subscription screens. A billing provider integrating later
 *                 must RECONCILE against these rows — read them, then supersede
 *                 what disagrees — rather than assume it is the only writer.
 *   idempotency   the live row for one (organization, workspace, plan) is
 *                 unique: `startSubscription` refuses a second while the first
 *                 has no `endedAt`, so a retried request cannot double-entitle.
 *                 There is no upsert, because a subscription is not a
 *                 fact-of-the-day to be overwritten — it is an event with a
 *                 beginning and an end.
 *   payment fails `status` moves to `past_due` and the row stays. Entitlement
 *                 stops immediately, because `loadContext` reads only `active`;
 *                 nothing is deleted, so recovering is a status change rather
 *                 than a re-subscription.
 */
@Injectable()
export class PermissionsWriteService {
  constructor(
    @Optional() @Inject(PERMISSIONS_PRISMA_WRITE) private readonly prisma?: PermissionsWriteClient,
    @Optional() @Inject(PERMISSIONS_OPTIONS) private readonly options?: PermissionsModuleOptions,
    /**
     * Optional, and absent is a normal state rather than a misconfiguration: a
     * worker or a CLI importing this service has no socket and nobody to tell.
     * See NULL_PUBSUB.
     */
    @Optional() @Inject(PERMISSIONS_PUBSUB) private readonly pubsub?: PermissionsPubSub,
  ) {}

  /**
   * Announces a change, AFTER the transaction that made it has committed.
   *
   * Order matters and is easy to get backwards: publishing inside the
   * transaction would tell subscribers about a write that can still roll back,
   * and a client that re-reads on the event would race the commit and fetch the
   * old row. Every call site below therefore awaits its `$transaction` first.
   *
   * Never throws. A failed publish must not fail the write that already
   * happened — the row is committed, and turning a notification problem into a
   * write error would make an administrator retry a save that succeeded.
   */
  private async announce(event: string, payload: unknown): Promise<void> {
    try {
      await (this.pubsub ?? NULL_PUBSUB).publish(event, payload);
    } catch {
      // Deliberately swallowed. See above.
    }
  }

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

  /**
   * Renames an organization, or changes its key.
   *
   * ## Why a name is editable at all
   *
   * Because it is a LABEL, not an identity. A company is typed into a form once,
   * by somebody who may mistype it, and then rebrands, gets acquired, or drops
   * the "Ltd" — and an organization that can never be renamed makes the wrong
   * name permanent for everyone who reads it.
   *
   * ## The key is editable too, which a role's and a plan's are not
   *
   * That is not inconsistency. Those are referenced BY key — a plan key is the
   * primary key every subscription points at — while an organization is
   * addressed by `id` everywhere in this codebase, and its key exists for
   * humans. The same argument `updateWorkspace` makes, one level up.
   *
   * ⚠ It is still `@unique`, so renaming onto a key another tenant holds throws
   * from the database. That is left as a constraint violation rather than a
   * pre-check on purpose: a pre-check is a race — two renames to the same key
   * can both pass it — and the index is the thing that is actually true.
   *
   * ## Nothing is renamed by omission
   *
   * Both fields are required and both are trimmed. An update that took optional
   * fields would make "leave the key alone" and "set the key to empty" the same
   * request shape, and the screen sends what it is showing anyway.
   */
  async updateOrganization(actor: PermissionContext, input: { organizationId: string; key: string; name: string }) {
    this.assertPermitted(actor, FEATURE.organizationsManage);
    const db = this.client();

    const key = input.key.trim();
    const name = input.name.trim();
    if (!key || !name) {
      throw new PermissionWriteError('draft_invalid', 'An organization needs a key and a name', {
        organizationId: input.organizationId,
      });
    }

    /*
     * `updateMany`, not `update`, even though the `where` is a unique id.
     *
     * It is what lets a missing row come back as `count: 0` — a
     * `PermissionWriteError` with a sentence — instead of Prisma's
     * record-not-found exception surfacing as a 500 on a screen where somebody
     * simply followed a stale link.
     */
    const { count } = await db.permOrganization.updateMany({
      where: { id: input.organizationId },
      data: { key, name },
    });
    if (count === 0) {
      throw new PermissionWriteError('not_found', 'No such organization', { organizationId: input.organizationId });
    }

    return { organizationId: input.organizationId, renamed: true };
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
      select: { id: true, key: true, level: true, label: true, organizationId: true, isSystem: true, disabledAt: true },
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
      select: { id: true, key: true, level: true, label: true, organizationId: true, isSystem: true, disabledAt: true },
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

  // ── plan definitions ──────────────────────────────────────────────────────
  //
  // Defining a plan, as opposed to selling one. `startSubscription` below
  // attaches an existing plan to a tenant; these four decide what a plan IS.
  //
  // The exact shape of the role block above, and deliberately so: a plan is a
  // named collection of features an organization can BUY, as a role is one a
  // person can be GIVEN. Where they differ is documented at each difference and
  // nowhere else.
  //
  // There is no delete. Every subscription ever written points at the plan row,
  // so removing it either cascades that history away or fails on a foreign key
  // — `setPlanArchived` is the reversible answer, and both the read path and
  // `startSubscription` stop honouring an archived plan.

  /**
   * Defines a new plan.
   *
   * ONE right, not two. `createRole` also checks `roles:manage_app` because a
   * role carries its own level and an app-level one escapes every tenant
   * boundary; a plan has no level to escalate through — `plans:create` is
   * already app level and privileged, so the equivalent check would be the same
   * key twice.
   */
  async createPlan(actor: PermissionContext, draft: PlanDraft) {
    this.assertPermitted(actor, FEATURE.plansCreate);
    const db = this.client();

    const result = await db.$transaction(async (tx) => {
      const errors = validatePlanDraft(draft, {
        registry: this.registry,
        existingKeys: await this.planKeys(tx),
      });
      assertNoDraftErrors(errors, 'draft_invalid');

      const key = draft.key.trim();
      const limits = planLimitValues(draft.limits);
      /*
       * Belt and braces, and worth the duplication: `validatePlanDraft` already
       * refuses a missing required cap with a per-field message, but this is
       * the assertion the SEED path runs, and a plan that reaches the database
       * without it silently caps a paying customer at the registry floor of
       * one. The two must agree, and the way to guarantee that is for both to
       * read LIMIT_REGISTRY.
       */
      assertPlanLimits(key, limits);

      await tx.permPlan.create({
        data: { key, label: draft.label.trim(), isPublic: draft.isPublic, icon: draft.icon.trim() || null },
        select: { key: true },
      });
      await this.replacePlanFeatures(tx, key, draft.features);
      await this.replacePlanLimits(tx, key, limits);

      return { planKey: key };
    });

    await this.announcePlan(result.planKey);
    return result;
  }

  /** Announced after the commit, never inside it. See `announce`. */
  private async announcePlan(planKey: string): Promise<void> {
    await this.announce(PERMISSIONS_EVENT.planChanged, { planKey });
  }

  /**
   * Changes what an existing plan is and entitles.
   *
   * The plan's KEY is not changeable, for the reason a role's is not: it is the
   * primary key, and `PermPlanFeature`, `PermPlanLimit` and every
   * `PermSubscription` reference it. Renaming would either cascade the history
   * away or fail on a foreign key.
   *
   * ⚠ This changes what everyone ALREADY SUBSCRIBED is entitled to, on the next
   * request. That is the intended behaviour — a plan is the live definition of
   * a product, not a snapshot taken at signup — but it is why the key is app
   * level and privileged, and why the screen says so before anyone saves.
   */
  async updatePlan(actor: PermissionContext, planKey: string, draft: PlanDraft) {
    this.assertPermitted(actor, FEATURE.plansUpdate);
    const db = this.client();

    const result = await db.$transaction(async (tx) => {
      const existing = await this.requirePlan(tx, planKey);

      const errors = validatePlanDraft({ ...draft, key: existing.key }, { registry: this.registry });
      assertNoDraftErrors(errors, 'draft_invalid');

      const limits = planLimitValues(draft.limits);
      assertPlanLimits(existing.key, limits);

      await tx.permPlan.update({
        where: { key: existing.key },
        data: { label: draft.label.trim(), isPublic: draft.isPublic, icon: draft.icon.trim() || null },
        select: { key: true },
      });
      await this.replacePlanFeatures(tx, existing.key, draft.features);
      await this.replacePlanLimits(tx, existing.key, limits);

      return { planKey: existing.key };
    });

    await this.announcePlan(result.planKey);
    return result;
  }

  /**
   * Retires a plan, or brings it back.
   *
   * Archived means it entitles nothing and nothing new may subscribe to it:
   * `loadContext` filters `plan: { archivedAt: null }`, and `startSubscription`
   * refuses one. The row, its feature list and every subscription made from it
   * stay exactly where they are, so un-archiving restores what customers had
   * rather than asking somebody to remember it.
   *
   * ⚠ Note what this does to LIVE subscribers: they stop being entitled
   * immediately, which is stronger than "stop selling it". Archiving is the
   * end-of-life switch; hiding a plan from a catalogue while honouring it for
   * whoever already has it is `isPublic`, which is a different field for
   * exactly this reason.
   */
  async setPlanArchived(actor: PermissionContext, planKey: string, archived: boolean) {
    this.assertPermitted(actor, FEATURE.plansArchive);
    const db = this.client();

    const result = await db.$transaction(async (tx) => {
      const existing = await this.requirePlan(tx, planKey);
      await tx.permPlan.update({
        where: { key: existing.key },
        data: { archivedAt: archived ? this.now() : null },
        select: { key: true },
      });
      return { planKey: existing.key, archived };
    });

    /*
     * The event that matters most of the three: archiving cuts entitlement off
     * for every live subscriber at once, so an open screen showing a plan as
     * live is wrong the moment this commits.
     */
    await this.announcePlan(result.planKey);
    return result;
  }

  /**
   * What cloning one plan into another would produce — WITHOUT writing it.
   *
   * The role clone's twin, and it takes no actor features: a plan entitles
   * rather than grants, so there is no escalation to prevent. See
   * `validatePlanFeatures` in domain/plan-draft.ts.
   */
  async previewPlanClone(
    actor: PermissionContext,
    input: { sourcePlanKey: string; current: readonly FeatureKey[]; mode: CloneMode },
  ) {
    this.assertPermitted(actor, FEATURE.plansUpdate);
    const db = this.client();

    const source = await db.permPlan.findFirst({
      where: { key: input.sourcePlanKey },
      select: { key: true, label: true, isPublic: true, icon: true, archivedAt: true },
    });
    if (!source) throw new PermissionWriteError('not_found', 'No such plan', { planKey: input.sourcePlanKey });

    const features = await db.permPlanFeature.findMany({
      where: { planKey: source.key },
      select: { featureKey: true },
    });

    return clonePlanFeatures(
      input.current,
      features.map((row: { featureKey: string }) => row.featureKey),
      input.mode,
      { registry: this.registry },
    );
  }

  // ── subscriptions ─────────────────────────────────────────────────────────
  //
  // Attaching a plan to a tenant, as opposed to defining what the plan is.
  //
  // Guarded by `billing:manage` throughout — ONE key for all three, unlike
  // roles, which split create from update from disable. The split existed there
  // because reviewing roles and rewriting one are genuinely different jobs
  // people hold separately. Starting, amending and ending a subscription are
  // not: anybody trusted to do one is trusted to do the others, and three keys
  // that are always granted together are one key with extra rows.
  //
  // `subscriptions:read` IS separate, because reading who is on what is what
  // support needs to answer "why can they not do this" without being able to
  // change anybody's entitlement.

  /**
   * Starts a subscription: attaches a plan to an organization, or to one
   * workspace inside it.
   *
   * Everything is re-read INSIDE the transaction and judged there — the plan,
   * the organization, and the workspace's membership of that organization. The
   * caller supplies three ids, and a workspace id from one tenant paired with
   * an organization id from another is a perfectly well-formed request that
   * would entitle one customer's workspace off another customer's plan. This is
   * the same argument `assignRole` makes about a roleId, one table over.
   *
   * IDEMPOTENCY: a live row for the same (organization, workspace, plan) is
   * refused rather than duplicated. Two identical active subscriptions entitle
   * exactly what one does, so the second is silent noise in the one table an
   * auditor reads to answer what a customer was sold.
   */
  async startSubscription(actor: PermissionContext, draft: SubscriptionDraft) {
    this.assertPermitted(actor, FEATURE.billingManage);
    const db = this.client();

    return db.$transaction(async (tx) => {
      const errors = validateSubscriptionDraft(draft);
      assertNoDraftErrors(errors, 'draft_invalid');

      await this.requireOrganization(tx, draft.organizationId);

      // The workspace must belong to THIS organization and not be archived —
      // the same pairing check `loadContext` makes before honouring a scope.
      if (draft.workspaceId) {
        await this.requireWorkspace(tx, draft.organizationId, draft.workspaceId);
      }

      const plan = await this.requirePlan(tx, draft.planKey);
      if (plan.archivedAt) {
        throw new PermissionWriteError('not_found', 'That plan is archived and cannot be subscribed to', {
          planKey: plan.key,
        });
      }

      const live = await tx.permSubscription.findFirst({
        where: {
          organizationId: draft.organizationId,
          workspaceId: draft.workspaceId,
          planKey: plan.key,
          endedAt: null,
        },
        select: { id: true, organizationId: true, workspaceId: true, planKey: true, status: true, endedAt: true },
      });
      if (live) {
        /*
         * REFUSED, not returned as a no-op.
         *
         * `assignRole` is idempotent because re-granting a role somebody holds
         * leaves the world in the state asked for. This is different: the
         * existing row carries a status and a period the caller did not send,
         * so silently succeeding would report "subscribed" while the dates and
         * the status stay whatever they were. End it or edit it — both are
         * visible acts.
         */
        throw new PermissionWriteError('already_exists', 'That subscription is already live', {
          subscriptionId: live.id,
          planKey: plan.key,
        });
      }

      const subscription = await tx.permSubscription.create({
        data: {
          organizationId: draft.organizationId,
          workspaceId: draft.workspaceId,
          planKey: plan.key,
          // Validated, not cast: a row holding 'Active' would pass every check
          // here and then entitle nothing, with no error to explain it.
          status: toSubscriptionStatus(draft.status),
          currentPeriodEnd: subscriptionPeriodEnd(draft.currentPeriodEnd),
        },
        select: { id: true },
      });

      return { subscriptionId: subscription.id };
    });
  }

  /**
   * Changes a live subscription's status or renewal date.
   *
   * The TARGET and the PLAN are not changeable, and that is deliberate rather
   * than unimplemented — the same call `updateRole` makes about key and level.
   * Every entitlement decision this row ever produced read all three, so moving
   * a live subscription to another plan silently re-interprets the history:
   * "what was this organization entitled to in March" would answer with what
   * they are entitled to now. Changing plan is two acts, `endSubscription` then
   * `startSubscription`, and the two rows plus `endedAt` reconstruct it.
   *
   * An ENDED subscription is refused. Editing the status of a row that already
   * has an `endedAt` would produce something that reads as live in a list and
   * entitles nothing — the worst of both, and unexplainable afterwards.
   */
  async updateSubscription(
    actor: PermissionContext,
    subscriptionId: string,
    input: { status: string; currentPeriodEnd: string },
  ) {
    this.assertPermitted(actor, FEATURE.billingManage);
    const db = this.client();

    return db.$transaction(async (tx) => {
      const existing = await this.requireLiveSubscription(tx, subscriptionId);

      await tx.permSubscription.update({
        where: { id: existing.id },
        data: {
          status: toSubscriptionStatus(input.status),
          currentPeriodEnd: subscriptionPeriodEnd(input.currentPeriodEnd),
        },
        select: { id: true },
      });

      return { subscriptionId: existing.id };
    });
  }

  /**
   * Ends a subscription. The row stays.
   *
   * Sets `endedAt` AND `status: 'canceled'`, both, because they answer
   * different questions and a reader needs both to be true: `endedAt` is when
   * this row stopped being the current answer, `status` is why. Setting only
   * the timestamp would leave a row that says `active` forever in every list
   * and every export.
   *
   * There is no un-end. Bringing a customer back is a NEW subscription — a new
   * row, with its own start — which is what makes a gap in entitlement visible
   * rather than erased.
   */
  async endSubscription(actor: PermissionContext, subscriptionId: string) {
    this.assertPermitted(actor, FEATURE.billingManage);
    const db = this.client();

    return db.$transaction(async (tx) => {
      const existing = await this.requireLiveSubscription(tx, subscriptionId);

      await tx.permSubscription.update({
        where: { id: existing.id },
        data: { endedAt: this.now(), status: 'canceled' },
        select: { id: true },
      });

      return { subscriptionId: existing.id, ended: true };
    });
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
      await this.requireOrganization(tx, input.organizationId);

      const existing = await tx.permMembership.findFirst({
        where: { userId: input.userId, organizationId: input.organizationId },
        include: {
          roles: activeRoleGrants,
          workspaces: membershipWorkspaces(input.organizationId),
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

  // ── invitations ───────────────────────────────────────────────────────────
  //
  // Inviting somebody who may not have an account yet, which is why an
  // invitation is its own table rather than a membership with a status: a
  // membership carries a userId, and the whole point is that there may not be
  // one. See PermInvitation.

  /**
   * Invites an address to join an organization.
   *
   * ## The token never comes back here
   *
   * It is minted, hashed, stored as the hash, and handed to the app's
   * `sendInvitationEmail` hook — once, inside this method. It is NOT returned,
   * so no caller and no GraphQL response ever holds a working invitation link.
   * That is the same shape `AuthPasswordReset` uses, and it is the reason the
   * hook is required rather than optional: a module with no way to deliver
   * could only either return a credential to a browser or write a row nobody
   * can accept.
   *
   * The refusal for a missing hook happens BEFORE the row is written. Failing
   * afterwards would leave a pending invitation that can never be used and
   * blocks the address from being invited again.
   *
   * ⚠ It does NOT check whether the address already belongs to a member, and
   * cannot: that means resolving an email to a userId, which reads `auth_user`
   * — a table this module may not import (§12.12). The screen checks it by
   * composing the app's lookup with the member list, and `acceptInvitation` is
   * idempotent for somebody already in, so the worst case is a wasted email.
   */
  async inviteMember(actor: PermissionContext, organizationId: string, draft: InvitationDraft) {
    // The members screen's entry point, kept because that is what it calls and
    // because an invitation to an organization is the common case. It is the
    // same write: one organization, no app-level role.
    return this.inviteUser(actor, { ...draft, organizationId });
  }

  /**
   * Invites an address — to an organization, to the PLATFORM, or to both.
   *
   * ## One method, because it is one row
   *
   * `PermInvitation.organizationId` is nullable and `appRoleId` is a column
   * beside it, so "join this tenant" and "hold this app-level role" are two
   * fields of one offer rather than two features. Splitting them into two
   * methods would have duplicated the token, the expiry, the delivery and the
   * revocation for a row differing in one column.
   *
   * ## The guards follow the FIELDS, not the method
   *
   * A static key on this method could only be the union of both, which would
   * mean a tenant administrator needed platform rights to invite a colleague.
   * So each part is checked when it is present:
   *
   *   an organization   `members:manage` — the existing rule, unchanged.
   *   an app-level role `roles:grant_app`, plus the same no-escalation check
   *                     `assignAppRole` makes. Without it, inviting an address
   *                     you own as `super-admin` would be a way to grant
   *                     yourself anything.
   *   neither           refused. An invitation to nothing is a link that grants
   *                     nothing and an email nobody can act on.
   */
  async inviteUser(actor: PermissionContext, draft: InvitationDraft) {
    const organizationId = draft.organizationId?.trim() || null;
    const appRoleId = draft.appRoleId?.trim() || null;

    if (organizationId) this.assertPermitted(actor, FEATURE.membersManage);
    if (appRoleId) this.assertPermitted(actor, FEATURE.rolesGrantApp);
    if (!organizationId && !appRoleId) {
      throw new PermissionWriteError('draft_invalid', 'An invitation must offer an organization or a role', {});
    }

    const send = this.options?.sendInvitationEmail;
    if (!send) {
      throw new PermissionWriteError(
        'not_configured',
        'Invitations are not configured: the host must supply sendInvitationEmail',
        {},
      );
    }
    const db = this.client();

    const created = await db.$transaction(async (tx) => {
      // Null for a platform invitation, and the mail hook is handed the null
      // rather than a placeholder — see `sendInvitationEmail`.
      const organization = organizationId ? await this.requireOrganization(tx, organizationId) : null;
      /*
       * Held from the validation below so the email can name the role without a
       * second read. `requireRole` has already refused a disabled one.
       */
      let appRoleRow: AssignableRole | null = null;

      /*
       * Scoped to THIS offer: the organization's pending invitations, or the
       * platform's. Two separate buckets, because a platform invitation and an
       * invitation to a tenant are different offers to the same person and
       * neither may block the other.
       */
      const pending = await tx.permInvitation.findMany({
        where: { organizationId, status: 'pending' },
        select: { email: true, status: true, expiresAt: true },
      });
      const errors = validateInvitationDraft(draft, {
        /*
         * Only the LIVE ones block a new invitation. An expired row still reads
         * `pending` in the column — expiry is derived, not written — so this
         * filters through the same `isAcceptable` the accept path uses.
         * Without it, one forgotten invitation would block an address forever.
         */
        pendingEmails: pending.filter((row) => isAcceptable(row, this.now())).map((row) => row.email),
      });
      assertNoDraftErrors(errors, 'draft_invalid');

      if (appRoleId) {
        /*
         * The same two checks `assignAppRole` makes, at the same strength.
         * They belong here as well as there because this is the OTHER way an
         * app-level role reaches somebody, and a guard on one path only is not
         * a guard.
         */
        appRoleRow = await this.requireRole(tx, appRoleId);
        if (appRoleRow.level !== 'app') {
          throw new PermissionWriteError('role_level_mismatch', 'That is not an app-level role', {
            roleId: appRoleId,
            level: appRoleRow.level,
          });
        }
        const carried = await tx.permRoleFeature.findMany({
          where: { roleId: appRoleId },
          select: { featureKey: true },
        });
        const held = new Set<string>(actor.effective);
        const beyond = carried.map((row) => row.featureKey).filter((key) => !held.has(key));
        if (beyond.length > 0) {
          throw new PermissionWriteError('not_permitted', 'That role carries rights you do not hold', {
            roleId: appRoleId,
            features: beyond.sort(),
          });
        }
      }

      if (draft.roleId) {
        const role = await this.requireRole(tx, draft.roleId);
        assertNotAppLevel(role);
        // The same check `assignRole` makes, made HERE rather than at
        // acceptance: an invitation naming a role that cannot be granted is one
        // that fails at the worst moment, in front of somebody who just signed
        // up and cannot do anything about it.
        // An organization role needs an organization, which the draft
        // validator also refuses — this is the write path's own check.
        if (!organizationId) {
          throw new PermissionWriteError('draft_invalid', 'An organization role needs an organization', {
            roleId: draft.roleId,
          });
        }
        assertRoleAssignable(role, { organizationId, level: 'organization' });
      }

      /*
       * 32 random bytes, hex — the same shape `TokenService.issueOpaque` mints.
       * Not a JWT: there is nothing to encode, the row IS the state, and a
       * signed token would be revocable only by keeping a list of revocations,
       * which is the row again.
       */
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(this.now().getTime() + INVITATION_TTL_MS);
      const invitation = await tx.permInvitation.create({
        data: {
          organizationId,
          appRoleId,
          email: normaliseInviteEmail(draft.email),
          roleId: draft.roleId || null,
          invitedByUserId: actor.subjectId,
          tokenHash: hashInvitationToken(token),
          expiresAt,
        },
        select: { id: true },
      });

      /*
       * The app role is re-read for its LABEL, which only the email needs. Two
       * columns rather than a join on the row above, because the create's
       * select is deliberately `{ id: true }` — an invitation row carries a
       * token hash, and the less of it that travels the better.
       */
      const appRole = appRoleRow ? { key: appRoleRow.key, label: appRoleRow.label } : null;

      return { invitationId: invitation.id, token, organization, appRole, expiresAt };
    });

    /*
     * Delivery is AFTER the commit, and awaited.
     *
     * After, because a hook that reaches an SMTP server inside a transaction
     * holds a database connection open for the length of a network round trip —
     * and a rollback cannot unsend an email anyway.
     *
     * Awaited, unlike `sendPasswordResetEmail`, because the reason that one is
     * fire-and-forget does not apply: this caller is an authenticated
     * administrator, so there is no account-enumeration oracle in the response
     * time, and there IS somebody on the other end who needs to know the email
     * did not go out.
     *
     * A failure is REPORTED, not rethrown. The invitation exists and is valid;
     * losing that fact to a mail outage would leave a live row the screen never
     * mentioned. `delivered: false` lets the screen say what actually happened
     * and offer to revoke.
     */
    let delivered = true;
    try {
      await send({
        email: normaliseInviteEmail(draft.email),
        token: created.token,
        organization: created.organization,
        appRole: created.appRole,
        invitedByUserId: actor.subjectId,
        expiresAt: created.expiresAt,
      });
    } catch {
      // Never the token, and never the error's message either: a mail library
      // reporting a failed send has been known to include the payload.
      delivered = false;
    }

    return { invitationId: created.invitationId, delivered };
  }

  /**
   * Withdraws an invitation. The row stays.
   *
   * A revoked invitation is the record of somebody having been asked and the
   * asking having been undone — "who let them in", and "who nearly did". A
   * delete answers both wrongly rather than not at all.
   *
   * There is no un-revoke: inviting again is a new invitation, with a new
   * token and a new expiry, which is what makes the second asking visible.
   */
  async revokeInvitation(actor: PermissionContext, organizationId: string, invitationId: string) {
    this.assertPermitted(actor, FEATURE.membersManage);
    const db = this.client();

    return db.$transaction(async (tx) => {
      const invitation = await tx.permInvitation.findFirst({
        where: { id: invitationId, organizationId },
        select: INVITATION_SELECT,
      });
      // Scoped by organizationId as well as id: nothing else stops one tenant
      // revoking another's invitation.
      if (!invitation) {
        throw new PermissionWriteError('not_found', 'No such invitation in this organization', { invitationId });
      }
      if (invitation.status !== 'pending') {
        throw new PermissionWriteError('already_exists', `That invitation is already ${invitation.status}`, {
          invitationId,
          status: invitation.status,
        });
      }

      await tx.permInvitation.update({
        where: { id: invitation.id },
        data: { status: 'revoked', revokedAt: this.now() },
        select: { id: true },
      });
      return { invitationId: invitation.id, revoked: true };
    });
  }

  /**
   * What an invitation SAYS, for whoever is holding the link.
   *
   * ## Unguarded, like `acceptInvitation`, and for the same reason
   *
   * The person reading it holds nothing — they may not have an account at all.
   * The token is the authorisation, and it is the only argument: this answers
   * for the bearer of one specific link and cannot be pointed at anything else.
   *
   * ## Why the accept page needs it
   *
   * Without it the page can only say "you have been invited somewhere". It has
   * to say WHICH organization, or somebody deciding whether to create an
   * account is deciding blind — and an invitation is the one email in this
   * system that is genuinely unsolicited.
   *
   * ## What it deliberately does not say
   *
   * Nothing about whether an account exists for the address. That is the app's
   * to answer, because only the app can read `auth_user` (§12.12) — and it is
   * the app that decides whether the page shows a sign-in or a sign-up.
   *
   * Returns null for anything not live — unknown, revoked, accepted, expired.
   * ONE answer for all four, exactly as `acceptInvitation` refuses with one
   * message: the difference is what somebody probing tokens wants, and the
   * person holding a stale link has to ask the sender either way.
   */
  async previewInvitation(token: string) {
    const db = this.client();
    const invitation = await db.permInvitation.findFirst({
      where: { tokenHash: hashInvitationToken(token) },
      select: INVITATION_SELECT,
    });
    if (!invitation || !isAcceptable(invitation, this.now())) return null;

    return {
      organizationId: invitation.organizationId,
      /**
       * Null for a PLATFORM invitation. The accept page renders the offer
       * differently rather than inventing a name — "join KWTech" when no
       * organization was named would be a claim nobody made.
       */
      organizationName: invitation.organization?.name ?? null,
      /** The address it was SENT to. The page shows it; it is not a claim about who is reading. */
      email: invitation.email,
      roleLabel: invitation.role?.label ?? null,
      /** What they will hold across the platform, for a page that should say so. */
      appRoleLabel: invitation.appRole?.label ?? null,
      expiresAt: invitation.expiresAt,
    };
  }

  /**
   * Accepts an invitation, making the bearer a member.
   *
   * ## NO ACTOR CHECK, and that is the design
   *
   * Every other write here takes a `PermissionContext` and checks a feature.
   * This one takes a userId and a token, because the person accepting holds
   * NOTHING yet — they are not in the organization, which is the entire point.
   * The token is the authorisation, and it is why the token is 32 random bytes
   * stored only as a hash.
   *
   * The caller must have established WHO the userId belongs to. In this app
   * that is the signed-in session, or the account just created through the
   * invitation itself.
   *
   * ## Whoever holds the link
   *
   * `acceptedByUserId` need not be the person the address was sent to: an email
   * address is a mailbox, and anybody who reads it can follow the link. That is
   * recorded rather than prevented — the row says who actually accepted, so a
   * surprise is visible afterwards. Preventing it would mean verifying the
   * accepting account's email against the invitation, which locks out the
   * ordinary case of somebody whose work address forwards to a personal one.
   */
  async acceptInvitation(input: { token: string; userId: string }) {
    const db = this.client();

    return db.$transaction(async (tx) => {
      const invitation = await tx.permInvitation.findFirst({
        where: { tokenHash: hashInvitationToken(input.token) },
        select: INVITATION_SELECT,
      });
      /*
       * ONE refusal for every failure — unknown token, revoked, already
       * accepted, expired. The difference between "no such invitation" and
       * "that one expired" is exactly what somebody probing tokens wants, and
       * the person legitimately holding a stale link needs to ask the sender
       * either way.
       */
      if (!invitation || !isAcceptable(invitation, this.now())) {
        throw new PermissionWriteError('not_found', 'That invitation is not valid', {});
      }

      /*
       * ── the APP-level role ────────────────────────────────────────────────
       *
       * Applied first, and usually to a user id that has existed for a few
       * milliseconds: the account is created by the app immediately before this
       * call (see the app's `signUpFromInvitation`). That is the whole mechanism
       * by which a role can be chosen for somebody who does not exist yet — it
       * rides on the invitation, addressed to an EMAIL, and lands the moment
       * there is an id to hang it on.
       *
       * ## It NEVER replaces a role somebody already holds
       *
       * It used to, whenever the invitation named one, on the reasoning that
       * replacing is what the inviter asked for. That reasoning is right for a
       * grant made on the Users page, where the administrator is looking at the
       * account and its current role. It is wrong here, because the inviter is
       * looking at an ADDRESS: they may not know it belongs to anybody, and the
       * platform invite form defaults to the least-privileged role — so an
       * invitation sent to an existing super admin would have demoted them the
       * moment they followed the link, silently, with one click.
       *
       * The invite screens refuse an address that already has an account, but
       * that check reads `auth_user` and is therefore the APP's; this module
       * cannot enforce it (§12.12). This can, so the guarantee stops being
       * advisory: an invitation may GIVE an app-level role, never change one.
       *
       * ## Why "holds none" rather than "the account is new"
       *
       * The literal rule is "only a user who did not exist yet gets a role from
       * an invitation", and this module cannot evaluate it — it may not read
       * `auth_user`, so it cannot know whether an id is a second old. It can
       * see what that id HOLDS, and a brand-new account holds nothing by
       * construction, so the two coincide. Where they differ — an old account
       * that never had an app role — filling the hole is the same act the
       * baseline default performs, and the same one that stops somebody landing
       * on a settings page they cannot use.
       *
       * Changing an existing person's app role is `assignAppRole`, from the
       * Users page, where it takes `roles:grant_app` and a deliberate choice.
       */
      const heldAppRoles = await tx.permUserRole.findMany({
        where: { userId: input.userId, role: { disabledAt: null } },
        include: { role: { include: { features: activeFeatures, limits: true } } },
      });

      if (!heldAppRoles.some((row) => row.role.level === 'app')) {
        // The invitation's choice, or the deployment's baseline — see
        // `grantDefaultAppRole` for why a default exists at all.
        const roleId = invitation.appRoleId ?? (await this.defaultAppRoleId(tx));
        if (roleId) await tx.permUserRole.create({ data: { userId: input.userId, roleId } });
      }

      /*
       * ── the membership, when there is an organization ────────────────────
       *
       * A PLATFORM invitation names none, and stops here: the person holds an
       * app-level role and belongs to no tenant, which `loadContext` is
       * explicitly built for ("a support engineer holding one has no membership
       * anywhere and must still get a usable context").
       */
      if (!invitation.organizationId) {
        await tx.permInvitation.update({
          where: { id: invitation.id },
          data: { status: 'accepted', acceptedAt: this.now(), acceptedByUserId: input.userId },
          select: { id: true },
        });
        return { organizationId: null, membershipId: null, joined: false };
      }

      const organizationId = invitation.organizationId;
      const existing = await tx.permMembership.findFirst({
        where: { userId: input.userId, organizationId },
        include: { roles: activeRoleGrants, workspaces: membershipWorkspaces(organizationId) },
      });

      let membershipId = existing?.id;
      if (!membershipId) {
        /*
         * The seat cap is NOT checked here, deliberately.
         *
         * `assertCapacity` reads the ACTOR's resolved limits, and there is no
         * actor — the person accepting holds nothing. Checking it against the
         * organization's plan would be right, and is a real gap: an invitation
         * sent when there was room can be accepted after there is not.
         * Recorded at docs/PLAN.md §12.35 rather than half-solved here, because
         * the honest fix is to check at INVITE time and again on accept, and
         * the second needs a limit lookup this method cannot reach.
         */
        const membership = await tx.permMembership.create({
          data: { userId: input.userId, organizationId, status: 'active' },
          select: { id: true },
        });
        membershipId = membership.id;
      }

      if (invitation.roleId) {
        // Replaces, like every other organization-role write: a member holds
        // one. An existing member accepting an invitation that names a role
        // therefore has their role CHANGED, which is what the inviter asked for.
        await tx.permMembershipRole.deleteMany({ where: { membershipId } });
        await tx.permMembershipRole.create({ data: { membershipId, roleId: invitation.roleId } });
      }

      await tx.permInvitation.update({
        where: { id: invitation.id },
        data: { status: 'accepted', acceptedAt: this.now(), acceptedByUserId: input.userId },
        select: { id: true },
      });

      return {
        organizationId,
        membershipId,
        // False when they were already in — the invitation still closes, but
        // nothing about their membership changed.
        joined: !existing,
      };
    });
  }

  // ── organization-level role grants ────────────────────────────────────────

  /**
   * SETS a member's organization-level role, replacing whatever they held.
   *
   * ## One role, not a collection
   *
   * A member holds AT MOST ONE organization-level role — enforced by the
   * `@@unique([membershipId])` on PermMembershipRole, so it is true of the
   * database rather than of this method. A person is one thing in an
   * organization: an owner, or an administrator, or a member. Wanting the
   * rights of two is a reason to define a THIRD role carrying both, which
   * `previewRoleClone` exists to make cheap — not a reason to stack two and
   * leave "what is this person" without an answer.
   *
   * So this REPLACES. Adding without clearing would hit the constraint on the
   * second grant, turning an ordinary re-role into an error somebody works
   * around by revoking first — two calls where the interface offers one, and a
   * window in between where the person holds nothing.
   *
   * Still idempotent: assigning the role they already hold reports
   * `granted: false` and writes nothing, because that leaves the world in the
   * state asked for.
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
      if (already) return { granted: false, replaced: false };

      /*
       * Clears any OTHER role first, in the same transaction. Without the
       * `roleId` filter this deletes whatever is there — which is the point:
       * the unique constraint permits exactly one row, so the old one has to go
       * before the new one can land.
       */
      const { count } = await tx.permMembershipRole.deleteMany({ where: { membershipId: membership.id } });

      await tx.permMembershipRole.create({ data: { membershipId: membership.id, roleId: input.roleId } });
      // `replaced` says whether somebody LOST a role in the process, which is a
      // different sentence for a screen than "granted".
      return { granted: true, replaced: count > 0 };
    });
  }

  /**
   * SETS a person's APP-LEVEL role, replacing whatever they held.
   *
   * ## The write `perm_user_role` never had
   *
   * The table was readable and nothing wrote it — the app-level grants in a
   * live database had been inserted by hand, which PLAN §12 open decision 37
   * recorded as a gap. Two surfaces need it: changing an account's app role
   * from the user administration screens, and choosing the one an invitation
   * will grant when it is accepted.
   *
   * ## One role, like every other level
   *
   * A person is one thing at app level, so this REPLACES. There is no
   * `@@unique([userId])` on the table to enforce it — the primary key is
   * `(userId, roleId)`, which permits a collection — so unlike the organization
   * rule this one is upheld by the write path rather than by the database.
   * PLAN §12 decision 32 left "may somebody hold two app roles" open on the
   * grounds that nothing needed it decided; this decides it, in the only
   * direction that matches the other two levels, and a schema constraint can
   * follow when there is a migration to carry it.
   *
   * ## The escalation check is the point of this method
   *
   * `roles:grant_app` says you may hand out app-level roles. It does not say
   * which, and without a second rule the key would be the whole ladder: anybody
   * holding it could grant `super-admin` — to somebody else, or by inviting an
   * address they own — and hold everything by proxy the next morning.
   *
   * So a role may only be granted if every feature it carries is one the
   * GRANTER already holds. That is the same rule `role-draft.ts` applies when
   * composing a role, stated here for handing one out, and it makes this method
   * unable to increase the total power in the system.
   */
  async assignAppRole(actor: PermissionContext, input: { userId: string; roleId: string }) {
    this.assertPermitted(actor, FEATURE.rolesGrantApp);
    const db = this.client();

    return db.$transaction(async (tx) => {
      const role = await this.requireRole(tx, input.roleId);

      if (role.level !== 'app') {
        throw new PermissionWriteError('role_level_mismatch', 'That is not an app-level role', {
          roleId: input.roleId,
          level: role.level,
        });
      }
      // A disabled role is already refused by `requireRole`, which explains
      // why: assigning one writes a row that grants nothing and then looks,
      // in every list, exactly like a grant that works.

      /*
       * Read from the ROW rather than from the registry: what the role grants
       * today is what the database says, and a registry lookup would compare
       * against the checkout instead.
       */
      const carried = await tx.permRoleFeature.findMany({
        where: { roleId: input.roleId },
        select: { featureKey: true },
      });
      const held = new Set<string>(actor.effective);
      const beyond = carried.map((row) => row.featureKey).filter((key) => !held.has(key));
      if (beyond.length > 0) {
        throw new PermissionWriteError('not_permitted', 'That role carries rights you do not hold', {
          roleId: input.roleId,
          // Named, because "you may not" without saying which right is a
          // refusal nobody can act on.
          features: beyond.sort(),
        });
      }

      const already = await tx.permUserRole.findMany({
        where: { userId: input.userId, role: { disabledAt: null } },
        include: { role: { include: { features: activeFeatures, limits: true } } },
      });
      // Compared by KEY: the port's read projects the role rather than its id,
      // and a key is unique per scope, so the two questions are the same one.
      if (already.length === 1 && already[0]?.role.key === role.key) {
        // Idempotent where it can be: re-granting what somebody already holds
        // is not an error, and making it one turns every retry into a ticket.
        return { granted: false, replaced: false };
      }

      const { count } = await tx.permUserRole.deleteMany({ where: { userId: input.userId } });
      await tx.permUserRole.create({ data: { userId: input.userId, roleId: input.roleId } });
      // `replaced` says whether somebody LOST a role in the process, which is a
      // different sentence for a screen than "granted".
      return { granted: true, replaced: count > 0 };
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
      await this.requireOrganization(tx, input.organizationId);
      await this.assertCapacity(tx, actor, LIMIT.organizationWorkspaces, { organizationId: input.organizationId });

      const workspace = await tx.permWorkspace.create({
        data: { organizationId: input.organizationId, key: input.key, name: input.name },
        select: { id: true },
      });
      return { workspaceId: workspace.id };
    });
  }

  /**
   * Renames a workspace, or changes its key.
   *
   * `workspaces:manage` has described itself as "Create, rename and archive"
   * since it was written, and rename was the third of those with nothing behind
   * it. This is that.
   *
   * The KEY is changeable, which a role's and a plan's are not — and the
   * difference is not inconsistency. Those are referenced BY key: a plan key is
   * the primary key that every subscription points at. A workspace is addressed
   * by `id` everywhere, and its key exists for humans reading a URL, so
   * changing one breaks nothing.
   *
   * Scoped by `organizationId` as well as `id`. Nothing else stops a caller
   * renaming another tenant's workspace — the id alone is a unique `where`, and
   * a unique `where` cannot carry a tenant check.
   */
  async updateWorkspace(
    actor: PermissionContext,
    input: { organizationId: string; workspaceId: string; key: string; name: string },
  ) {
    this.assertPermitted(actor, FEATURE.workspacesManage);
    const db = this.client();

    const key = input.key.trim();
    const name = input.name.trim();
    if (!key || !name) {
      throw new PermissionWriteError('draft_invalid', 'A workspace needs a key and a name', {
        workspaceId: input.workspaceId,
      });
    }

    const { count } = await db.permWorkspace.updateMany({
      where: { id: input.workspaceId, organizationId: input.organizationId },
      data: { key, name },
    });
    if (count === 0) {
      throw new PermissionWriteError('not_found', 'No such workspace in this organization', {
        workspaceId: input.workspaceId,
        organizationId: input.organizationId,
      });
    }
    return { workspaceId: input.workspaceId, renamed: true };
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
   * SETS a workspace member's role, replacing whatever they held.
   *
   * The same rule as `assignRole` one level up, enforced the same way — by
   * `@@unique([workspaceMemberId])` on PermWorkspaceMemberRole rather than by
   * this method. A person is one thing in a workspace, and wanting the features
   * of two roles is a reason to define a role carrying both, or to add the
   * feature to the role they already hold.
   *
   * Workspace membership is required FIRST, and that order is structural rather
   * than checked: the grant hangs off PermWorkspaceMember, so there is nowhere
   * to put a role for someone who is not in the workspace. Hence the explicit
   * not_found rather than an implicit insert of both.
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
      if (already) return { granted: false, replaced: false };

      /*
       * Clears any OTHER role first, in the same transaction — see the note
       * above. Without the `roleId` filter this deletes whatever is there,
       * which is the point: the unique constraint permits exactly one row.
       */
      const { count } = await tx.permWorkspaceMemberRole.deleteMany({ where: { workspaceMemberId } });

      await tx.permWorkspaceMemberRole.create({ data: { workspaceMemberId, roleId: input.roleId } });
      return { granted: true, replaced: count > 0 };
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

  /** Every plan key already taken. A plan key is the primary key, so this is global. */
  private async planKeys(tx: PermissionsTransaction): Promise<string[]> {
    const rows = await tx.permPlan.findMany({
      include: {
        // Only the keys are read here, but the shape has to match the interface
        // — which now filters deprecation, so a retired key never reaches an
        // editor that would refuse to save it.
        features: { where: { feature: { deprecatedAt: null } }, select: { featureKey: true } },
        limits: { select: { limitKey: true, value: true } },
      },
      orderBy: { key: 'asc' },
    });
    return rows.map((row) => row.key);
  }

  /**
   * The plan exists.
   *
   * There is no `isSystem` counterpart to `requireWritableRole`, and that stays
   * true now that an app CAN seed a starting catalogue: `createPlanIfAbsent`
   * creates what is missing and never rewrites what is there, so a seeded plan
   * is an ordinary row from the moment it exists. Every plan is the operator's
   * to change — which is the whole point of the screens, and the reason plans
   * are not re-asserted on deploy the way system roles are.
   */
  private async requirePlan(tx: PermissionsTransaction, planKey: string) {
    const plan = await tx.permPlan.findFirst({
      where: { key: planKey },
      select: { key: true, label: true, isPublic: true, icon: true, archivedAt: true },
    });
    if (!plan) throw new PermissionWriteError('not_found', 'No such plan', { planKey });
    return plan;
  }

  /** A subscription that exists and has not been ended. See `updateSubscription`. */
  private async requireLiveSubscription(tx: PermissionsTransaction, subscriptionId: string) {
    const subscription = await tx.permSubscription.findFirst({
      where: { id: subscriptionId, endedAt: null },
      select: { id: true, organizationId: true, workspaceId: true, planKey: true, status: true, endedAt: true },
    });
    if (!subscription) {
      throw new PermissionWriteError('not_found', 'No such subscription, or it has already ended', {
        subscriptionId,
      });
    }
    return subscription;
  }

  /**
   * REPLACES the feature list rather than merging into it — the same rule
   * `replaceRoleFeatures` follows, and for the same reason: the list the caller
   * sends is the whole truth about the plan, so a key removed in the form is
   * actually un-sold instead of lingering because nothing deleted it.
   */
  private async replacePlanFeatures(tx: PermissionsTransaction, planKey: string, features: readonly FeatureKey[]) {
    const keep = [...new Set(features)];
    await tx.permPlanFeature.deleteMany({ where: { planKey, featureKey: { notIn: keep } } });
    if (keep.length > 0) {
      await tx.permPlanFeature.createMany({
        data: keep.map((featureKey) => ({ planKey, featureKey })),
        skipDuplicates: true,
      });
    }
  }

  /**
   * Replaces the caps, and UPSERTS rather than recreating them.
   *
   * The difference from the features beside it is not stylistic: a feature row
   * is (planKey, featureKey) and carries nothing else, so deleting and
   * re-inserting is a no-op on the data. A limit row carries a VALUE, and
   * delete-then-insert would briefly leave a live plan with no seat cap at all
   * — inside a transaction, but visible to anything reading at a lower
   * isolation level.
   */
  private async replacePlanLimits(
    tx: PermissionsTransaction,
    planKey: string,
    limits: Readonly<Record<string, number>>,
  ) {
    const keys = Object.keys(limits);
    await tx.permPlanLimit.deleteMany({ where: { planKey, limitKey: { notIn: keys } } });
    for (const [limitKey, value] of Object.entries(limits)) {
      await tx.permPlanLimit.upsert({
        where: { planKey_limitKey: { planKey, limitKey } },
        create: { planKey, limitKey, value },
        update: { value },
      });
    }
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

  /**
   * The id of the configured baseline app-level role, or null.
   *
   * ## Why a baseline exists
   *
   * The model is additive, so there is no default-on: an account with no
   * app-level role holds NOTHING — the seeded organization roles carry no
   * features either — and lands on a settings page whose Save button is hidden.
   * That happened to a real account created by an organization invitation, which
   * is what put `defaultAppRoleKey` in the options. See the option for why it is
   * configuration rather than an argument.
   *
   * ## A missing or disabled default is not an error
   *
   * It is a deployment that has not configured one, or has retired the role
   * since. Null comes back and the acceptance still succeeds — refusing to let
   * somebody join because a baseline role was renamed would be the worse
   * failure, and they arrive with no app role, which is the state that existed
   * before the option did.
   *
   * The caller decides WHETHER to grant; this only answers what.
   */
  private async defaultAppRoleId(tx: PermissionsTransaction): Promise<string | null> {
    const key = this.options?.defaultAppRoleKey;
    if (!key) return null;

    const role = await tx.permRole.findFirst({
      where: { key, level: 'app', organizationId: null, disabledAt: null },
      select: { id: true, key: true, level: true, label: true, organizationId: true, isSystem: true, disabledAt: true },
    });
    return role?.id ?? null;
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
        workspaces: membershipWorkspaces(organizationId),
      },
    });
    if (!membership) {
      throw new PermissionWriteError('not_found', 'No such member in this organization', { userId, organizationId });
    }
    return membership;
  }

  /**
   * The organization exists.
   *
   * Checked before any insert that carries `organizationId`, because the
   * DATABASE would otherwise be the one to refuse — as a foreign-key violation
   * naming a constraint, through a stack trace, in a message written for whoever
   * wrote Prisma rather than for whoever typed the id. Every other refusal in
   * this service is a `PermissionWriteError` with a sentence a caller can act
   * on, and a bad tenant id has no business being the exception.
   *
   * It is not a substitute for the constraint. The row could be deleted between
   * this read and the insert; the foreign key is what makes that impossible to
   * get wrong, and this is what makes the common case explicable.
   */
  private async requireOrganization(tx: PermissionsTransaction, organizationId: string) {
    const organization = await tx.permOrganization.findFirst({
      where: { id: organizationId },
      // Name and key as well as id: an invitation email says which organization
      // somebody is being asked to join, and a second query for two columns
      // this one already had in hand would be a query for nothing.
      select: { id: true, key: true, name: true },
    });
    if (!organization) {
      throw new PermissionWriteError('not_found', 'No such organization', { organizationId });
    }
    return organization;
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
      select: { id: true, key: true, level: true, label: true, organizationId: true, isSystem: true, disabledAt: true },
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
    return { key: role.key, label: role.label, level: toRoleLevel(role.level), organizationId: role.organizationId };
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

/**
 * The workspace ids a membership read may return: THIS organization's, live
 * only.
 *
 * A function rather than a constant because the filter names the organization,
 * and one shared object would have to be rebuilt per call anyway. Written once
 * so the two membership reads here cannot drift from the one in
 * `PermissionsService` — the leak it closes is described on the client
 * interface, and nothing in the schema prevents it.
 */
function membershipWorkspaces(organizationId: string) {
  return { where: { workspace: { organizationId, archivedAt: null } }, select: { workspaceId: true } } as const;
}

/**
 * The invitation token, as it is stored.
 *
 * SHA-256, the same one-way shape `TokenService.hashOpaque` uses for a refresh
 * token and a password reset. No salt and no work factor, and deliberately: the
 * input is 32 bytes of CSPRNG output, so there is no dictionary to attack and
 * nothing a slow hash would buy. That reasoning does NOT transfer to passwords,
 * which is why they use scrypt.
 */
/**
 * What every invitation read asks for. ONE object, because the structural
 * client declares one signature — see the note on `permInvitation.findFirst`.
 *
 * `as const` matters: without it these are `boolean`, and the delegate's
 * argument type wants the literal `true`.
 */
const INVITATION_SELECT = {
  id: true,
  organizationId: true,
  email: true,
  roleId: true,
  appRoleId: true,
  status: true,
  expiresAt: true,
  // NULLABLE now: a platform invitation names no organization, so every reader
  // of this select has to cope with the absence rather than assume a name.
  organization: { select: { key: true, name: true } },
  role: { select: { label: true } },
  appRole: { select: { label: true } },
} as const;

function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
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
function assertNoDraftErrors(
  errors: Record<string, string | undefined>,
  /*
   * Roles keep `role_features_invalid`, which names the specific rule their
   * validator is mostly enforcing and which callers already match on. Plans and
   * subscriptions get the general reason: a blank plan label reporting itself
   * as a role feature problem would send a reader looking in the wrong table.
   */
  reason: WriteRefusalReason = 'role_features_invalid',
): void {
  const problems = Object.entries(errors)
    .filter(([, message]) => message)
    .map(([field, message]) => `${field}: ${message}`);
  if (problems.length > 0) {
    throw new PermissionWriteError(reason, problems.join('; '), {});
  }
}
