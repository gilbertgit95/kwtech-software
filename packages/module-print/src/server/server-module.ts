import type { ServerModuleDescriptor } from '@kwtech/module-kit';
import { PRINT_FEATURE_REGISTRY, PRINT_LIMIT_REGISTRY } from '../feature-keys.js';
import { PrintModule } from './print.module.js';
import type { PrintModuleOptions } from './print.options.js';

/**
 * The printing side as DATA the host composes: listed in `SERVER_MODULES`, and
 * its resolvers, keys and cap arrive with it.
 *
 * ⚠ The keys and cap must ALSO be composed in the app's `seed/registry.ts`.
 * An uncomposed registry means the bindings never load — pairing a computer
 * reachable by anybody signed in — and the cap is never mirrored for plans.
 *
 * ⚠ AND THE HOST MUST OFFER SOCKETS TO `PrintAgentService.admit`, keyed on
 * `PRINT_AGENT_SECRET_PARAM`, in its `admitAnonymous` hook. Without that a
 * computer pairs and then can never connect.
 */
export function printServerModule(options: PrintModuleOptions = {}): ServerModuleDescriptor {
  return {
    key: 'print',
    nestModule: PrintModule.forRoot(options),
    features: PRINT_FEATURE_REGISTRY,
    limits: PRINT_LIMIT_REGISTRY,
  };
}
