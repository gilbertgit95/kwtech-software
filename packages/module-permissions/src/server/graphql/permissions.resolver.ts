import { Inject, Optional } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver, Subscription } from '@nestjs/graphql';
import { filterFeatures } from '../../domain/feature-filter.js';
import { paginate } from '../../domain/pagination.js';
import { FEATURE, FEATURE_REGISTRY } from '../../feature-keys.js';
import type { PermissionContext } from '../../types.js';
import type { PermissionsModuleOptions } from '../permissions.module.js';
// The VALUE comes from the leaf module; the interface is type-only and erased,
// so importing it from permissions.module.js closes no cycle at runtime.
import { NULL_PUBSUB, PERMISSIONS_EVENT, PERMISSIONS_PUBSUB, type PermissionsPubSub } from '../permissions.pubsub.js';
import { PermissionsService } from '../permissions.service.js';
import { PERMISSIONS_OPTIONS } from '../permissions.tokens.js';
import { PermissionsWriteService } from '../permissions-write.service.js';
import { RequireFeature } from '../require-feature.decorator.js';
import {
  FeatureFilterInput,
  PaginationArgs,
  PermissionContextType,
  PermissionFeaturePageType,
  PermissionInvitationResultType,
  PermissionMemberType,
  PermissionOrganizationDetailType,
  PermissionOrganizationType,
  PermissionPlanChangedType,
  PermissionPlanDetailType,
  PermissionRoleDetailType,
  PermissionSubscriptionType,
  PermissionWriteResultType,
  PlanClonePreviewType,
  PlanDraftInput,
  RoleClonePreviewType,
  RoleDraftInput,
  SubscriptionDraftInput,
  toPermissionContextType,
  UserAppRoleType,
  UserOrganizationType,
} from './permission.types.js';

/**
 * Registering this resolver in the host app's GraphQLModule is all it takes to
 * get the module's queries into the composed schema — code-first means the app
 * writes no SDL and stitches nothing. `PermissionsModule.forRoot()` lists it as
 * a provider whenever `expose.graphql` is on, so an app that mounts the module
 * and a GraphQLModule has these queries with no further wiring.
 *
 * `myPermissions` is what the React layer's provider calls on load, so the two
 * halves of the module talk to each other and the app just mounts them.
 */
@Resolver()
export class PermissionsResolver {
  constructor(
    @Inject(PERMISSIONS_OPTIONS) private readonly options: PermissionsModuleOptions,
    private readonly permissions: PermissionsService,
    private readonly writes: PermissionsWriteService,
    /** Absent for a host that mounts the module without subscriptions. See NULL_PUBSUB. */
    @Optional() @Inject(PERMISSIONS_PUBSUB) private readonly pubsub?: PermissionsPubSub,
  ) {}

  /**
   * The full registry, for the role editor.
   *
   * GUARDED, and it was not. "Static data — no subject involved" was true of the
   * VALUE and wrong about the question: the whole vocabulary is a map of what
   * this platform can grant, and it was readable by anyone with a session while
   * the UI hid the page from anyone without `features:read`. The interface said
   * one thing and the API said another, which is the arrangement where the API
   * wins.
   *
   * The same key as the REST endpoint below it and as the `/admin/features`
   * route. One key, three surfaces — which is what the registry's bindings
   * claim, and now what is true.
   */
  /*
   * PAGED, and bounded by the server rather than by the caller's manners. The
   * registry is fourteen keys today and this list is the one that grows with
   * every module adopted — an endpoint that returns "all of them" is fine until
   * the day it is not, and that day arrives without a deploy.
   *
   * `limit` may only ever narrow: it is clamped to MAX_PAGE_SIZE, which equals
   * the largest page the UI offers, so nothing can ask the API for more than a
   * person could have asked for through the interface.
   */
  @RequireFeature(FEATURE.featuresRead)
  @Query(() => PermissionFeaturePageType, { name: 'permissionFeatures' })
  features(
    @Args() args: PaginationArgs,
    @Args('filter', { type: () => FeatureFilterInput, nullable: true }) filter?: FeatureFilterInput,
  ): PermissionFeaturePageType {
    /*
     * FILTER FIRST, then page. The other order pages the whole registry and
     * then narrows what came back, so `total` would count rows the caller never
     * asked about and page two would be missing rows page one filtered out.
     */
    // EVERY module's registry, not just this module's — see the note on
    // `featureRegistry`. Serving only our own would make the role editor's
    // list disagree with what the write path accepts.
    const page = paginate(filterFeatures(this.registry, filter ?? {}), args);

    return {
      ...page,
      items: page.items.map((spec) => ({
        key: spec.key,
        module: spec.module,
        label: spec.label,
        description: spec.description,
        isPrivileged: spec.isPrivileged ?? false,
        // Registry-only, both of them: `perm_feature` mirrors neither, so this
        // query is the client's only source for the level it filters on and
        // the tag path it groups by.
        level: spec.level,
        tags: [...(spec.tags ?? [])],
      })),
    };
  }

