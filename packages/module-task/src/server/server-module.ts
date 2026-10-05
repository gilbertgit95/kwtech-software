import type { ProcessContribution, ServerModuleDescriptor } from '@kwtech/module-kit';
import { TASK_FEATURE_REGISTRY, TASK_LIMIT_REGISTRY } from '../feature-keys.js';
import { TASK_PROCESS, TASK_PROCESS_REGISTRY } from '../processes.js';
import { TaskModule } from './task.module.js';
import type { TaskModuleOptions } from './task.options.js';
import { TaskDueTodayProcess } from './task-due.process.js';

/**
 * Which class runs each declared process. ⚠ Keyed by the declaration's key, and
 * `taskProcesses` throws on a declaration with no entry here: a process that is
 * listed on the admin screen and can never run is worse than a failed boot.
 */
const TASK_PROCESS_HANDLERS: Record<string, unknown> = {
  [TASK_PROCESS.dueToday]: TaskDueTodayProcess,
};

function taskProcesses(): ProcessContribution[] {
  return TASK_PROCESS_REGISTRY.map((declaration) => {
    const handler = TASK_PROCESS_HANDLERS[declaration.key];
    if (!handler) {
      throw new Error(
        `Process '${declaration.key}' has no handler. Add it to TASK_PROCESS_HANDLERS in server-module.ts.`,
      );
    }
    return { ...declaration, handler };
  });
}

/**
 * Tasks as DATA the host composes: listed in `SERVER_MODULES`, and its
 * resolver, keys, caps and background processes arrive with it.
 *
 * ⚠ The keys and caps must ALSO be composed in the app's `seed/registry.ts`.
 * An uncomposed registry means the bindings never load — every task operation
 * reachable by anybody signed in — and the caps are never mirrored for plans.
 * The same goes for `TASK_PROCESS_REGISTRY`: unsynced, the reminders never run.
 */
export function taskServerModule(options: TaskModuleOptions = {}): ServerModuleDescriptor {
  return {
    key: 'task',
    nestModule: TaskModule.forRoot(options),
    features: TASK_FEATURE_REGISTRY,
    limits: TASK_LIMIT_REGISTRY,
    processes: taskProcesses(),
  };
}
