'use client';

import { BOOKING_OPERATIONS } from '../operations.js';
import { DEFAULT_GRAPHQL_PATH } from './booking-client.js';

/** The documents a CUSTOMER's page sends. None carries a workspace: the link id or the manage token is all there is. */
export type PublicBookingOperation =
  | 'publicBookingPage'
  | 'publicBookingSlots'
  | 'requestPublicBooking'
  | 'publicBooking'
  | 'publicBookingMoveSlots'
  | 'cancelPublicBooking'
  | 'reschedulePublicBooking';

export interface PublicServiceView {
  id: string;
  name: string;
  durationMinutes: number;
  /** Centavos. Null: no price shown. */
  price: number | null;
}

export interface PublicPageView {
  title: string;
  note: string;
  /** The shop's zone. Check it (`publicTimeZone`) before printing in it. */
  timeZone: string;
  today: string;
  lastDay: string;
  cutoffMinutes: number;
  services: PublicServiceView[];
}

export interface PublicSlotsView {
  resourceId: string;
  resourceName: string;
  starts: string[];
}

export interface PublicBookingView {
  title: string;
  note: string;
  timeZone: string;
  today: string;
  lastDay: string;
  cutoffMinutes: number;
  serviceId: string;
  serviceName: string;
  resourceId: string;
  resourceName: string;
  startsAt: string;
  endsAt: string;
  status: string;
  customerName: string;
  reason: string;
  canChange: boolean;
}

export interface PublicRequestInput {
  serviceId: string;
  resourceId: string;
  startsAt: string;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  note: string;
}

/** One method per operation. Every error is a sentence for a customer. */
export interface PublicBookingClient {
  /** Null: no such page, or it is not taking bookings. */
  page(linkId: string): Promise<PublicPageView | null>;
  slots(linkId: string, serviceId: string, day: string): Promise<PublicSlotsView[] | null>;
  /** ⚠ `manageToken` comes back this once. */
  request(linkId: string, input: PublicRequestInput): Promise<{ manageToken: string; booking: PublicBookingView }>;
  /** Null: no booking for that link. */
  booking(token: string): Promise<PublicBookingView | null>;
  moveSlots(token: string, day: string): Promise<PublicSlotsView[] | null>;
  cancel(token: string, reason: string | null): Promise<PublicBookingView>;
  reschedule(token: string, startsAt: string, resourceId: string): Promise<PublicBookingView>;
}

const TOO_MANY_TRIES = 'Too many tries in a short time. Wait a minute and try again.';

/**
 * How a customer's page reaches the API: the same same-origin route handler
 * staff use, which forwards a request with no session as it is. The public
 * operations ask for none.
 */
export function createPublicBookingClient(options: { graphqlPath?: string } = {}): PublicBookingClient {
  const path = options.graphqlPath ?? DEFAULT_GRAPHQL_PATH;

  async function call<T>(operation: PublicBookingOperation, variables: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ query: BOOKING_OPERATIONS[operation], variables }),
        cache: 'no-store',
      });
    } catch {
      throw new Error('We could not reach the server, so nothing was sent. Check your connection and try again.');
    }
    // The tight limit on the manage link. Said plainly, so nobody keeps pressing.
    if (response.status === 429) throw new Error(TOO_MANY_TRIES);
    if (!response.ok) throw new Error('We could not reach the server. Try again in a moment.');
    const body = (await response.json()) as { data?: Record<string, unknown>; errors?: { message: string }[] };
    if (body.errors?.length) {
      const message = body.errors[0]?.message ?? 'That could not be done.';
      // ⚠ Over GraphQL the limit arrives as an error with status 200 and the throttler's own words
      // ("ThrottlerException: Too Many Requests", seen against the API on 2026-10-05), not as a 429.
      throw new Error(/too many requests/iu.test(message) ? TOO_MANY_TRIES : message);
    }
    if (!body.data || !(operation in body.data)) throw new Error('The server returned no data.');
    return body.data[operation] as T;
  }

  return {
    page: (linkId) => call('publicBookingPage', { linkId }),
    slots: (linkId, serviceId, day) => call('publicBookingSlots', { linkId, serviceId, day }),
    request: (linkId, input) => call('requestPublicBooking', { linkId, input }),
    booking: (token) => call('publicBooking', { token }),
    moveSlots: (token, day) => call('publicBookingMoveSlots', { token, day }),
    cancel: (token, reason) => call('cancelPublicBooking', { token, reason }),
    reschedule: (token, startsAt, resourceId) => call('reschedulePublicBooking', { token, startsAt, resourceId }),
  };
}
