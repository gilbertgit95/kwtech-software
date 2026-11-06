import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { LocalNetworkResolver } from './graphql/local-network.resolver.js';
import { type LocalNetworkModuleOptions, resolveLocalNetworkOptions } from './local-network.options.js';
import { LocalNetworkService } from './local-network.service.js';
import { LOCAL_NETWORK_OPTIONS } from './local-network.tokens.js';

/**
 * ⚠ ON OR OFF, THE SAME PROVIDERS: the resolver is registered either way, so
 * `Query.localNetwork` is in the schema on every machine and the committed
 * `schema.graphql` does not change with a profile setting (operator,
 * 2026-11-06, #84). Off, the options carry no setup and the query answers
 * `off`, reading nothing (`localNetworkIsEnabled`). The page is what
 * disappears, on the web side.
 */
@Module({})
export class LocalNetworkModule {
  static forRoot(options: LocalNetworkModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [
      // Resolved HERE, so a missing path or origin while on fails the boot, not the first page load.
      { provide: LOCAL_NETWORK_OPTIONS, useValue: resolveLocalNetworkOptions(options) },
      LocalNetworkService,
    ];
    if (options.expose?.graphql ?? true) providers.push(LocalNetworkResolver);

    return { module: LocalNetworkModule, providers };
  }
}
