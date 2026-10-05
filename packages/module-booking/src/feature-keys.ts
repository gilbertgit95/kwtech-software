import type { FeatureContribution, LimitContribution } from '@kwtech/module-kit';

/**
 * What the booking app lets somebody do, and how much of it
 * (docs/BOOKING-PLAN.md §5).
 *
 * ⚠ WORKSPACE LEVEL, like every sub-app's: an app always lives under a
 * workspace, and the Apps page asks the key of the workspace in the URL. A
 * workspace key is also FILTERED BY THE PLAN, so a key no plan entitles is a
 * key nobody can use.
 *
 * Keys are ATOMIC and split by RISK: seeing the day; working the bookings;
 * cancelling one, which undoes a promise made to a customer; setting up what
 * can be booked; and the workspace's rules.
 */
export const BOOKING_FEATURE = {
  /** Open the app; see the day, the bookings and their history, the services, resources and free times. */
  read: 'booking:read',
  /** Make a booking, move it, correct its details, confirm or decline a request, mark arrived, done or no-show. */
  manageAppointments: 'booking:manage_appointments',
  /** Cancel a booking, with a reason. Its own key: cancelling is the higher-risk act. */
  cancelAppointments: 'booking:cancel_appointments',
  /** Services, resources, their opening hours and closed days. */
  manageServices: 'booking:manage_services',
  /** The workspace's booking rules. */
  manageSettings: 'booking:manage_settings',
} as const;

export type BookingFeatureKey = (typeof BOOKING_FEATURE)[keyof typeof BOOKING_FEATURE];

const op = (identifier: string) => ({ surface: 'graphql_operation', identifier });

/**
 * Contributed to the app's composed registry (`seed/registry.ts`).
 *
 * ⚠ THE BINDINGS ARE THE GUARD. This module cannot use `@RequireFeature` — the
 * decorator belongs to `module-permissions`, and a module may not import a
 * module (§9) — so `FeatureGuard` enforces each operation through its binding.
 * A missing binding is an UNGUARDED OPERATION, which is why
 * `surface-coverage.test.ts` fails on any operation that is not bound here.
 */
export const BOOKING_FEATURE_REGISTRY: readonly FeatureContribution[] = [
  {
    key: BOOKING_FEATURE.read,
    module: 'booking',
    level: 'workspace',
    label: 'See bookings',
    description: 'Open the booking app, and see the day, each booking and its history, and what can be booked when.',
    tags: ['booking'],
    bindings: [
      op('Query.bookingCatalogue'),
      op('Query.bookingExceptions'),
      op('Query.bookingDay'),
      op('Query.bookingAppointment'),
      // Every request waiting for staff, whatever day it is for.
      op('Query.bookingRequests'),
      op('Query.bookingSlots'),
      op('Query.bookingSettings'),
      /*
       * ⚠ ITS OWN SURFACE. A subscription is authorised ONCE, here, and then
       * streams — filtered per subscriber to their own workspace.
       */
      { surface: 'graphql_subscription', identifier: 'Subscription.bookingEvents' },
    ],
  },
  {
    key: BOOKING_FEATURE.manageAppointments,
    module: 'booking',
    level: 'workspace',
    label: 'Work with bookings',
    description:
      'Make a booking, move it to another time, correct its details, confirm or decline a request, and mark a customer as arrived, done or a no-show.',
    tags: ['booking'],
    bindings: [
      op('Mutation.createBookingAppointment'),
      op('Mutation.rescheduleBookingAppointment'),
      op('Mutation.updateBookingAppointmentDetails'),
      op('Mutation.confirmBookingAppointment'),
      op('Mutation.declineBookingAppointment'),
      op('Mutation.markBookingAppointment'),
    ],
  },
  {
    key: BOOKING_FEATURE.cancelAppointments,
    module: 'booking',
    /*
     * ⚠ PRIVILEGED because it undoes a promise made to a customer, and the app
     * cannot tell them (BOOKING-PLAN §8, D3 with D7): whoever cancels has to
     * make the call themselves.
     */
    isPrivileged: true,
    level: 'workspace',
    label: 'Cancel bookings',
    description: 'Cancel a booking, with a reason. The booking is kept, with who cancelled it and why.',
    tags: ['booking'],
    bindings: [op('Mutation.cancelBookingAppointment')],
  },
  {
    key: BOOKING_FEATURE.manageServices,
    module: 'booking',
    level: 'workspace',
    label: 'Set up services and resources',
    description:
      'Add and change what can be booked, the staff, places and equipment that perform it, and their opening hours and closed days.',
    tags: ['booking'],
    bindings: [
      /*
       * Who a staff resource may be linked to. Bound here, not to
       * `booking:read`: somebody who only reads the day has no reason to read
       * the workspace's member list.
       */
      op('Query.bookingMembers'),
      op('Mutation.saveBookingService'),
      op('Mutation.setBookingServiceArchived'),
      op('Mutation.saveBookingResource'),
      op('Mutation.setBookingResourceArchived'),
      op('Mutation.setBookingResourceHours'),
      op('Mutation.addBookingException'),
      op('Mutation.removeBookingException'),
    ],
  },
  {
    key: BOOKING_FEATURE.manageSettings,
    module: 'booking',
    level: 'workspace',
    label: 'Change booking settings',
    description:
      'Set how far apart the offered times are and when staff are reminded, and turn the public booking page on or off with its rules for customers.',
    tags: ['booking'],
    // Resetting the link retires the address customers were given: the same key as turning the page on or off.
    bindings: [op('Mutation.saveBookingSettings'), op('Mutation.resetBookingPublicLink')],
  },
];

