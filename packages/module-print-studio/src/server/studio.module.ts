import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { StudioResolver } from './graphql/studio.resolver.js';
import type { StudioModuleOptions } from './studio.options.js';
import { StudioService } from './studio.service.js';
import { STUDIO_ACCESS_CHECK, STUDIO_LIMIT_CHECKER, STUDIO_MEMBER_DIRECTORY, STUDIO_OPTIONS } from './studio.tokens.js';
import { StudioPruneLogsProcess } from './studio-prune.process.js';
import { StudioSettingsService } from './studio-settings.service.js';
import { StudioWriteService } from './studio-write.service.js';

/**
 * Importing this module IS the registration: the resolver joins the composed
 * schema because the driver walks the container.
 */
@Module({})
export class StudioModule {
  static forRoot(options: StudioModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [
      { provide: STUDIO_OPTIONS, useValue: options },
      StudioService,
      StudioWriteService,
      StudioSettingsService,
      // The background runner resolves this from the container (`server-module.ts`).
      StudioPruneLogsProcess,
    ];
    if (options.prismaProvider) providers.push(options.prismaProvider as Provider);
    if (options.prismaWriteProvider) providers.push(options.prismaWriteProvider as Provider);

    /*
     * ⚠ Every optional port is bound to `undefined` when the host says nothing,
     * rather than left out, so "nobody answered" is a stated configuration and
     * not a property of whatever else the container happens to hold. Each
     * absence has a documented meaning — see `StudioModuleOptions`.
     */
    const optional: Array<[unknown, string]> = [
      [options.limitCheckerProvider, STUDIO_LIMIT_CHECKER],
      [options.accessCheckProvider, STUDIO_ACCESS_CHECK],
      [options.memberDirectoryProvider, STUDIO_MEMBER_DIRECTORY],
    ];
    for (const [provider, token] of optional) {
      providers.push(provider ? (provider as Provider) : { provide: token, useValue: undefined });
    }

    if (options.expose?.graphql ?? true) providers.push(StudioResolver);

    return {
      module: StudioModule,
      imports: (options.imports ?? []) as NonNullable<DynamicModule['imports']>,
      providers,
      exports: [StudioService, StudioWriteService, StudioSettingsService, StudioPruneLogsProcess, STUDIO_OPTIONS],
    };
  }
}
