import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { NotificationResolver } from './graphql/notification.resolver.js';
import { NotificationEventPublisher } from './notification.events.js';
import { type NotificationModuleOptions, resolveNotificationConfig } from './notification.options.js';
import { NotificationSender } from './notification.sender.js';
import { NotificationService } from './notification.service.js';
import {
  NOTIFICATION_CONFIG,
  NOTIFICATION_OPTIONS,
  NOTIFICATION_PUBSUB,
  NOTIFICATION_USER_DIRECTORY,
} from './notification.tokens.js';
import { NotificationWriteService } from './notification-write.service.js';

/**
 * Importing this module IS the registration: the resolver joins the composed
 * schema because the driver walks the container.
 */
@Module({})
export class NotificationModule {
  static forRoot(options: NotificationModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [
      { provide: NOTIFICATION_OPTIONS, useValue: options },
      /*
       * Resolved HERE, while the module is being built, so a duplicate or
       * malformed source key fails the boot — not the first send that names it.
       */
      { provide: NOTIFICATION_CONFIG, useValue: resolveNotificationConfig(options) },
      NotificationService,
      NotificationWriteService,
      NotificationSender,
      NotificationEventPublisher,
    ];
    if (options.prismaProvider) providers.push(options.prismaProvider as Provider);
    if (options.prismaWriteProvider) providers.push(options.prismaWriteProvider as Provider);

    /*
     * ⚠ Every optional port is bound to `undefined` when the host says nothing,
     * rather than left out, so "nobody answered" is a stated configuration and
     * not a property of whatever else the container happens to hold.
     */
    const optional: Array<[unknown, string]> = [
      [options.pubsubProvider, NOTIFICATION_PUBSUB],
      [options.userDirectoryProvider, NOTIFICATION_USER_DIRECTORY],
    ];
    for (const [provider, token] of optional) {
      providers.push(provider ? (provider as Provider) : { provide: token, useValue: undefined });
    }

    if (options.expose?.graphql ?? true) providers.push(NotificationResolver);

    return {
      module: NotificationModule,
      imports: (options.imports ?? []) as NonNullable<DynamicModule['imports']>,
      providers,
      /*
       * `NotificationSender` is the export that matters: the app injects it into
       * its adapters — the ports other modules declare — and that is how every
       * producer reaches a person.
       */
      exports: [
        NotificationSender,
        NotificationService,
        NotificationWriteService,
        NotificationEventPublisher,
        NOTIFICATION_OPTIONS,
      ],
    };
  }
}