  /**
   * The caller's own grants.
   *
   * **Nullable, and null means "not signed in"** rather than an error. This is
   * the query a page calls on load to decide what to render; a signed-out
   * visitor asking it is an ordinary state, not a fault, and throwing would make
   * every shell render a try/catch. The web adapter's `null` already fails
   * closed — it means "holds nothing", never "skip the filter".
   *
   * Resolves through the SAME hooks the guard uses — `resolveContext` if the app
   * supplies one, otherwise `resolvePrincipal` plus a `loadContext`. Two paths
   * to a permission context would be two places for them to disagree, and the
   * one that drifts is always the one without a guard behind it.
   */

  // ── roles ─────────────────────────────────────────────────────────────────
  //
  // Every mutation below re-resolves the ACTOR through the same hooks the guard
  // uses and hands it to the write service, which checks the right again. That
  // duplication is deliberate: `PermissionsWriteService` is reachable from a
  // worker and a CLI with no guard in front of it, so "the caller checked" is
  // not something the write path can verify. The guard is the fast refusal; the
  // service is the one that must be true.

  /**
   * The roles defined in a scope. Includes DISABLED ones — see `listRoles`.
   */
  @RequireFeature(FEATURE.rolesRead)
  @Query(() => [PermissionRoleDetailType], { name: 'permissionRoles' })
  async roles(
    @Args('organizationId', { type: () => String, nullable: true }) organizationId?: string | null,
  ): Promise<PermissionRoleDetailType[]> {
    return this.permissions.listRoles(organizationId ?? null);
  }

  /**
   * The APP-level role each of these people holds.
   *
   * ## Why `roles:read` and not something stronger
   *
   * The ids come from a list the caller was already allowed to see, so this
   * discloses nothing new about WHO exists — it answers "what does this person
   * hold" for people the caller can already name. The same argument the app's
   * `findUsersByIds` makes for batching.
   *
   * Deliberately not `roles:grant_app`: seeing that somebody is a super admin
   * is what a support engineer needs to answer "why can they do that", and it
   * is not the same right as being able to change it.
   */
  @RequireFeature(FEATURE.rolesRead)
  @Query(() => [UserAppRoleType], { name: 'permissionUserAppRoles' })
  async userAppRoles(@Args('userIds', { type: () => [String] }) userIds: string[]): Promise<UserAppRoleType[]> {
    return this.permissions.listAppRolesForUsers(userIds);
  }

  /**
   * Which organizations these people belong to, and as what.
   *
   * `organizations:read`, not `users:read` or `roles:read`: this discloses
   * TENANT membership — who is inside which customer — which is the same fact
   * the organization list and detail screens are guarded on. Somebody who may
   * administer accounts has not thereby been told which companies each person
   * works for.
   *
   * The ids come from a list the caller could already see, so batching
   * discloses nothing new about who exists.
   */
  @RequireFeature(FEATURE.organizationsRead)
  @Query(() => [UserOrganizationType], { name: 'permissionUserOrganizations' })
  async userOrganizations(
    @Args('userIds', { type: () => [String] }) userIds: string[],
  ): Promise<UserOrganizationType[]> {
    return this.permissions.listOrganizationsForUsers(userIds);
  }

  @RequireFeature(FEATURE.rolesCreate)
  @Mutation(() => PermissionRoleDetailType, { name: 'createRole' })
  async createRole(
    @Context() gqlContext: { req?: unknown },
    @Args('input') input: RoleDraftInput,
  ): Promise<PermissionRoleDetailType> {
    const actor = await this.requireActor(gqlContext.req);
    const { roleId } = await this.writes.createRole(actor, toDraft(input));
    // Shared presets live in the null scope; that is the only one a write here
    // can produce. See domain/role-draft.ts.
    return this.requireRoleView(roleId, null);
  }

  @RequireFeature(FEATURE.rolesUpdate)
  @Mutation(() => PermissionRoleDetailType, { name: 'updateRole' })
  async updateRole(
    @Context() gqlContext: { req?: unknown },
    @Args('roleId') roleId: string,
    @Args('input') input: RoleDraftInput,
  ): Promise<PermissionRoleDetailType> {
    const actor = await this.requireActor(gqlContext.req);
    await this.writes.updateRole(actor, roleId, toDraft(input));
    return this.requireRoleView(roleId, null);
  }

  /**
   * Turns a role off or back on. There is no delete — see `roles:disable`.
   */
  @RequireFeature(FEATURE.rolesDisable)
  @Mutation(() => PermissionRoleDetailType, { name: 'setRoleDisabled' })
  async setRoleDisabled(
    @Context() gqlContext: { req?: unknown },
    @Args('roleId') roleId: string,
    @Args('disabled') disabled: boolean,
    @Args('organizationId', { type: () => String, nullable: true }) organizationId?: string | null,
  ): Promise<PermissionRoleDetailType> {
    const actor = await this.requireActor(gqlContext.req);
    await this.writes.setRoleDisabled(actor, roleId, disabled);
    return this.requireRoleView(roleId, organizationId ?? null);
  }

