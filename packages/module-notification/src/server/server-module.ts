import type { ServerModuleDescriptor } from '@kwtech/module-kit';
import { NOTIFICATION_FEATURE_REGISTRY } from '../feature-keys.js';
import { NotificationModule } from './notification.module.js';
import type { NotificationModuleOptions } from './notification.options.js';

/**
 * Notifications as DATA the host composes: listed in `SERVER_MODULES`, and the
 * resolver and keys arrive with it.
 *
 * ⚠ The keys must ALSO be composed in the app's `seed/registry.ts`. An
 * uncomposed registry means the bindings never load — every notification
 * operation reachable by anybody signed in, including sending as the platform.
 */
export function notificationServerModule(options: NotificationModuleOptions = {}): ServerModuleDescriptor {
  return {
    key: 'notification',
    nestModule: NotificationModule.forRoot(options),
    features: NOTIFICATION_FEATURE_REGISTRY,
  };
}
