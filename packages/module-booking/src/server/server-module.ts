import type { ProcessContribution, ServerModuleDescriptor } from '@kwtech/module-kit';
import { BOOKING_FEATURE_REGISTRY, BOOKING_LIMIT_REGISTRY } from '../feature-keys.js';
import { BOOKING_PROCESS, BOOKING_PROCESS_REGISTRY } from '../processes.js';
import { BookingModule } from './booking.module.js';
import type { BookingModuleOptions } from './booking.options.js';
import { BookingLapseRequestsProcess } from './booking-lapse.process.js';
import { BookingUpcomingSessionsProcess } from './booking-reminder.process.js';

/**
 * Which class runs each declared process. ⚠ Keyed by the declaration's key, and
 * `bookingProcesses` throws on a declaration with no entry here: a process that
 * is listed on the admin screen and can never run is worse than a failed boot.
 */
const BOOKING_PROCESS_HANDLERS: Record<string, unknown> = {
  [BOOKING_PROCESS.upcomingSessions]: BookingUpcomingSessionsProcess,
  [BOOKING_PROCESS.lapseRequests]: BookingLapseRequestsProcess,
};

function bookingProcesses(): ProcessContribution[] {
  return BOOKING_PROCESS_REGISTRY.map((declaration) => {
    const handler = BOOKING_PROCESS_HANDLERS[declaration.key];
    if (!handler) {
      throw new Error(
        `Process '${declaration.key}' has no handler. Add it to BOOKING_PROCESS_HANDLERS in server-module.ts.`,
      );
    }
    return { ...declaration, handler };
  });
}

/**
 * Booking as DATA the host composes: listed in `SERVER_MODULES`, and its
 * resolver, keys, cap and background process arrive with it.
 *
 * ⚠ The keys and the cap must ALSO be composed in the app's `seed/registry.ts`.
 * An uncomposed registry means the bindings never load — every booking
 * operation reachable by anybody signed in — and the cap is never mirrored for
 * plans. The same goes for `BOOKING_PROCESS_REGISTRY`: unsynced, the reminders
 * never run.
 */
export function bookingServerModule(options: BookingModuleOptions = {}): ServerModuleDescriptor {
  return {
    key: 'booking',
    nestModule: BookingModule.forRoot(options),
    features: BOOKING_FEATURE_REGISTRY,
    limits: BOOKING_LIMIT_REGISTRY,
    processes: bookingProcesses(),
  };
}