  /**
   * What cloning one role into another would produce — WITHOUT writing it.
   *
   * A query in everything but name, and a mutation in the schema because it is
   * not one: it needs the actor's own grants to decide what may cross over, and
   * it is asked in response to a button. Nothing is persisted; the answer is
   * staged into the form and saved through `updateRole` like any manual edit,
   * so a clone cannot reach a rule a hand edit obeys.
   */
  @RequireFeature(FEATURE.rolesUpdate)
  @Mutation(() => RoleClonePreviewType, { name: 'previewRoleClone' })
  async previewRoleClone(
    @Context() gqlContext: { req?: unknown },
    @Args('sourceRoleId') sourceRoleId: string,
    @Args('level') level: string,
    @Args('mode') mode: string,
    @Args('current', { type: () => [String] }) current: string[],
  ): Promise<RoleClonePreviewType> {
    const actor = await this.requireActor(gqlContext.req);
    const result = await this.writes.previewRoleClone(actor, {
      sourceRoleId,
      current,
      level,
      mode: mode === 'replace' ? 'replace' : 'add',
    });
    return { features: result.features, added: result.added, skipped: result.skipped };
  }

  // ── organizations, members and workspaces ─────────────────────────────────
  //
  // Eleven mutations that expose a write service which has been built, tested
  // and unreachable since it was written. Nothing below is new logic: every one
  // re-reads its target inside the transaction, checks the actor again, and
  // refuses a cross-tenant row — see `PermissionsWriteService`.
  //
  // They are guarded by keys that already existed and had no binding:
  // `members:manage`, `workspaces:manage`, `workspaces:share`. Declaring the
  // bindings is what turns three registry entries from claims into checks.

  /**
   * One organization, with its people and workspaces.
   *
   * `organizations:read` is APP level: this reads across tenants, so it is a
   * platform view. A tenant administrator reading their OWN organization is a
   * different question and needs the active-organization scope that PLAN
   * §12.13 still defers.
   *
   * Returns members as opaque `userId`s. Resolving those to names is the app's
   * job — this module does not own identity.
   */
  @RequireFeature(FEATURE.organizationsRead)
  @Query(() => PermissionOrganizationDetailType, { name: 'permissionOrganizationDetail', nullable: true })
  async organizationDetail(
    @Args('organizationId') organizationId: string,
  ): Promise<PermissionOrganizationDetailType | null> {
    const found = await this.permissions.listOrganizationDetail(organizationId);
    if (!found) return null;

    return {
      ...found,
      // Dates become ISO STRINGS at this boundary, like every other timestamp
      // the schema carries — there is no Date scalar, and adding one for
      // values the client only renders would be a custom scalar for no gain.
      invitations: found.invitations.map((invitation) => ({
        ...invitation,
        expiresAt: invitation.expiresAt.toISOString(),
        createdAt: invitation.createdAt.toISOString(),
        acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
        revokedAt: invitation.revokedAt?.toISOString() ?? null,
      })),
      members: found.members.map(
        (member): PermissionMemberType => ({
          ...member,
          // ISO at the boundary: the schema has no Date scalar, and adding one
          // for a timestamp the client only renders would be a custom scalar in
          // the public contract for no gain.
          joinedAt: member.joinedAt.toISOString(),
        }),
      ),
    };
  }

  /**
   * Invites an address to join an organization.
   *
   * The token does not come back — it goes to the host's `sendInvitationEmail`
   * hook and nowhere else, which is why this response can be logged like any
   * other. The module has no email transport and should not acquire one; the
   * hook is the same arrangement `sendPasswordResetEmail` uses in module-auth.
   */
  @RequireFeature(FEATURE.membersManage)
  @Mutation(() => PermissionInvitationResultType, { name: 'inviteMember' })
  async inviteMember(
    @Context() gqlContext: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('email') email: string,
    @Args('roleId', { type: () => String, nullable: true }) roleId?: string | null,
  ): Promise<PermissionInvitationResultType> {
    const actor = await this.requireActor(gqlContext.req);
    const result = await this.writes.inviteMember(actor, organizationId, { email, roleId: roleId ?? '' });
    return { invitationId: result.invitationId, delivered: result.delivered };
  }

  /**
   * Invites an address to the PLATFORM — an app-level role, and no tenant.
   *
   * ## Two mutations, because they are two offers
   *
   * `inviteMember` above invites into an ORGANIZATION and takes
   * `members:manage`; that is the tenant flow and nothing about it changed.
   * This one grants a platform role and names no organization at all, which is
   * why it takes `roles:grant_app` — a key a tenant administrator must not need
   * in order to invite a colleague.
   *
   * It deliberately does NOT accept an organization, even though the write
   * beneath it can carry one. Adding somebody to a tenant is that tenant's
   * screen, next to its member list and its own invitations; an "organization"
   * dropdown on the platform screen would be a second way to do it, in a place
   * with none of that context.
   */
  @RequireFeature(FEATURE.rolesGrantApp)
  @Mutation(() => PermissionInvitationResultType, { name: 'inviteUser' })
  async inviteUser(
    @Context() gqlContext: { req?: unknown },
    @Args('email') email: string,
    @Args('appRoleId') appRoleId: string,
  ): Promise<PermissionInvitationResultType> {
    const actor = await this.requireActor(gqlContext.req);
    const result = await this.writes.inviteUser(actor, { email, appRoleId, roleId: '' });
    return { invitationId: result.invitationId, delivered: result.delivered };
  }

  /** Withdraws an invitation. The row stays — see `revokeInvitation`. */
  @RequireFeature(FEATURE.membersManage)
  @Mutation(() => PermissionWriteResultType, { name: 'revokeInvitation' })
  async revokeInvitation(
    @Context() gqlContext: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('invitationId') invitationId: string,
  ): Promise<PermissionWriteResultType> {
    const actor = await this.requireActor(gqlContext.req);
    await this.writes.revokeInvitation(actor, organizationId, invitationId);
    return { changed: true, id: invitationId, replaced: false };
  }

