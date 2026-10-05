import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { BookingEventChange } from '../domain/events.js';
import { BOOKING_EVENT, type BookingEvent, type BookingPubSub, NULL_BOOKING_PUBSUB } from './booking.pubsub.js';
import type { InScope } from './booking.repository.js';
import { BOOKING_PUBSUB } from './booking.tokens.js';

/**
 * Announcing what just happened in a workspace's bookings.
 *
 * ⚠ AFTER THE COMMIT, NEVER INSIDE IT. A publish inside the transaction would
 * announce a booking that a rollback then undoes.
 *
 * ⚠ AND IT MUST NOT FAIL THE WRITE. The booking was saved; the socket is an
 * enhancement. A pub/sub error that propagated would turn a saved booking into
 * an error, and the retry would be refused as a double booking.
 */
@Injectable()
export class BookingEventPublisher {
  private readonly logger = new Logger('BookingEvents');

  constructor(@Optional() @Inject(BOOKING_PUBSUB) private readonly pubsub?: BookingPubSub) {}

  async changed(
    scope: InScope,
    change: BookingEventChange,
    /** Null: the customer, or the app. */
    actorId: string | null,
    appointmentId: string | null = null,
  ): Promise<void> {
    const event: BookingEvent = {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      change,
      appointmentId,
      actorId,
    };
    try {
      await (this.pubsub ?? NULL_BOOKING_PUBSUB).publish(BOOKING_EVENT.changed, event);
    } catch (error) {
      this.logger.error(`A booking event could not be published: ${(error as Error).message}`);
    }
  }
}
