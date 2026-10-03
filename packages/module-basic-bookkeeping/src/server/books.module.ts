import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { BooksEventPublisher } from './books.events.js';
import type { BooksModuleOptions } from './books.options.js';
import {
  BOOKS_ACCESS_CHECK,
  BOOKS_MEMBER_DIRECTORY,
  BOOKS_OPTIONS,
  BOOKS_PUBSUB,
  BOOKS_SALES_SOURCE,
  BOOKS_WORKSPACE_TIME_ZONE,
} from './books.tokens.js';
import { BooksAccessService } from './books-access.service.js';
import { BooksDirectoryService } from './books-directory.service.js';
import { BooksEntryService } from './books-entry.service.js';
import { BooksInvestorService } from './books-investor.service.js';
import { BooksLedgerService } from './books-ledger.service.js';
import { BooksPosService } from './books-pos.service.js';
import { BooksTimeZoneService } from './books-time-zone.service.js';
import { BooksResolver } from './graphql/books.resolver.js';
import { BooksInvestorResolver } from './graphql/books-investor.resolver.js';

const SERVICES = [
  BooksAccessService,
  BooksDirectoryService,
  BooksTimeZoneService,
  BooksEventPublisher,
  BooksLedgerService,
  BooksEntryService,
  BooksInvestorService,
  BooksPosService,
] as const;

/**
 * Importing this module IS the registration: the resolvers join the composed
 * schema because the driver walks the container.
 */
@Module({})
export class BooksModule {
  static forRoot(options: BooksModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [{ provide: BOOKS_OPTIONS, useValue: options }, ...SERVICES];
    if (options.prismaProvider) providers.push(options.prismaProvider as Provider);
    if (options.prismaWriteProvider) providers.push(options.prismaWriteProvider as Provider);

    /*
     * ⚠ Every optional port is bound to `undefined` when the host says nothing,
     * rather than left out, so "nobody answered" is a stated configuration and
     * not a property of whatever else the container happens to hold. Each
     * absence has a documented meaning — see `BooksModuleOptions`.
     */
    const optional: Array<[unknown, string]> = [
      [options.accessCheckProvider, BOOKS_ACCESS_CHECK],
      [options.memberDirectoryProvider, BOOKS_MEMBER_DIRECTORY],
      [options.workspaceTimeZoneProvider, BOOKS_WORKSPACE_TIME_ZONE],
      [options.salesSourceProvider, BOOKS_SALES_SOURCE],
      [options.pubsubProvider, BOOKS_PUBSUB],
    ];
    for (const [provider, token] of optional) {
      providers.push(provider ? (provider as Provider) : { provide: token, useValue: undefined });
    }

    if (options.expose?.graphql ?? true) providers.push(BooksResolver, BooksInvestorResolver);

    return {
      module: BooksModule,
      imports: (options.imports ?? []) as NonNullable<DynamicModule['imports']>,
      providers,
      exports: [...SERVICES, BOOKS_OPTIONS],
    };
  }
}
