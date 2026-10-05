import type { ServerModuleDescriptor } from '@kwtech/module-kit';
import { JobsModule } from './jobs.module.js';
import type { JobsModuleOptions } from './jobs.options.js';

/**
 * The runner as DATA the host composes: listed in `SERVER_MODULES`, LAST,
 * because it is handed the processes of every module before it.
 *
 *   const MODULES = [taskServerModule({…}), …];
 *   const SERVER_MODULES = [...MODULES, jobsServerModule({ processes: composeProcesses(MODULES), … })];
 *
 * ⚠ The same declarations must ALSO reach the app's `seed/registry.ts`, which
 * `db:sync` mirrors into `job_process`. A process the sync never wrote has no
 * row and does not run; the runner says so at its first wake-up.
 *
 * No features and no limits yet: the keys (`jobs:read`, `jobs:pause`, …) arrive
 * with the screens they guard, in phase 2.
 */
export function jobsServerModule(options: JobsModuleOptions = {}): ServerModuleDescriptor {
  return {
    key: 'jobs',
    nestModule: JobsModule.forRoot(options),
  };
}
