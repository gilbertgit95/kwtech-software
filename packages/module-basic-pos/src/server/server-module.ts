import type { ServerModuleDescriptor } from '@kwtech/module-kit';
import { POS_FEATURE_REGISTRY, POS_LIMIT_REGISTRY } from '../feature-keys.js';
import { PosModule } from './pos.module.js';
import type { PosModuleOptions } from './pos.options.js';

/**
 * The point of sale as DATA the host composes: listed in `SERVER_MODULES`, and
 * its resolvers, keys and cap arrive with it.
 *
 * ⚠ The keys and cap must ALSO be composed in the app's `seed/registry.ts`.
 * An uncomposed registry means the bindings never load — every POS operation
 * reachable by anybody signed in — and the cap is never mirrored for plans.
 */
export function posServerModule(options: PosModuleOptions = {}): ServerModuleDescriptor {
  return {
    key: 'pos',
    nestModule: PosModule.forRoot(options),
    features: POS_FEATURE_REGISTRY,
    limits: POS_LIMIT_REGISTRY,
  };
}