  /**
   * Accepts an invitation for the CALLER.
   *
   * ⚠ NOT `@RequireFeature`, and that is the design rather than an omission:
   * the person accepting holds nothing in the organization — that is the whole
   * point — so there is no feature to require. The TOKEN is the authorisation.
   *
   * It still requires a signed-in caller. `requireActor` resolves the session,
   * and the userId that becomes a member is the session's, never one supplied
   * in an argument: accepting on somebody else's behalf would be a way to put
   * arbitrary accounts into an organization by knowing one token.
   */
  @Mutation(() => PermissionWriteResultType, { name: 'acceptInvitation' })
  async acceptInvitation(
    @Context() gqlContext: { req?: unknown },
    @Args('token') token: string,
  ): Promise<PermissionWriteResultType> {
    const actor = await this.requireActor(gqlContext.req);
    const result = await this.writes.acceptInvitation({ token, userId: actor.subjectId });
    return { changed: result.joined, id: result.organizationId, replaced: false };
  }

  /**
   * Creates an organization and makes the caller its first member.
   *
   * ⚠ DELIBERATELY UNGUARDED by a feature, and that is the model rather than an
   * omission: creating an organization is not a right an organization grants —
   * there is no organization yet to grant it. It is bounded by the
   * `user:organizations` LIMIT from the caller's app-level role, which is why
   * that cap is role-sourced and resolves even at app level.
   *
   * The practical consequence, worth knowing: any signed-in person may create
   * organizations up to their cap. `normal-user` allows five.
   */
  @Mutation(() => PermissionWriteResultType, { name: 'createOrganization' })
  async createOrganization(
    @Context() gqlContext: { req?: unknown },
    @Args('key') key: string,
    @Args('name') name: string,
  ): Promise<PermissionWriteResultType> {
    const actor = await this.requireActor(gqlContext.req);
    const { organizationId } = await this.writes.createOrganization(actor, { key, name });
    return { changed: true, id: organizationId, replaced: false };
  }

  /**
   * Renames an organization.
   *
   * Guarded, unlike `createOrganization` above — and the asymmetry is the model
   * rather than an oversight. Creating one is bounded by a LIMIT because there
   * is no organization yet to grant the right; renaming an EXISTING one is a
   * right something can grant, so it has a key.
   */
  @RequireFeature(FEATURE.organizationsManage)
  @Mutation(() => PermissionWriteResultType, { name: 'updateOrganization' })
  async updateOrganization(
    @Context() gqlContext: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('key') key: string,
    @Args('name') name: string,
  ): Promise<PermissionWriteResultType> {
    const actor = await this.requireActor(gqlContext.req);
    await this.writes.updateOrganization(actor, { organizationId, key, name });
    return { changed: true, id: organizationId, replaced: false };
  }

  @RequireFeature(FEATURE.membersManage)
  @Mutation(() => PermissionWriteResultType, { name: 'addMember' })
  async addMember(
    @Context() gqlContext: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('userId') userId: string,
  ): Promise<PermissionWriteResultType> {
    const actor = await this.requireActor(gqlContext.req);
    const { membershipId } = await this.writes.addMember(actor, { organizationId, userId });
    return { changed: true, id: membershipId, replaced: false };
  }

  @RequireFeature(FEATURE.membersManage)
  @Mutation(() => PermissionWriteResultType, { name: 'removeMember' })
  async removeMember(
    @Context() gqlContext: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('userId') userId: string,
  ): Promise<PermissionWriteResultType> {
    const actor = await this.requireActor(gqlContext.req);
    const { removed } = await this.writes.removeMember(actor, { organizationId, userId });
    return { changed: removed > 0, id: null, replaced: false };
  }

  /**
   * Grants an ORGANIZATION-level role to a member.
   *
   * Idempotent: re-granting a role somebody already holds returns
   * `changed: false` rather than failing, because it leaves the world in the
   * state asked for and making it an error turns every retry into a ticket.
   */
  @RequireFeature(FEATURE.membersManage)
  @Mutation(() => PermissionWriteResultType, { name: 'assignRole' })
  async assignRole(
    @Context() gqlContext: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('userId') userId: string,
    @Args('roleId') roleId: string,
  ): Promise<PermissionWriteResultType> {
    const actor = await this.requireActor(gqlContext.req);
    const { granted, replaced } = await this.writes.assignRole(actor, { organizationId, userId, roleId });
    return { changed: granted, id: roleId, replaced };
  }

  /**
   * Sets a person's APP-LEVEL role, replacing whatever they held.
   *
   * No organization argument, and that absence is the whole difference from
   * `assignRole` above: an app-level role applies everywhere and belongs to no
   * tenant, which is exactly why it takes a key of its own rather than
   * `members:manage` — a tenant administrator must not be able to mint platform
   * staff.
   *
   * The service refuses any role carrying features the caller does not hold, so
   * this cannot be used to grant more than the granter has.
   */
  @RequireFeature(FEATURE.rolesGrantApp)
  @Mutation(() => PermissionWriteResultType, { name: 'assignAppRole' })
  async assignAppRole(
    @Context() gqlContext: { req?: unknown },
    @Args('userId') userId: string,
    @Args('roleId') roleId: string,
  ): Promise<PermissionWriteResultType> {
    const actor = await this.requireActor(gqlContext.req);
    const { granted, replaced } = await this.writes.assignAppRole(actor, { userId, roleId });
    return { changed: granted, id: roleId, replaced };
  }

