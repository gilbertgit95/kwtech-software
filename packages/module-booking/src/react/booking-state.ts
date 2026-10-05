'use client';

import type { BookingCatalogueView, BookingClient, BookingScopeView } from './booking-client.js';
import type { BookingData } from './use-booking-data.js';

/**
 * What every section of the app is handed: where it is, how it reaches the API,
 * what can be booked, and what the viewer may do.
 */
export interface BookingAppState {
  scope: BookingScopeView;
  client: BookingClient;
  /** ⚠ The WORKSPACE's zone. Every time and every "today" on screen is printed in it. */
  timeZone: string;
  /** The LIVE services and resources — what a booking can be made of. */
  catalogue: BookingData<BookingCatalogueView>;
  /** Hiding is cosmetic: the API authorises every request again. */
  can: {
    manageAppointments: boolean;
    cancelAppointments: boolean;
    manageServices: boolean;
    manageSettings: boolean;
  };
}
