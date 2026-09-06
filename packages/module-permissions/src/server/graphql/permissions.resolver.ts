import { Inject } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { filterFeatures } from '../../domain/feature-filter.js';
import { paginate } from '../../domain/pagination.js';
import { FEATURE, FEATURE_REGISTRY } from '../../feature-keys.js';
import type { PermissionContext } from '../../types.js';
import type { PermissionsModuleOptions } from '../permissions.module.js';
import { PermissionsService } from '../permissions.service.js';
// The VALUE comes from the leaf module; the interface is type-only and erased,
// so importing it from permissions.module.js closes no cycle at runtime.
import { PERMISSIONS_OPTIONS } from '../permissions.tokens.js';
import { PermissionsWriteService } from '../permissions-write.service.js';
import { RequireFeature } from '../require-feature.decorator.js';
import {
  FeatureFilterInput,
  PaginationArgs,
  PermissionContextType,
  PermissionFeaturePageType,
  PermissionRoleDetailType,
  RoleClonePreviewType,
  RoleDraftInput,
  toPermissionContextType,
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