  @RequireFeature(FEATURE.membersManage)
  @Mutation(() => PermissionWriteResultType, { name: 'revokeRole' })
  async revokeRole(
    @Context() gqlContext: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('userId') userId: string,
    @Args('roleId') roleId: string,
  ): Promise<PermissionWriteResultType> {
    const actor = await this.requireActor(gqlContext.req);
    const { revoked } = await this.writes.revokeRole(actor, { organizationId, userId, roleId });
    return { changed: revoked, id: roleId, replaced: false };
  }

  @RequireFeature(FEATURE.workspacesManage)
  @Mutation(() => PermissionWriteResultType, { name: 'createWorkspace' })
  async createWorkspace(
    @Context() gqlContext: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('key') key: string,
    @Args('name') name: string,
  ): Promise<PermissionWriteResultType> {
    const actor = await this.requireActor(gqlContext.req);
    const { workspaceId } = await this.writes.createWorkspace(actor, { organizationId, key, name });
    return { changed: true, id: workspaceId, replaced: false };
  }

  /** Renames a workspace, or changes its key. See `updateWorkspace`. */
  @RequireFeature(FEATURE.workspacesManage)
  @Mutation(() => PermissionWriteResultType, { name: 'updateWorkspace' })
  async updateWorkspace(
    @Context() gqlContext: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('key') key: string,
    @Args('name') name: string,
  ): Promise<PermissionWriteResultType> {
    const actor = await this.requireActor(gqlContext.req);
    await this.writes.updateWorkspace(actor, { organizationId, workspaceId, key, name });
    return { changed: true, id: workspaceId, replaced: false };
  }

