import { Query, Resolver } from '@nestjs/graphql';
import { FEATURE_REGISTRY } from '../../feature-keys.js';
import { PermissionsService } from '../permissions.service.js';
import { PermissionContextType, PermissionFeatureType } from './permission.types.js';

/**
 * Registering this resolver in the host app's GraphQLModule is all it takes to
 * get the module's queries into the composed schema — code-first means the app
 * writes no SDL and stitches nothing.
 *
 * `myPermissions` is what the React layer's provider calls on load, so the two
 * halves of the module talk to each other and the app just mounts them.
 */
@Resolver()
export class PermissionsResolver {
  constructor(private readonly permissions: PermissionsService) {}

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
   * TODO(Phase 6): read the subject from the request context once the host app
   * decides where the principal lives (§12.6). Signature is stable; only the
   * body changes.
   */
  @Query(() => PermissionContextType, { name: 'myPermissions', nullable: true })
  async mine(): Promise<PermissionContextType | null> {
    return null;
  }
}
