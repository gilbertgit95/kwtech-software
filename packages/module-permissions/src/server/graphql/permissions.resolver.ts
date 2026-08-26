import { Inject } from '@nestjs/common';
import { Context, Query, Resolver } from '@nestjs/graphql';
import { FEATURE_REGISTRY } from '../../feature-keys.js';
import type { PermissionsModuleOptions } from '../permissions.module.js';
import { PermissionsService } from '../permissions.service.js';
// The VALUE comes from the leaf module; the interface is type-only and erased,
// so importing it from permissions.module.js closes no cycle at runtime.
import { PERMISSIONS_OPTIONS } from '../permissions.tokens.js';
import { PermissionContextType, PermissionFeatureType, toPermissionContextType } from './permission.types.js';

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
  ) {}

  /** The full registry, for the role editor. Static data — no subject involved. */
  @Query(() => [PermissionFeatureType], { name: 'permissionFeatures' })
  features(): PermissionFeatureType[] {
    return FEATURE_REGISTRY.map((spec) => ({
      key: spec.key,
      module: spec.module,
      label: spec.label,
      description: spec.description,
      isPrivileged: spec.isPrivileged ?? false,
    }));
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
  @Query(() => PermissionContextType, { name: 'myPermissions', nullable: true })
  async mine(@Context() gqlContext: { req?: unknown }): Promise<PermissionContextType | null> {
    const request = gqlContext.req;

    if (this.options.resolveContext) {
      const resolved = await this.options.resolveContext(request);
      return resolved ? toPermissionContextType(resolved) : null;
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
    const context = await this.permissions.loadContext(principal.userId, {
      ...(principal.organizationId !== undefined ? { organizationId: principal.organizationId } : {}),
      ...(principal.workspaceId !== undefined ? { workspaceId: principal.workspaceId } : {}),
    });

    return context ? toPermissionContextType(context) : null;
  }
}