  /** Archives a workspace. It stops resolving; its rows stay. There is no delete. */
  @RequireFeature(FEATURE.workspacesManage)
  @Mutation(() => PermissionWriteResultType, { name: 'archiveWorkspace' })
  async archiveWorkspace(
    @Context() gqlContext: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<PermissionWriteResultType> {
    const actor = await this.requireActor(gqlContext.req);
    await this.writes.archiveWorkspace(actor, { organizationId, workspaceId });
    return { changed: true, id: workspaceId, replaced: false };
  }

  @RequireFeature(FEATURE.workspacesShare)
  @Mutation(() => PermissionWriteResultType, { name: 'shareWorkspace' })
  async shareWorkspace(
    @Context() gqlContext: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('userId') userId: string,
  ): Promise<PermissionWriteResultType> {
    const actor = await this.requireActor(gqlContext.req);
    const result = await this.writes.shareWorkspace(actor, { organizationId, workspaceId, userId });
    return { changed: result.shared, id: result.workspaceMemberId ?? null, replaced: false };
  }

  @RequireFeature(FEATURE.workspacesShare)
  @Mutation(() => PermissionWriteResultType, { name: 'unshareWorkspace' })
  async unshareWorkspace(
    @Context() gqlContext: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('userId') userId: string,
  ): Promise<PermissionWriteResultType> {
    const actor = await this.requireActor(gqlContext.req);
    const { unshared } = await this.writes.unshareWorkspace(actor, { organizationId, workspaceId, userId });
    return { changed: unshared, id: null, replaced: false };
  }

  /**
   * Grants a WORKSPACE-level role, which requires workspace membership first.
   *
   * That order is structural rather than checked: the grant hangs off
   * `PermWorkspaceMember`, so there is nowhere to put a role for somebody who
   * is not in the workspace. The service says so explicitly rather than
   * silently inserting both.
   */
  @RequireFeature(FEATURE.workspacesShare)
  @Mutation(() => PermissionWriteResultType, { name: 'assignWorkspaceRole' })
  async assignWorkspaceRole(
    @Context() gqlContext: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('userId') userId: string,
    @Args('roleId') roleId: string,
  ): Promise<PermissionWriteResultType> {
    const actor = await this.requireActor(gqlContext.req);
    const { granted, replaced } = await this.writes.assignWorkspaceRole(actor, {
      organizationId,
      workspaceId,
      userId,
      roleId,
    });
    // One role per workspace member, like one per organization member: granting
    // silently removes the previous, and a screen has to be able to say so.
    return { changed: granted, id: roleId, replaced };
  }

  @RequireFeature(FEATURE.workspacesShare)
  @Mutation(() => PermissionWriteResultType, { name: 'revokeWorkspaceRole' })
  async revokeWorkspaceRole(
    @Context() gqlContext: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('userId') userId: string,
    @Args('roleId') roleId: string,
  ): Promise<PermissionWriteResultType> {
    const actor = await this.requireActor(gqlContext.req);
    const { revoked } = await this.writes.revokeWorkspaceRole(actor, {
      organizationId,
      workspaceId,
      userId,
      roleId,
    });
    return { changed: revoked, id: roleId, replaced: false };
  }

  // ── plans ─────────────────────────────────────────────────────────────────
  //
  // The entitlement half of the same shape as the roles block above: a plan is
  // a named collection of features an organization can BUY, as a role is one a
  // person can be GIVEN. Every mutation re-resolves the actor and hands it to
  // the write service, which checks the right again — the guard is the fast
  // refusal, the service is the one that must be true.

  /**
   * The plans the platform defines. Includes ARCHIVED ones — see `listPlans`.
   *
   * `plans:read` is ORGANIZATION level while the three write keys are app
   * level, which is the same asymmetry `features:read` already has: an
   * administrator inside one tenant has to see what they could subscribe to,
   * and defining what the platform sells is a platform act.
   */
  @RequireFeature(FEATURE.plansRead)
  @Query(() => [PermissionPlanDetailType], { name: 'permissionPlans' })
  async plans(): Promise<PermissionPlanDetailType[]> {
    return (await this.permissions.listPlans()).map(toPlanDetail);
  }

  @RequireFeature(FEATURE.plansCreate)
  @Mutation(() => PermissionPlanDetailType, { name: 'createPlan' })
  async createPlan(
    @Context() gqlContext: { req?: unknown },
    @Args('input') input: PlanDraftInput,
  ): Promise<PermissionPlanDetailType> {
    const actor = await this.requireActor(gqlContext.req);
    const { planKey } = await this.writes.createPlan(actor, toPlanDraft(input));
    return this.requirePlanView(planKey);
  }

  @RequireFeature(FEATURE.plansUpdate)
  @Mutation(() => PermissionPlanDetailType, { name: 'updatePlan' })
  async updatePlan(
    @Context() gqlContext: { req?: unknown },
    @Args('planKey') planKey: string,
    @Args('input') input: PlanDraftInput,
  ): Promise<PermissionPlanDetailType> {
    const actor = await this.requireActor(gqlContext.req);
    await this.writes.updatePlan(actor, planKey, toPlanDraft(input));
    return this.requirePlanView(planKey);
  }

  /**
   * Retires a plan or brings it back. There is no delete — see `plans:archive`.
   */
  @RequireFeature(FEATURE.plansArchive)
  @Mutation(() => PermissionPlanDetailType, { name: 'setPlanArchived' })
  async setPlanArchived(
    @Context() gqlContext: { req?: unknown },
    @Args('planKey') planKey: string,
    @Args('archived') archived: boolean,
  ): Promise<PermissionPlanDetailType> {
    const actor = await this.requireActor(gqlContext.req);
    await this.writes.setPlanArchived(actor, planKey, archived);
    return this.requirePlanView(planKey);
  }

  /**
   * What cloning one plan into another would produce — WITHOUT writing it.
   *
   * A mutation for the same reason `previewRoleClone` is: it is asked in
   * response to a button and needs the write service's registry to decide what
   * may cross over. Nothing is persisted; the answer is staged into the form
   * and saved through `updatePlan`, so a clone cannot reach a rule a hand edit
   * obeys.
   */
  @RequireFeature(FEATURE.plansUpdate)
  @Mutation(() => PlanClonePreviewType, { name: 'previewPlanClone' })
  async previewPlanClone(
    @Context() gqlContext: { req?: unknown },
    @Args('sourcePlanKey') sourcePlanKey: string,
    @Args('mode') mode: string,
    @Args('current', { type: () => [String] }) current: string[],
  ): Promise<PlanClonePreviewType> {
    const actor = await this.requireActor(gqlContext.req);
    const result = await this.writes.previewPlanClone(actor, {
      sourcePlanKey,
      current,
      mode: mode === 'replace' ? 'replace' : 'add',
    });
    return { features: result.features, added: result.added, skipped: result.skipped };
  }

  /**
   * Pushes when a plan definition changes — created, updated, archived or
   * restored.
   *
   * ## Guarded by the SAME key as the query, and that is not automatic
   *
   * `plans:read`, exactly as `permissionPlans` is. The registry keeps
   * `graphql_subscription` as a surface distinct from `graphql_operation`
   * because the two are enforced at different moments — the handshake versus
   * the request — and DESIGN-NOTES is explicit that "a key guarding a mutation
   * does not automatically guard the subscription". Here they happen to be the
   * same key because it is the same data; the binding says so out loud rather
   * than leaving it inferred.
   *
   * ## Authorized ONCE
   *
   * A query re-authorizes on every request. This is checked at subscribe time
   * and then streams, so the socket is closed when the access token that opened
   * it expires — see the app's `closeWhenAuthorizationExpires`. Without that
   * cap, a reader whose plan lapsed would keep receiving events until the
   * connection happened to drop.
   *
   * ## Carries the KEY, not the plan
   *
   * The payload is deliberately thin: a plan changed, here is which one. Pushing
   * the whole row would mean every subscriber gets whatever the writer could
   * see, and `PermissionPlanDetail` is not filtered per reader. A key plus a
   * re-read through the guarded query keeps one authorization path instead of
   * two.
   */
  @RequireFeature(FEATURE.plansRead)
  @Subscription(() => PermissionPlanChangedType, {
    name: 'planChanged',
    /**
     * ⚠ REQUIRED, and its absence is silent.
     *
     * `graphql-subscriptions` assumes a published payload is already keyed by
     * the subscription's FIELD NAME — `{ planChanged: { planKey } }` — and
     * without a resolver it hands the raw payload to GraphQL, which finds no
     * `planChanged` property and delivers `data: null`. No error, no warning:
     * the socket connects, the event arrives, and the client gets nothing.
     * That is exactly what happened the first time this was tested.
     *
     * Mapping HERE rather than publishing the wrapped shape keeps the event
     * payload domain-shaped, so `PERMISSIONS_EVENT.planChanged` stays a fact
     * about permissions rather than a fact about one GraphQL field name — and a
     * second transport could carry the same event without unwrapping it.
     */
    resolve: (payload: { planKey: string }) => payload,
  })
  planChanged() {
    return (this.pubsub ?? NULL_PUBSUB).asyncIterableIterator(PERMISSIONS_EVENT.planChanged);
  }

  // ── subscriptions ─────────────────────────────────────────────────────────

  /**
   * Who is on what. Includes ENDED subscriptions — see `listSubscriptions`.
   *
   * `subscriptions:read` rather than `billing:manage`: reading which plan a
   * tenant is on is what support needs to answer "why can they not do this",
   * and that is not the same right as being able to change it.
   */
  @RequireFeature(FEATURE.subscriptionsRead)
  @Query(() => [PermissionSubscriptionType], { name: 'permissionSubscriptions' })
  async subscriptions(
    @Args('organizationId', { type: () => String, nullable: true }) organizationId?: string | null,
  ): Promise<PermissionSubscriptionType[]> {
    return (await this.permissions.listSubscriptions(organizationId ?? null)).map(toSubscriptionView);
  }

  /**
   * The tenants and their live workspaces.
   *
   * MOVED from `billing:manage` to `organizations:read` now that the latter
   * exists, and the old key was always the wrong one: this lists EVERY tenant,
   * which is a platform view, while `billing:manage` is organization level and
   * about changing a subscription rather than about seeing who exists.
   *
   * ⚠ The consequence, stated because it is a real coupling: the subscription
   * form now needs `organizations:read` ALONGSIDE `billing:manage`. Both are
   * held by platform staff, who are the only people those screens serve today —
   * but somebody granted `billing:manage` alone would reach the form and find
   * the organization picker empty.
   */
  @RequireFeature(FEATURE.organizationsRead)
  @Query(() => [PermissionOrganizationType], { name: 'permissionOrganizations' })
  async organizations(): Promise<PermissionOrganizationType[]> {
    return this.permissions.listOrganizations();
  }

  @RequireFeature(FEATURE.billingManage)
  @Mutation(() => PermissionSubscriptionType, { name: 'createSubscription' })
  async createSubscription(
    @Context() gqlContext: { req?: unknown },
    @Args('input') input: SubscriptionDraftInput,
  ): Promise<PermissionSubscriptionType> {
    const actor = await this.requireActor(gqlContext.req);
    const { subscriptionId } = await this.writes.startSubscription(actor, {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      planKey: input.planKey,
      status: input.status,
      currentPeriodEnd: input.currentPeriodEnd,
    });
    return this.requireSubscriptionView(subscriptionId);
  }

  /**
   * Changes a live subscription's status or renewal date.
   *
   * Not its plan, and not its target. Both are read by every entitlement
   * decision the row ever produced — see domain/subscription-draft.ts. Changing
   * plan is `endSubscription` then `createSubscription`, which leaves two rows
   * and a timestamp that reconstruct the change.
   */
  @RequireFeature(FEATURE.billingManage)
  @Mutation(() => PermissionSubscriptionType, { name: 'updateSubscription' })
  async updateSubscription(
    @Context() gqlContext: { req?: unknown },
    @Args('subscriptionId') subscriptionId: string,
    @Args('status') status: string,
    @Args('currentPeriodEnd') currentPeriodEnd: string,
  ): Promise<PermissionSubscriptionType> {
    const actor = await this.requireActor(gqlContext.req);
    await this.writes.updateSubscription(actor, subscriptionId, { status, currentPeriodEnd });
    return this.requireSubscriptionView(subscriptionId);
  }

  /** Ends a subscription. The row stays — see `endSubscription`. */
  @RequireFeature(FEATURE.billingManage)
  @Mutation(() => PermissionSubscriptionType, { name: 'endSubscription' })
  async endSubscription(
    @Context() gqlContext: { req?: unknown },
    @Args('subscriptionId') subscriptionId: string,
  ): Promise<PermissionSubscriptionType> {
    const actor = await this.requireActor(gqlContext.req);
    await this.writes.endSubscription(actor, subscriptionId);
    return this.requireSubscriptionView(subscriptionId);
  }

  /**
   * The actor, or a refusal.
   *
   * `mine()` may return null for a caller with no context; a WRITE may not
   * proceed on one. Throwing here rather than passing `undefined` down keeps
   * the write service's own checks answering "you lack the right" instead of
   * "there is no you".
   */
  /** Every registered feature, from wherever declared. See `featureRegistry`. */
  private get registry() {
    return this.options.featureRegistry ?? FEATURE_REGISTRY;
  }

  private async requireActor(request: unknown) {
    const actor = await this.resolveActor(request);
    if (!actor) throw new Error('No permission context for this request');
    return actor;
  }

  /** Re-reads a role after a write, so the client renders what was stored. */
  private async requireRoleView(roleId: string, organizationId: string | null) {
    const found = (await this.permissions.listRoles(organizationId)).find((role) => role.id === roleId);
    if (!found) throw new Error('Role not found after write');
    return found;
  }

  /** Re-reads a plan after a write, so the client renders what was stored. */
  private async requirePlanView(planKey: string): Promise<PermissionPlanDetailType> {
    const found = (await this.permissions.listPlans()).find((plan) => plan.key === planKey);
    if (!found) throw new Error('Plan not found after write');
    return toPlanDetail(found);
  }

  /** Re-reads a subscription after a write, so the client renders what was stored. */
  private async requireSubscriptionView(subscriptionId: string): Promise<PermissionSubscriptionType> {
    const found = (await this.permissions.listSubscriptions()).find((row) => row.id === subscriptionId);
    if (!found) throw new Error('Subscription not found after write');
    return toSubscriptionView(found);
  }

  @Query(() => PermissionContextType, { name: 'myPermissions', nullable: true })
  async mine(@Context() gqlContext: { req?: unknown }): Promise<PermissionContextType | null> {
    const context = await this.resolveActor(gqlContext.req);
    return context ? toPermissionContextType(context) : null;
  }

  /**
   * The caller's permission context, or null.
   *
   * Extracted so `myPermissions` and every role mutation resolve it the SAME
   * way. Two paths to a context would be two places for them to disagree, and
   * the one that drifts is always the one without a guard behind it — which is
   * the argument this resolver already made for resolving through the guard's
   * own hooks rather than inventing a second route to a subject.
   */
  private async resolveActor(request: unknown): Promise<PermissionContext | null> {
    if (this.options.resolveContext) {
      return (await this.options.resolveContext(request)) ?? null;
    }
    if (!this.options.resolvePrincipal) {
      // Neither hook configured. The module cannot invent a subject, and
      // guessing one would be the worst possible failure direction.
      return null;
    }

    const principal = this.options.resolvePrincipal(request);
    if (!principal) return null;

    /*
     * NO SCOPE FROM THE URL, unlike the guard.
     *
     * FeatureGuard reads organization and workspace out of the route it is
     * protecting. There is no route here — one GraphQL endpoint serves every
     * query — so the only scope available is what the principal itself carries,
     * which is what `resolvePrincipal` reads off the request. An app that puts
     * the active organization in a header or a subdomain surfaces it there
     * (PLAN §12.13); this resolver deliberately does not go looking.
     */
    return this.permissions.loadContext(principal.userId, {
      ...(principal.organizationId !== undefined ? { organizationId: principal.organizationId } : {}),
      ...(principal.workspaceId !== undefined ? { workspaceId: principal.workspaceId } : {}),
    });
  }
}

/**
 * A plan row, as the GraphQL type.
 *
 * The limit MAP becomes a list of pairs here rather than in the service,
 * because the map is the right shape for every other consumer — `resolveLimits`
 * reads one, the form edits one — and only the schema needs the pairs. See
 * `PermissionPlanDetailType.limits` for why the schema cannot take a map.
 */
function toPlanDetail(plan: {
  key: string;
  label: string;
  isPublic: boolean;
  icon: string | null;
  archived: boolean;
  features: string[];
  limits: Record<string, number>;
}): PermissionPlanDetailType {
  return {
    key: plan.key,
    label: plan.label,
    isPublic: plan.isPublic,
    icon: plan.icon,
    archived: plan.archived,
    features: [...plan.features],
    limits: Object.entries(plan.limits)
      .map(([limitKey, value]) => ({ limitKey, value }))
      // Sorted so two renders of the same plan cannot reorder the rows: the
      // order `Object.entries` returns is insertion order, and insertion order
      // here is whatever the database handed back.
      .sort((a, b) => a.limitKey.localeCompare(b.limitKey)),
  };
}

/**
 * A subscription row, as the GraphQL type.
 *
 * Dates become ISO STRINGS at this boundary. The schema has no Date scalar, and
 * adding one to carry two nullable timestamps would put a custom scalar in the
 * public contract for no gain — the client renders them and never computes with
 * them.
 */
function toSubscriptionView(row: {
  id: string;
  organizationId: string;
  organizationName: string;
  workspaceId: string | null;
  workspaceName: string | null;
  planKey: string;
  planLabel: string;
  planArchived: boolean;
  status: string;
  currentPeriodEnd: Date | null;
  endedAt: Date | null;
}): PermissionSubscriptionType {
  return {
    id: row.id,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    planKey: row.planKey,
    planLabel: row.planLabel,
    planArchived: row.planArchived,
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}

/** The GraphQL input, as the pure domain draft. */
function toPlanDraft(input: PlanDraftInput) {
  return {
    key: input.key,
    label: input.label,
    isPublic: input.isPublic,
    icon: input.icon ?? '',
    features: input.features,
    limits: Object.fromEntries(input.limits.map((limit) => [limit.limitKey, limit.value])),
  };
}

/** The GraphQL input, as the pure domain draft. */
function toDraft(input: RoleDraftInput) {
  return {
    key: input.key,
    label: input.label,
    level: input.level,
    icon: input.icon ?? '',
    features: input.features,
  };
}
