import { AVAILABILITIES, type Availability } from '../types.js';

/**
 * What somebody says about themselves, and what anybody else is told.
 *
 * ⚠ PRESENCE IS OBSERVED; AVAILABILITY IS DECLARED. Presence comes from a
 * socket, is ephemeral, and must not survive a restart. Availability is chosen
 * by a person and durable until they change it. Merging them is the standard
 * way this feature goes wrong, and every function here keeps them apart: one
 * takes a row, the other takes both and decides what is published.
 */

/**
 * The order a picker lists them in — most present first, `invisible` last.
 *
 * ⚠ The vocabulary itself is `AVAILABILITIES` in `types.ts`, beside every other
 * enum this module mirrors from its schema. This is the PRESENTATION order, and
 * they are deliberately the same list written once: a second array would drift
 * the day somebody adds a value to one of them.
 */
export const AVAILABILITY_ORDER: readonly Availability[] = AVAILABILITIES;

export function isAvailability(value: unknown): value is Availability {
  return typeof value === 'string' && (AVAILABILITIES as readonly string[]).includes(value);
}

/**
 * The declared value, with an expired one treated as unset.
 *
 * ⚠ AUTO-CLEAR IS DERIVED ON READ, NEVER WRITTEN. "Clears in an hour" is a
 * promise something has to keep, and there is no scheduler in this server
 * (§12.40) — a written `expired` would have nothing to write it, and the row
 * would read `busy` for the rest of the year. So `clearAt` is stored and the
 * comparison happens here, on every read. The same lesson invitation expiry
 * learned with `isAcceptable`.
 *
 * Absent row means `available`: somebody who has never touched this setting is
 * not in a special state, they simply have not said anything.
 */
export function effectiveAvailability(
  row: { availability: Availability; clearAt: Date | null } | null | undefined,
  now: Date,
): Availability {
  if (!row) return 'available';
  if (row.clearAt && row.clearAt.getTime() <= now.getTime()) return 'available';
  return row.availability;
}

/** What one person's state looks like to somebody else. */
export interface PresenceView {
  online: boolean;
  /**
   * Null when there is nothing to say — offline, or hidden. Never `available`
   * as a stand-in for "we are not telling you", which a client would draw as a
   * green dot.
   */
  availability: Availability | null;
}

/**
 * One person's presence as it may be PUBLISHED.
 *
 * ⚠ `invisible` IS APPLIED HERE, AT THE PUBLISH BOUNDARY, and never filtered
 * client-side. A client that receives "she is online, but do not show it" has
 * been told — the information is in the browser, in a payload anybody can read,
 * and the promise the setting makes is already broken. So an invisible person
 * is rendered INDISTINGUISHABLE from an offline one, which is the only version
 * of the promise that is true.
 *
 * ⚠ It suppresses TYPING too. A hidden person whose typing indicator appears
 * has leaked through the side door, and typing is the louder signal of the two:
 * it says not only that somebody is there but that they are writing to you.
 */
export function publishedPresence(availability: Availability, online: boolean): PresenceView {
  if (availability === 'invisible' || !online) return { online: false, availability: null };
  return { online: true, availability };
}

/**
 * Whether this person's typing may be announced at all.
 *
 * The same rule as above, said where the typing path can ask it — so the two
 * cannot drift into disagreeing about what hidden means.
 */
export function mayAnnounceTyping(availability: Availability): boolean {
  return availability !== 'invisible';
}

/**
 * The moment a declared availability stops meaning anything, or null to keep it
 * until it is changed.
 *
 * ⚠ MINUTES IN, A MOMENT OUT. The caller says "for thirty minutes" and this
 * turns it into an instant, because a duration stored in a row starts counting
 * from a `updatedAt` somebody will eventually forget to read. An instant is
 * comparable with nothing but `now`.
 *
 * A non-positive duration is not an error and not "expired immediately": it is
 * somebody who did not ask for a timer.
 */
export function clearAtFrom(minutes: number | null | undefined, now: Date): Date | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  return new Date(now.getTime() + Math.floor(minutes) * 60_000);
}
