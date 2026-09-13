import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { QueueResolver } from './graphql/queue.resolver.js';
import { QueueDisplayResolver } from './graphql/queue-display.resolver.js';
import type { QueueModuleOptions } from './queue.options.js';
import { QueueService } from './queue.service.js';
import {
  QUEUE_LIMIT_CHECKER,
  QUEUE_OPTIONS,
  QUEUE_STAFF_CHECK,
  QUEUE_STAFF_DIRECTORY,
  QUEUE_WORKSPACE_LOCATOR,
} from './queue.tokens.js';
import { QueueDisplayService } from './queue-display.service.js';
import { QueueWriteService } from './queue-write.service.js';

/**
 * Importing this module IS the registration: the resolvers join the composed
 * schema because the driver walks the container.
 */
@Module({})
export class QueueModule {
  static forRoot(options: QueueModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [
      { provide: QUEUE_OPTIONS, useValue: options },
      QueueService,
      QueueWriteService,
      QueueDisplayService,
    ];
    if (options.prismaProvider) providers.push(options.prismaProvider as Provider);
    if (options.prismaWriteProvider) providers.push(options.prismaWriteProvider as Provider);

    /*
     * ⚠ Every optional port is bound to `undefined` when the host says nothing,
     * rather than left out, so "nobody answered" is a stated configuration and
     * not a property of whatever else the container happens to hold. Each
     * absence has a documented meaning — see `QueueModuleOptions`.
     */
    const optional: Array<[unknown, string]> = [
      [options.limitCheckerProvider, QUEUE_LIMIT_CHECKER],
      [options.staffCheckProvider, QUEUE_STAFF_CHECK],
      [options.staffDirectoryProvider, QUEUE_STAFF_DIRECTORY],
      [options.workspaceLocatorProvider, QUEUE_WORKSPACE_LOCATOR],
    ];
    for (const [provider, token] of optional) {
      providers.push(provider ? (provider as Provider) : { provide: token, useValue: undefined });
    }

    if (options.expose?.graphql ?? true) providers.push(QueueResolver, QueueDisplayResolver);

    return {
      module: QueueModule,
      imports: (options.imports ?? []) as NonNullable<DynamicModule['imports']>,
      providers,
      exports: [QueueService, QueueWriteService, QueueDisplayService, QUEUE_OPTIONS],
    };
  }
}
