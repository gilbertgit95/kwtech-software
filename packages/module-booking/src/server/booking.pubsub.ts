import type { BookingEventChange } from '../domain/events.js';

/**
 * The narrow slice of a pub/sub engine booking needs — declared structurally,
 * never imported. A deliberate duplicate of the tasks', queue's and chat's
 * ports: importing any would make booking depend on another module. The app's
 * one engine satisfies them all.
 */
export interface BookingPubSub {
  publish(trigger: string, payload: unknown): Promise<void>;
  asyncIterableIterator<T>(triggers: string | readonly string[]): AsyncIterableIterator<T>;
}

/**
 * The one trigger, for every workspace. Each event carries its workspace, and
 * every subscriber filters (`bookingEventFor`).
 */
export const BOOKING_EVENT = {
  changed: 'booking.changed',
} as const;

/**
 * One change, as it travels.
 *
 * ⚠ IDS AND FACTS, NEVER CONTENT. No customer's name, phone or note: the client
 * reads again through the guarded queries. So a filtering mistake can at worst
 * tell somebody an id changed, never who booked.
 *
 * JSON-safe: with Redis behind the engine a payload is JSON on the way through.
 */
export interface BookingEvent {
  organizationId: string;
  workspaceId: string;
  change: BookingEventChange;
  /** The booking it concerns, for `appointment`. */
  appointmentId: string | null;
  /** Who did it, so a client can tell its own change coming back. Null: the customer, or the app. */
  actorId: string | null;
}

/**
 * A no-op engine, for a host that mounts booking without subscriptions.
 * Subscribing returns a stream that ENDS rather than one that hangs.
 */
export const NULL_BOOKING_PUBSUB: BookingPubSub = {
  async publish() {
    // Deliberately nothing.
  },
  async *asyncIterableIterator<T>(): AsyncIterableIterator<T> {
    // Deliberately empty.
  },
};
