import type { ProcessContribution, ServerModuleDescriptor } from '@kwtech/module-kit';
import { PLATFORM_BILLING_FEATURE_REGISTRY } from '../feature-keys.js';
import { PLATFORM_BILLING_PROCESS, PLATFORM_BILLING_PROCESS_REGISTRY } from '../processes.js';
import { PlatformBillingModule } from './platform-billing.module.js';
import type { PlatformBillingModuleOptions } from './platform-billing.options.js';
import { PlatformBillingDailyCheck } from './platform-billing-daily.process.js';

/** Each declared process joined to the class that runs it. A declaration with no handler fails the boot. */
const PLATFORM_BILLING_PROCESS_HANDLERS: Record<string, unknown> = {
  [PLATFORM_BILLING_PROCESS.dailyCheck]: PlatformBillingDailyCheck,
};

function platformBillingProcesses(): ProcessContribution[] {
  return PLATFORM_BILLING_PROCESS_REGISTRY.map((declaration) => {
    const handler = PLATFORM_BILLING_PROCESS_HANDLERS[declaration.key];
    if (!handler) {
      throw new Error(
        `Process '${declaration.key}' has no handler. Add it to PLATFORM_BILLING_PROCESS_HANDLERS in server-module.ts.`,
      );
    }
    return { ...declaration, handler };
  });
}

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
    processes: platformBillingProcesses(),
  };
}
