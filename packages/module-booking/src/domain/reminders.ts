/**
 * Who is told that a booking is about to start (`booking.upcoming_sessions`).
 *
 *   a STAFF resource linked to a member who still works the desk — that member:
 *     it is their own booking, and nobody else needs the notice;
 *   anything else (a room, a machine, a person with no account, a member who
 *     has left) — everybody at the desk, because somebody has to be ready.
 *
 * ⚠ `desk` IS THE WHOLE AUDIENCE: the active members who work the bookings
 * (`BookingMemberDirectory.listDesk`). Nobody outside it is ever told, linked
 * or not — the notice names the customer. A member who lost the app keeps the
 * link on their resource and stops hearing about it.
 */
export function upcomingSessionRecipients(resourceUserId: string | null, desk: readonly string[]): string[] {
  if (resourceUserId !== null && desk.includes(resourceUserId)) return [resourceUserId];
  return [...new Set(desk)];
}
