import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { BookingEventPublisher } from './booking.events.js';
import type { BookingModuleOptions } from './booking.options.js';
import { BookingReadService } from './booking.service.js';
import {
  BOOKING_LIMIT_CHECKER,
  BOOKING_MEMBER_DIRECTORY,
  BOOKING_NOTIFIER,
  BOOKING_OPTIONS,
  BOOKING_PUBSUB,
  BOOKING_WORKSPACE_TIME_ZONE,
} from './booking.tokens.js';
import { BookingCatalogueService } from './booking-catalogue.service.js';
import { BookingLapseRequestsProcess } from './booking-lapse.process.js';
import { BookingPublicService } from './booking-public.service.js';
import { BookingUpcomingSessionsProcess } from './booking-reminder.process.js';
import { BookingTimeZoneService } from './booking-time-zone.service.js';
import { BookingWriteService } from './booking-write.service.js';
import { BookingResolver } from './graphql/booking.resolver.js';
import { BookingPublicResolver } from './graphql/booking-public.resolver.js';

/**
 * Importing this module IS the registration: the resolver joins the composed
 * schema because the driver walks the container.
 */
@Module({})
export class BookingModule {
  static forRoot(options: BookingModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [
      { provide: BOOKING_OPTIONS, useValue: options },
      BookingTimeZoneService,
      BookingReadService,
      BookingCatalogueService,
      BookingWriteService,
      BookingPublicService,
      BookingEventPublisher,
      // Providers like any service: the runner resolves each from the container by its class.
      BookingUpcomingSessionsProcess,
      BookingLapseRequestsProcess,
    ];
    if (options.prismaProvider) providers.push(options.prismaProvider as Provider);
    if (options.prismaWriteProvider) providers.push(options.prismaWriteProvider as Provider);

    /*
     * ⚠ Every optional port is bound to `undefined` when the host says nothing,
     * rather than left out, so "nobody answered" is a stated configuration and
     * not a property of whatever else the container happens to hold. Each
     * absence has a documented meaning — see `BookingModuleOptions`.
     */
    const optional: Array<[unknown, string]> = [
      [options.limitCheckerProvider, BOOKING_LIMIT_CHECKER],
      [options.workspaceTimeZoneProvider, BOOKING_WORKSPACE_TIME_ZONE],
      [options.memberDirectoryProvider, BOOKING_MEMBER_DIRECTORY],
      [options.notifierProvider, BOOKING_NOTIFIER],
      [options.pubsubProvider, BOOKING_PUBSUB],
    ];
    for (const [provider, token] of optional) {
      providers.push(provider ? (provider as Provider) : { provide: token, useValue: undefined });
    }

    // Two classes on purpose: staff's, scoped to a workspace; and the customer's, public. See each.
    if (options.expose?.graphql ?? true) providers.push(BookingResolver, BookingPublicResolver);

    return {
      module: BookingModule,
      imports: (options.imports ?? []) as NonNullable<DynamicModule['imports']>,
      providers,
      exports: [
        BookingTimeZoneService,
        BookingReadService,
        BookingCatalogueService,
        BookingWriteService,
        BookingPublicService,
        BookingEventPublisher,
        BookingUpcomingSessionsProcess,
        BookingLapseRequestsProcess,
        BOOKING_OPTIONS,
      ],
    };
  }
}
