import type { ProcessContribution, ServerModuleDescriptor } from '@kwtech/module-kit';
import { POS_FEATURE_REGISTRY, POS_LIMIT_REGISTRY } from '../feature-keys.js';
import { POS_PROCESS, POS_PROCESS_REGISTRY } from '../processes.js';
import { PosModule } from './pos.module.js';
import type { PosModuleOptions } from './pos.options.js';
import { PosRankItemsProcess } from './pos-rank.process.js';

/**
 * Which class runs each declared process. ⚠ Keyed by the declaration's key, and
 * `posProcesses` throws on a declaration with no entry here: a process that is
 * listed on the admin screen and can never run is worse than a failed boot.
 */
const POS_PROCESS_HANDLERS: Record<string, unknown> = {
  [POS_PROCESS.rankItems]: PosRankItemsProcess,
};

function posProcesses(): ProcessContribution[] {
  return POS_PROCESS_REGISTRY.map((declaration) => {
    const handler = POS_PROCESS_HANDLERS[declaration.key];
    if (!handler) {
      throw new Error(
        `Process '${declaration.key}' has no handler. Add it to POS_PROCESS_HANDLERS in server-module.ts.`,
      );
    }
    return { ...declaration, handler };
  });
}

/**
 * The point of sale as DATA the host composes: listed in `SERVER_MODULES`, and
 * its resolvers, keys, cap and background process arrive with it.
 *
 * ⚠ The keys and cap must ALSO be composed in the app's `seed/registry.ts`.
 * An uncomposed registry means the bindings never load — every POS operation
 * reachable by anybody signed in — and the cap is never mirrored for plans.
 * The same goes for `POS_PROCESS_REGISTRY`: unsynced, no store is ever ranked
 * and the tills keep listing items by name.
 */
export function posServerModule(options: PosModuleOptions = {}): ServerModuleDescriptor {
  return {
    key: 'pos',
    nestModule: PosModule.forRoot(options),
    features: POS_FEATURE_REGISTRY,
    limits: POS_LIMIT_REGISTRY,
    processes: posProcesses(),
  };
}
