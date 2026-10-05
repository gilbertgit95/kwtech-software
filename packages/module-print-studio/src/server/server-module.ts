import type { ProcessContribution, ServerModuleDescriptor } from '@kwtech/module-kit';
import { STUDIO_FEATURE_REGISTRY, STUDIO_LIMIT_REGISTRY } from '../feature-keys.js';
import { STUDIO_PROCESS, STUDIO_PROCESS_REGISTRY } from '../processes.js';
import { StudioModule } from './studio.module.js';
import type { StudioModuleOptions } from './studio.options.js';
import { StudioPruneLogsProcess } from './studio-prune.process.js';

/**
 * Which class runs each declared process. ⚠ Keyed by the declaration's key, and
 * `studioProcesses` throws on a declaration with no entry here: a process that
 * is listed on the admin screen and can never run is worse than a failed boot.
 */
const STUDIO_PROCESS_HANDLERS: Record<string, unknown> = {
  [STUDIO_PROCESS.pruneLogs]: StudioPruneLogsProcess,
};

function studioProcesses(): ProcessContribution[] {
  return STUDIO_PROCESS_REGISTRY.map((declaration) => {
    const handler = STUDIO_PROCESS_HANDLERS[declaration.key];
    if (!handler) {
      throw new Error(
        `Process '${declaration.key}' has no handler. Add it to STUDIO_PROCESS_HANDLERS in server-module.ts.`,
      );
    }
    return { ...declaration, handler };
  });
}

/**
 * The print studio as DATA the host composes: listed in `SERVER_MODULES`, and
 * its resolver, keys, cap and background process arrive with it.
 *
 * ⚠ The keys and cap must ALSO be composed in the app's `seed/registry.ts`.
 * An uncomposed registry means the bindings never load — every studio
 * operation reachable by anybody signed in — and the cap is never mirrored for
 * plans. The same goes for `STUDIO_PROCESS_REGISTRY`: unsynced, the print
 * history is never pruned.
 */
export function studioServerModule(options: StudioModuleOptions = {}): ServerModuleDescriptor {
  return {
    key: 'studio',
    nestModule: StudioModule.forRoot(options),
    features: STUDIO_FEATURE_REGISTRY,
    limits: STUDIO_LIMIT_REGISTRY,
    processes: studioProcesses(),
  };
}
