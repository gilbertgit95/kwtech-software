import type { ServerModuleDescriptor } from '@kwtech/module-kit';
import { QUEUE_FEATURE_REGISTRY, QUEUE_LIMIT_REGISTRY } from '../feature-keys.js';
import { QueueModule } from './queue.module.js';
import type { QueueModuleOptions } from './queue.options.js';

/**
 * The queue as DATA the host composes: listed in `SERVER_MODULES`, and its
 * resolvers, keys and caps arrive with it.
 *
 * ⚠ The keys and caps must ALSO be composed in the app's `seed/registry.ts`.
 * An uncomposed registry means the bindings never load — every queue mutation
 * reachable by anybody signed in — and the caps resolve to unlimited.
 */
export function queueServerModule(options: QueueModuleOptions = {}): ServerModuleDescriptor {
  return {
    key: 'queue',
    nestModule: QueueModule.forRoot(options),
    features: QUEUE_FEATURE_REGISTRY,
    limits: QUEUE_LIMIT_REGISTRY,
  };
}
