import type { ServerModuleDescriptor } from '@kwtech/module-kit';
import { FEATURE_REGISTRY } from '../feature-keys.js';
import { PermissionsModule, type PermissionsModuleOptions } from './permissions.module.js';

/**
 * The module's server descriptor — what an app lists instead of hand-wiring.
 *
 *   const SERVER_MODULES = [permissionsServerModule({ ... }), usersServerModule({ ... })];
 *   imports: [...serverModuleImports(SERVER_MODULES), RouterModule.register(serverRoutePrefixes(SERVER_MODULES))]
 *
 * Everything the module publishes — controllers, resolvers, guard, service, and
 * its slice of the feature registry — arrives with that one entry.
 */
export function permissionsServerModule(
  options: PermissionsModuleOptions & { routePrefix?: string },
): ServerModuleDescriptor {
  const { routePrefix, ...moduleOptions } = options;
  return {
    key: 'permissions',
    nestModule: PermissionsModule.forRoot(moduleOptions),
    ...(routePrefix !== undefined ? { routePrefix } : {}),
    features: FEATURE_REGISTRY,
  };
}
