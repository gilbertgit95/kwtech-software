import type { ServerModuleDescriptor } from '@kwtech/module-kit';
import { APP_HUB_FEATURE_REGISTRY } from '../feature-keys.js';
import { AppHubModule } from './app-hub.module.js';
import type { AppHubModuleOptions } from './app-hub.options.js';

/**
 * The Apps page as DATA the host composes: listed in `SERVER_MODULES`, and its
 * resolver and keys arrive with it.
 *
 * ⚠ The keys must ALSO be composed in the app's `seed/registry.ts`. An
 * uncomposed registry means the bindings never load, and every operation here
 * is reachable by anybody signed in, for any workspace they name.
 */
export function appHubServerModule(options: AppHubModuleOptions = {}): ServerModuleDescriptor {
  return {
    key: 'app_hub',
    nestModule: AppHubModule.forRoot(options),
    features: APP_HUB_FEATURE_REGISTRY,
  };
}
