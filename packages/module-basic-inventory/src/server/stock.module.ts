import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { StockResolver } from './graphql/stock.resolver.js';
import { StockEventPublisher } from './stock.events.js';
import type { StockModuleOptions } from './stock.options.js';
import {
  STOCK_CHANGE_LISTENER,
  STOCK_LIMIT_CHECKER,
  STOCK_MEMBER_DIRECTORY,
  STOCK_OPTIONS,
  STOCK_PUBSUB,
  STOCK_SALE_FEED,
  STOCK_SOURCE_CATALOGUE,
} from './stock.tokens.js';
import { StockCatalogueService } from './stock-catalogue.service.js';
import { StockCatchUpProcess } from './stock-catch-up.process.js';
import { StockDirectoryService } from './stock-directory.service.js';
import { StockIntakeService } from './stock-intake.service.js';
import { StockMoveService } from './stock-move.service.js';
import { StockTakeService } from './stock-take.service.js';

const SERVICES = [
  StockDirectoryService,
  StockEventPublisher,
  StockCatalogueService,
  StockMoveService,
  StockTakeService,
  StockIntakeService,
  StockCatchUpProcess,
] as const;

/**
 * Importing this module IS the registration: the resolver joins the composed
 * schema because the driver walks the container.
 *
 * ⚠ `StockIntakeService` IS EXPORTED for the app: its adapter for the POS's
 * stock events and the till's counts calls it directly (`apps/web-server/src/stock/*`).
 */
@Module({})
export class StockModule {
  static forRoot(options: StockModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [{ provide: STOCK_OPTIONS, useValue: options }, ...SERVICES];
    if (options.prismaProvider) providers.push(options.prismaProvider as Provider);
    if (options.prismaWriteProvider) providers.push(options.prismaWriteProvider as Provider);

    /*
     * ⚠ Every optional port is bound to `undefined` when the host says nothing,
     * rather than left out, so "nobody answered" is a stated configuration and
     * not a property of whatever else the container happens to hold. Each
     * absence has a documented meaning — see `stock.tokens.ts`.
     */
    const optional: Array<[unknown, string]> = [
      [options.limitCheckerProvider, STOCK_LIMIT_CHECKER],
      [options.memberDirectoryProvider, STOCK_MEMBER_DIRECTORY],
      [options.sourceCatalogueProvider, STOCK_SOURCE_CATALOGUE],
      [options.saleFeedProvider, STOCK_SALE_FEED],
      [options.changeListenerProvider, STOCK_CHANGE_LISTENER],
      [options.pubsubProvider, STOCK_PUBSUB],
    ];
    for (const [provider, token] of optional) {
      providers.push(provider ? (provider as Provider) : { provide: token, useValue: undefined });
    }

    if (options.expose?.graphql ?? true) providers.push(StockResolver);

    return {
      module: StockModule,
      imports: (options.imports ?? []) as NonNullable<DynamicModule['imports']>,
      providers,
      exports: [...SERVICES, STOCK_OPTIONS],
    };
  }
}
