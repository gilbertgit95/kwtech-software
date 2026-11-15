import type { ProcessContribution, ServerModuleDescriptor } from '@kwtech/module-kit';
import { FILE_FEATURE_REGISTRY, FILE_LIMIT_REGISTRY } from '../feature-keys.js';
import { FILE_PROCESS, FILE_PROCESS_REGISTRY } from '../processes.js';
import { FileModule } from './file.module.js';
import type { FileModuleOptions } from './file.options.js';
import { FileCleanupProcess } from './file-cleanup.process.js';

/** Which class runs each declared process. ⚠ Keyed by the declaration's key; a missing one throws at boot. */
const FILE_PROCESS_HANDLERS: Readonly<Record<string, unknown>> = {
  [FILE_PROCESS.cleanup]: FileCleanupProcess,
};

function fileProcesses(): ProcessContribution[] {
  return FILE_PROCESS_REGISTRY.map((declaration) => {
    const handler = FILE_PROCESS_HANDLERS[declaration.key];
    if (!handler) {
      throw new Error(
        `Process '${declaration.key}' has no handler. Add it to FILE_PROCESS_HANDLERS in server-module.ts.`,
      );
    }
    return { ...declaration, handler };
  });
}

/**
 * The file manager as DATA the host composes: its resolver, the two transfer
 * routes, the keys, the caps and the nightly clean-up arrive with it.
 *
 * ⚠ The keys, caps and process must ALSO be composed in the app's
 * `seed/registry.ts`: uncomposed keys are unguarded operations, and an
 * unsynced process never runs — files would never be deleted.
 */
export function fileServerModule(options: FileModuleOptions = {}): ServerModuleDescriptor {
  return {
    key: 'file',
    nestModule: FileModule.forRoot(options),
    features: FILE_FEATURE_REGISTRY,
    limits: FILE_LIMIT_REGISTRY,
    processes: fileProcesses(),
  };
}
