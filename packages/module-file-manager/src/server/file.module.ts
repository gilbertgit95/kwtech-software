import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { FileEventPublisher } from './file.events.js';
import type { FileModuleOptions } from './file.options.js';
import { FileService } from './file.service.js';
import {
  FILE_LIMIT_CHECKER,
  FILE_MEMBER_DIRECTORY,
  FILE_NOTIFIER,
  FILE_OPTIONS,
  FILE_PUBSUB,
  FILE_STORE,
} from './file.tokens.js';
import { FileCleanupProcess } from './file-cleanup.process.js';
import { FileTransferService } from './file-transfer.service.js';
import { FileWriteService } from './file-write.service.js';
import { FileResolver } from './graphql/file.resolver.js';
import { FileTransferController } from './http/file-transfer.controller.js';

/**
 * Importing this module IS the registration: the resolver joins the composed
 * schema because the driver walks the container, and the controller's two
 * routes join the app's.
 */
@Module({})
export class FileModule {
  static forRoot(options: FileModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [
      { provide: FILE_OPTIONS, useValue: options },
      FileService,
      FileWriteService,
      // The tickets are rows (`FileTicket`), so any instance of this, on any server, spends any of them.
      FileTransferService,
      FileEventPublisher,
      // A provider like any service: the runner resolves it from the container by this class.
      FileCleanupProcess,
    ];
    if (options.prismaProvider) providers.push(options.prismaProvider as Provider);
    if (options.prismaWriteProvider) providers.push(options.prismaWriteProvider as Provider);

    // ⚠ Every optional port is bound to `undefined` when the host says nothing, so absence is a stated configuration.
    const optional: Array<[unknown, string]> = [
      [options.storeProvider, FILE_STORE],
      [options.limitCheckerProvider, FILE_LIMIT_CHECKER],
      [options.memberDirectoryProvider, FILE_MEMBER_DIRECTORY],
      [options.notifierProvider, FILE_NOTIFIER],
      [options.pubsubProvider, FILE_PUBSUB],
    ];
    for (const [provider, token] of optional) {
      providers.push(provider ? (provider as Provider) : { provide: token, useValue: undefined });
    }

    if (options.expose?.graphql ?? true) providers.push(FileResolver);

    return {
      module: FileModule,
      imports: (options.imports ?? []) as NonNullable<DynamicModule['imports']>,
      controllers: (options.expose?.rest ?? true) ? [FileTransferController] : [],
      providers,
      exports: [
        FileService,
        FileWriteService,
        FileTransferService,
        FileEventPublisher,
        FileCleanupProcess,
        FILE_OPTIONS,
      ],
    };
  }
}
