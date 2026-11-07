import type { ServerModuleDescriptor } from '@kwtech/module-kit';
import { PLATFORM_BILLING_FEATURE_REGISTRY } from '../feature-keys.js';
import { PlatformBillingModule } from './platform-billing.module.js';
import type { PlatformBillingModuleOptions } from './platform-billing.options.js';

/**
 * Billing as DATA the host composes: listed in `DECLARING_MODULES`, and its
 * resolvers and keys arrive with it.
 *
 * ⚠ The keys must ALSO be composed in the app's `seed/registry.ts`. An
 * uncomposed registry means the bindings never load — every billing operation
 * reachable by anybody signed in, approval included.
 */
export function platformBillingServerModule(options: PlatformBillingModuleOptions = {}): ServerModuleDescriptor {
  return {
    key: 'platform-billing',
    nestModule: PlatformBillingModule.forRoot(options),
    features: PLATFORM_BILLING_FEATURE_REGISTRY,
  };
}
