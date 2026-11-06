import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { localNetworkIsEnabled } from '../enabled.js';
import { LocalNetworkResolver } from './graphql/local-network.resolver.js';
import { type LocalNetworkModuleOptions, resolveLocalNetworkOptions } from './local-network.options.js';
import { LocalNetworkService } from './local-network.service.js';
import { LOCAL_NETWORK_OPTIONS } from './local-network.tokens.js';

/**
 * ⚠ OFF RETURNS A MODULE THAT REGISTERS NOTHING, in this one place, as
 * module-chat's does: no resolver, so the query is not in the schema, and not
 * even the options token, so a stray injection fails loudly at boot instead
 * of resolving options nobody checked. Off is the default
 * (`localNetworkIsEnabled`), because off is every remote server.
 */
@Module({})
export class LocalNetworkModule {
  static forRoot(options: LocalNetworkModuleOptions = {}): DynamicModule {
    if (!localNetworkIsEnabled(options)) return { module: LocalNetworkModule };

    const providers: Provider[] = [
      // Resolved HERE, so a missing path or origin fails the boot, not the first page load.
      { provide: LOCAL_NETWORK_OPTIONS, useValue: resolveLocalNetworkOptions(options) },
      LocalNetworkService,
    ];
    if (options.expose?.graphql ?? true) providers.push(LocalNetworkResolver);

    return { module: LocalNetworkModule, providers };
  }
}
