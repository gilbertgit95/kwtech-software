import type { ModuleRouteProps, WebModuleDescriptor } from '@kwtech/module-kit';
import { BOOKING_FEATURE, BOOKING_FEATURE_REGISTRY, BOOKING_LIMIT_REGISTRY } from '../feature-keys.js';
import { BookingApp } from './booking-app.js';
import { ManageBookingPage } from './pages/manage-booking-page.js';
import { PublicBookingPage } from './pages/public-booking-page.js';
import { BOOKING_MANAGE_PATH, BOOKING_PUBLIC_PATH } from './routes.js';

// Thin adapters: a route hands over what its `:segments` captured, and the page takes plain props.
function PublicBookingRoute({ params }: ModuleRouteProps) {
  return <PublicBookingPage params={params ?? {}} />;
}

function ManageBookingRoute({ params }: ModuleRouteProps) {
  return <ManageBookingPage params={params ?? {}} />;
}

/**
 * The booking web descriptor — its app and its keys, as data the web app
 * composes:
 *
 *   const FEATURE_MODULES = [..., bookingWebModule()];
 *
 * A function, as `queueWebModule` is, so options can arrive without changing
 * the call site.
 *
 * ⚠ NO DRAWER ENTRY, and no route for STAFF. A sub-app is reached from the
 * workspace's Apps page; a full-page route for direct links to one booking (a
 * notification, a bookmark) is not built — the same gap as notes' and tasks',
 * PLAN §12.80.
 *
 * Its two routes are the CUSTOMER's (BOOKING-PLAN §6): the public booking page
 * and the manage link.
 */
export function bookingWebModule(): WebModuleDescriptor {
  return {
    key: 'booking',
    features: BOOKING_FEATURE_REGISTRY,
    limits: BOOKING_LIMIT_REGISTRY,
    apps: [
      {
        // ⚠ Saved in people's layouts. Never rename it.
        key: 'booking',
        label: 'Booking',
        description: 'Take bookings for a service at a time: the day’s list, who is with whom, and what is free.',
        icon: 'calendar',
        feature: BOOKING_FEATURE.read,
        // After the queue (10), notes (20), tasks (30), the point of sale (40) and the books (50).
        order: 60,
        component: BookingApp,
      },
    ],
    routes: [
      {
        /*
         * ⚠ PUBLIC: no feature, no nav, and FULLSCREEN chrome. A customer has no
         * account; the link id says which shop, and the API takes a request
         * only while that shop's page is turned on. No shell, because a drawer
         * of things a visitor cannot open is noise.
         */
        path: BOOKING_PUBLIC_PATH,
        component: PublicBookingRoute,
        title: 'Book a time',
        chrome: 'fullscreen',
      },
      {
        /*
         * ⚠ PUBLIC, and the token in the path is the customer's CREDENTIAL for
         * one booking. The API throttles every operation that takes it.
         */
        path: BOOKING_MANAGE_PATH,
        component: ManageBookingRoute,
        title: 'My booking',
        chrome: 'fullscreen',
      },
    ],
  };
}
