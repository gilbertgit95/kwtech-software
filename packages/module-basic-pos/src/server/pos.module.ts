import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { PosCatalogueResolver } from './graphql/pos-catalogue.resolver.js';
import { PosOrderResolver } from './graphql/pos-order.resolver.js';
import { PosEventPublisher } from './pos.events.js';
import type { PosModuleOptions } from './pos.options.js';
import { POS_ACCESS_CHECK, POS_LIMIT_CHECKER, POS_MEMBER_DIRECTORY, POS_OPTIONS, POS_PUBSUB } from './pos.tokens.js';
import { PosAccessService } from './pos-access.service.js';
import { PosCatalogueService } from './pos-catalogue.service.js';
import { PosCustomerService } from './pos-customer.service.js';
import { PosOrderService } from './pos-order.service.js';
import { PosOrderWriteService } from './pos-order-write.service.js';
import { PosRefundService } from './pos-refund.service.js';
import { PosReportService } from './pos-report.service.js';
import { PosSettingsService } from './pos-settings.service.js';

const SERVICES = [
  PosAccessService,
  PosCatalogueService,
  PosCustomerService,
  PosSettingsService,
  PosOrderService,
  PosOrderWriteService,
  PosRefundService,
  PosReportService,
  PosEventPublisher,
] as const;

/**
 * Importing this module IS the registration: the resolvers join the composed
 * schema because the driver walks the container.
 */
@Module({})
export class PosModule {
  static forRoot(options: PosModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [{ provide: POS_OPTIONS, useValue: options }, ...SERVICES];
    if (options.prismaProvider) providers.push(options.prismaProvider as Provider);
    if (options.prismaWriteProvider) providers.push(options.prismaWriteProvider as Provider);

    /*
     * ⚠ Every optional port is bound to `undefined` when the host says nothing,
     * rather than left out, so "nobody answered" is a stated configuration and
     * not a property of whatever else the container happens to hold. Each
     * absence has a documented meaning — see `PosModuleOptions`.
     */
    const optional: Array<[unknown, string]> = [
      [options.limitCheckerProvider, POS_LIMIT_CHECKER],
      [options.accessCheckProvider, POS_ACCESS_CHECK],
      [options.memberDirectoryProvider, POS_MEMBER_DIRECTORY],
      [options.pubsubProvider, POS_PUBSUB],
    ];
    for (const [provider, token] of optional) {
      providers.push(provider ? (provider as Provider) : { provide: token, useValue: undefined });
    }

    if (options.expose?.graphql ?? true) providers.push(PosCatalogueResolver, PosOrderResolver);

    return {
      module: PosModule,
      imports: (options.imports ?? []) as NonNullable<DynamicModule['imports']>,
      providers,
      exports: [...SERVICES, POS_OPTIONS],
    };
  }
}