export const BOOKING_LIMIT = {
  /** How many live resources a workspace may have. */
  resources: 'booking:resources',
} as const;

/**
 * The cap, PLAN-SOURCED — every `booking:*` key is workspace level, so an
 * organization's subscription is there to read — and COUNTED PER WORKSPACE:
 * a resource belongs to the shop, not to whoever added it.
 *
 * ⚠ LIVE RESOURCES ONLY, as the queue counts its windows. An archived resource
 * can take no booking, so it costs the plan nothing; restoring one is checked
 * against the cap again, or archive-and-restore would be the way round it.
 *
 * The module counts, in the transaction that inserts; the host's `LimitChecker`
 * only resolves the number (`LimitCheckInput.current`).
 */
export const BOOKING_LIMIT_REGISTRY: readonly LimitContribution[] = [
  {
    key: BOOKING_LIMIT.resources,
    module: 'booking',
    label: 'Bookable resources',
    description:
      'How many staff, places and pieces of equipment, not counting archived ones, a workspace may take bookings for.',
    source: 'plan',
    countedOver: 'workspace',
    required: false,
    defaultValue: 10,
  },
];

/**
 * A workspace role a host MAY create, exported as data and never seeded by this
 * module. The app's `seed/app-roles.ts` reads it.
 */
export interface BookingRolePreset {
  key: string;
  label: string;
  icon: string;
  level: 'workspace';
  features: readonly BookingFeatureKey[];
}

export const BOOKING_ROLE_PRESETS: readonly BookingRolePreset[] = [
  {
    // Works the day: takes bookings, moves them, cancels them, marks who came.
    key: 'booking-front-desk',
    label: 'Booking front desk',
    icon: 'calendar',
    level: 'workspace',
    features: [BOOKING_FEATURE.read, BOOKING_FEATURE.manageAppointments, BOOKING_FEATURE.cancelAppointments],
  },
  {
    // And decides what can be booked, when, and by which rules.
    key: 'booking-manager',
    label: 'Booking manager',
    icon: 'calendar',
    level: 'workspace',
    features: [
      BOOKING_FEATURE.read,
      BOOKING_FEATURE.manageAppointments,
      BOOKING_FEATURE.cancelAppointments,
      BOOKING_FEATURE.manageServices,
      BOOKING_FEATURE.manageSettings,
    ],
  },
];
