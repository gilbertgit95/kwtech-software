import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import type { AppHubModuleOptions } from './app-hub.options.js';
import { AppHubService } from './app-hub.service.js';
import { APP_HUB_OPTIONS } from './app-hub.tokens.js';
import { AppHubResolver } from './graphql/app-hub.resolver.js';

/**
 * Importing this module IS the registration: the resolver joins the composed
 * schema because the driver walks the container.
 */
@Module({})
export class AppHubModule {
  static forRoot(options: AppHubModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [{ provide: APP_HUB_OPTIONS, useValue: options }, AppHubService];
    if (options.prismaProvider) providers.push(options.prismaProvider as Provider);
    if (options.expose?.graphql ?? true) providers.push(AppHubResolver);

    return {
      module: AppHubModule,
      imports: (options.imports ?? []) as NonNullable<DynamicModule['imports']>,
      providers,
      exports: [AppHubService, APP_HUB_OPTIONS],
    };
  }
}
