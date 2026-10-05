import type { ServerModuleDescriptor } from '@kwtech/module-kit';
import { JOBS_FEATURE_REGISTRY } from '../feature-keys.js';
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
 * row and does not run; the runner says so at its first wake-up, and the admin
 * page shows it as not synced.
 *
 * ⚠ And the KEYS must be composed there too. An uncomposed registry means the
 * bindings never load — Pause and Run now reachable by anybody signed in.
 */
export function jobsServerModule(options: JobsModuleOptions = {}): ServerModuleDescriptor {
  return {
    key: 'jobs',
    nestModule: JobsModule.forRoot(options),
    features: JOBS_FEATURE_REGISTRY,
  };
}
