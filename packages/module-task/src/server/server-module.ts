import type { ServerModuleDescriptor } from '@kwtech/module-kit';
import { TASK_FEATURE_REGISTRY, TASK_LIMIT_REGISTRY } from '../feature-keys.js';
import { TaskModule } from './task.module.js';
import type { TaskModuleOptions } from './task.options.js';

/**
 * Tasks as DATA the host composes: listed in `SERVER_MODULES`, and its
 * resolver, keys and caps arrive with it.
 *
 * ⚠ The keys and caps must ALSO be composed in the app's `seed/registry.ts`.
 * An uncomposed registry means the bindings never load — every task operation
 * reachable by anybody signed in — and the caps are never mirrored for plans.
 */
export function taskServerModule(options: TaskModuleOptions = {}): ServerModuleDescriptor {
  return {
    key: 'task',
    nestModule: TaskModule.forRoot(options),
    features: TASK_FEATURE_REGISTRY,
    limits: TASK_LIMIT_REGISTRY,
  };
}
