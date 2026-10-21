import type { ProcessContribution, ServerModuleDescriptor } from '@kwtech/module-kit';
import { STOCK_FEATURE_REGISTRY, STOCK_LIMIT_REGISTRY } from '../feature-keys.js';
import { STOCK_PROCESS, STOCK_PROCESS_REGISTRY } from '../processes.js';
import { StockModule } from './stock.module.js';
import type { StockModuleOptions } from './stock.options.js';
import { StockCatchUpProcess } from './stock-catch-up.process.js';

/**
 * Which class runs each declared process. ⚠ Keyed by the declaration's key, and
 * `stockProcesses` throws on a declaration with no entry here: a process that is
 * listed on the admin screen and can never run is worse than a failed boot.
 */
const STOCK_PROCESS_HANDLERS: Record<string, unknown> = {
  [STOCK_PROCESS.catchUp]: StockCatchUpProcess,
};

function stockProcesses(): ProcessContribution[] {
  return STOCK_PROCESS_REGISTRY.map((declaration) => {
    const handler = STOCK_PROCESS_HANDLERS[declaration.key];
    if (!handler) {
      throw new Error(
        `Process '${declaration.key}' has no handler. Add it to STOCK_PROCESS_HANDLERS in server-module.ts.`,
      );
    }
    return { ...declaration, handler };
  });
}

/**
 * The stock app as DATA the host composes: listed in `SERVER_MODULES`, and its
 * resolver, keys, cap and catch-up process arrive with it.
 *
 * ⚠ The keys and cap must ALSO be composed in the app's `seed/registry.ts`. An
 * uncomposed registry means the bindings never load — every stock operation
 * reachable by anybody signed in. The same goes for `STOCK_PROCESS_REGISTRY`:
 * unsynced, the catch-up never runs.
 */
export function stockServerModule(options: StockModuleOptions = {}): ServerModuleDescriptor {
  return {
    key: 'stock',
    nestModule: StockModule.forRoot(options),
    features: STOCK_FEATURE_REGISTRY,
    limits: STOCK_LIMIT_REGISTRY,
    processes: stockProcesses(),
  };
}
