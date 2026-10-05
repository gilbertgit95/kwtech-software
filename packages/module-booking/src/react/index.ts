/**
 * `@kwtech/module-booking/react` — the web half.
 *
 * A SEPARATE entry point from '.', which stays framework-free. `react` and
 * `@kwtech/web-ui` are optional peers for that reason. Nothing here imports
 * `/server`.
 *
 * ⚠ NAMED exports, never `export *`: part of this barrel is `'use client'`, and
 * a client module does not answer the enumeration `export *` compiles to.
 */

export { BookingApp } from './booking-app.js';
export { type BookingClient, createBookingClient, DEFAULT_GRAPHQL_PATH } from './booking-client.js';
export { createPublicBookingClient, type PublicBookingClient } from './booking-public-client.js';
export { bookingWebModule } from './module.js';
export { ManageBookingPage, type ManageBookingPageProps } from './pages/manage-booking-page.js';
export { PublicBookingPage, type PublicBookingPageProps } from './pages/public-booking-page.js';
export { BOOKING_MANAGE_PATH, BOOKING_PUBLIC_PATH, bookingManageHref, bookingPublicHref } from './routes.js';
