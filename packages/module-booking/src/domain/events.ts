/**
 * Who hears about a change in the booking app, and as what.
 *
 * Every booking in a workspace is open to everybody holding `booking:read`
 * there — there is no private booking — so the filter is the WORKSPACE alone.
 * The subscription is authorised once, by its binding to that key.
 */

/**
 * What changed.
 *
 *   appointment — a booking: made, moved, cancelled, marked
 *   catalogue   — services, resources, hours or exceptions (so the slots did too)
 *   settings    — the workspace's booking settings
 */
export type BookingEventChange = 'appointment' | 'catalogue' | 'settings';

/** The facts a delivery decision reads. */
export interface BookingEventFacts {
  organizationId: string;
  workspaceId: string;
  change: BookingEventChange;
}

/** Who is listening, on which workspace. */
export interface BookingEventViewer {
  organizationId: string;
  workspaceId: string;
}

/** What the viewer is told to read again, or null: this workspace is not theirs to hear about. */
export function bookingEventFor(event: BookingEventFacts, viewer: BookingEventViewer): BookingEventChange | null {
  if (event.organizationId !== viewer.organizationId || event.workspaceId !== viewer.workspaceId) return null;
  return event.change;
}
