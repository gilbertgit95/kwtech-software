import type { ServerModuleDescriptor } from '@kwtech/module-kit';
import { LOCAL_NETWORK_FEATURE_REGISTRY } from '../feature-keys.js';
import { LocalNetworkModule } from './local-network.module.js';
import type { LocalNetworkModuleOptions } from './local-network.options.js';

/**
 * Local Network as DATA the host composes: the resolver and the key arrive
 * with it.
 *
 * ⚠ The key rides along EVEN WHILE OFF, as chat's do, and the app's
 * `seed/registry.ts` composes it either way: dropping it would make `db:sync`
 * deprecate `local_network:read`, and turning the page back on would bring it
 * back without the grants a super admin gave.
 */
export function localNetworkServerModule(options: LocalNetworkModuleOptions = {}): ServerModuleDescriptor {
  return {
    key: 'local_network',
    nestModule: LocalNetworkModule.forRoot(options),
    features: LOCAL_NETWORK_FEATURE_REGISTRY,
  };
}
