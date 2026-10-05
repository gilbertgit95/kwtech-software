import type { BookingRefusal, BookingResourceKind } from '../types.js';
import { prepareBookingBlock, prepareBookingLine } from './text.js';

/**
 * What can be booked, and who or what performs it (BOOKING-PLAN §2): services,
 * resources, and the workspace's two settings. Validated here, once, for the
 * form and the server alike.
 */

/** In code points. */
export const BOOKING_NAME_MAX = 80;

/** A service runs from five minutes to twelve hours. Longer is not an appointment; it is a shift. */
export const BOOKING_DURATION_MIN_MINUTES = 5;
export const BOOKING_DURATION_MAX_MINUTES = 720;

/** The most time kept clear before or after a booking. */
export const BOOKING_BUFFER_MAX_MINUTES = 240;

/** In the currency's smallest unit, as the point of sale keeps its prices. A million pesos is a typing slip. */
export const BOOKING_PRICE_MAX = 100_000_000;

/**
 * How many services a workspace keeps, archived ones included. A constant, not
 * a plan limit: a service costs a row, and the plan already caps what costs a
 * schedule — the resources (`booking:resources`).
 */
export const BOOKING_SERVICES_MAX = 200;

/** How many resources one service may list. */
export const BOOKING_SERVICE_RESOURCES_MAX = 50;

export const BOOKING_RESOURCE_KINDS = ['staff', 'place', 'equipment'] as const satisfies readonly BookingResourceKind[];

export function isBookingResourceKind(value: string): value is BookingResourceKind {
  return (BOOKING_RESOURCE_KINDS as readonly string[]).includes(value);
}

const isIntegerIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

export interface BookingServiceInput {
  name: string;
  durationMinutes: number;
  bufferBeforeMinutes?: number | null | undefined;
  bufferAfterMinutes?: number | null | undefined;
  /** Null: no price shown. */
  price?: number | null | undefined;
  /** The resources that can perform it. */
  resourceIds: readonly string[];
}

export interface PreparedBookingService {
  name: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  price: number | null;
  resourceIds: string[];
}

/**
 * A service as it will be stored. Its resources are checked for SHAPE here
 * (ids, no duplicates, not too many); that each one is a live resource of this
 * workspace is the service's check, which can read them.
 *
 * A service may list NO resources: it is then set up and cannot be booked yet,
 * and the screen says so. Refusing would make a shop create its resources
 * before it may write down what it offers.
 */
export function prepareBookingService(
  input: BookingServiceInput,
): { service: PreparedBookingService } | { refused: BookingRefusal } {
  const name = prepareBookingLine(input.name, BOOKING_NAME_MAX);
  if (name === null) return { refused: 'invalid_name' };
  if (!isIntegerIn(input.durationMinutes, BOOKING_DURATION_MIN_MINUTES, BOOKING_DURATION_MAX_MINUTES)) {
    return { refused: 'invalid_duration' };
  }
  const bufferBeforeMinutes = input.bufferBeforeMinutes ?? 0;
  const bufferAfterMinutes = input.bufferAfterMinutes ?? 0;
  if (
    !isIntegerIn(bufferBeforeMinutes, 0, BOOKING_BUFFER_MAX_MINUTES) ||
    !isIntegerIn(bufferAfterMinutes, 0, BOOKING_BUFFER_MAX_MINUTES)
  ) {
    return { refused: 'invalid_buffer' };
  }
  const price = input.price ?? null;
  if (price !== null && !isIntegerIn(price, 0, BOOKING_PRICE_MAX)) return { refused: 'invalid_price' };

  const resourceIds = [...new Set(input.resourceIds)];
  const wellFormed = resourceIds.every((id) => typeof id === 'string' && id.length > 0);
  if (!wellFormed || resourceIds.length > BOOKING_SERVICE_RESOURCES_MAX) return { refused: 'invalid_resources' };

  return {
    service: {
      name,
      durationMinutes: input.durationMinutes,
      bufferBeforeMinutes,
      bufferAfterMinutes,
      price,
      resourceIds,
    },
  };
}

export interface BookingResourceInput {
  name: string;
  kind: string;
  /** For a `staff` resource: the member it is, so they can be told of their own bookings. */
  userId?: string | null | undefined;
}

export interface PreparedBookingResource {
  name: string;
  kind: BookingResourceKind;
  userId: string | null;
}

/**
 * A resource as it will be stored.
 *
 * ⚠ ONLY A `staff` RESOURCE IS A PERSON. A member linked to a room or a printer
 * would be told about bookings of a thing, so the link is dropped for the
 * other kinds rather than kept and ignored. Linking is optional even for
 * staff: somebody who is booked need not have an account here.
 */
export function prepareBookingResource(
  input: BookingResourceInput,
): { resource: PreparedBookingResource } | { refused: BookingRefusal } {
  const name = prepareBookingLine(input.name, BOOKING_NAME_MAX);
  if (name === null) return { refused: 'invalid_name' };
  if (!isBookingResourceKind(input.kind)) return { refused: 'invalid_kind' };
  const userId = input.kind === 'staff' && input.userId ? input.userId : null;
  return { resource: { name, kind: input.kind, userId } };
}

/** How far apart the offered start times may be, in minutes. A list, so every choice divides an hour evenly. */
export const BOOKING_SLOT_MINUTES = [5, 10, 15, 20, 30, 60] as const;

/** The longest notice before a booking starts: a day. */
export const BOOKING_REMINDER_MAX_MINUTES = 1440;

/** In code points. What the public page is headed with: the shop's name as customers know it. */
export const BOOKING_PUBLIC_TITLE_MAX = 80;
/** In code points. A few lines under the title: where to find the shop, what to bring. */
export const BOOKING_PUBLIC_NOTE_MAX = 500;

/** The longest notice a workspace may ask of a customer: a week. */
export const BOOKING_LEAD_MAX_MINUTES = 7 * 1440;
/** How far ahead a customer may book at most: a year. */
export const BOOKING_HORIZON_MAX_DAYS = 365;
/** The longest cancellation cutoff: a week before. */
export const BOOKING_CUTOFF_MAX_MINUTES = 7 * 1440;
/** A request waits for staff between an hour and a week before it lapses. */
export const BOOKING_LAPSE_MIN_HOURS = 1;
export const BOOKING_LAPSE_MAX_HOURS = 168;

export interface BookingSettingsValues {
  /** How far apart the offered start times are. */
  slotMinutes: number;
  /** How long before a booking starts staff are told. ⚠ 0 MEANS NO REMINDER. */
  reminderMinutes: number;
  /**
   * Whether customers can book on the public page. ⚠ OFF BY DEFAULT: a
   * workspace that adopted booking for its own desk has not thereby opened a
   * door to the public.
   */
  publicEnabled: boolean;
  /** What the public page is headed with. Required to turn the page on. */
  publicTitle: string;
  /** A few lines under it. May be empty. */
  publicNote: string;
  /** The least notice a customer must give, in minutes. */
  leadMinutes: number;
  /** How far ahead a customer may book, in days. */
  horizonDays: number;
  /** Until how long before its start a customer may cancel or move a booking themselves, in minutes. */
  cutoffMinutes: number;
  /** How long a request waits for staff before it lapses, in hours. */
  lapseHours: number;
}

/**
 * Some settings to change, as they arrive over the wire: a field left out, or
 * sent as null, is left as it is.
 */
export type BookingSettingsPatch = { [K in keyof BookingSettingsValues]?: BookingSettingsValues[K] | null | undefined };

/** What a workspace that has set nothing gets. */
export const BOOKING_DEFAULT_SETTINGS: BookingSettingsValues = {
  slotMinutes: 30,
  reminderMinutes: 15,
  publicEnabled: false,
  publicTitle: '',
  publicNote: '',
  leadMinutes: 60,
  horizonDays: 30,
  cutoffMinutes: 120,
  lapseHours: 24,
};

/** Settings as they will be stored, or a refusal. */
export function prepareBookingSettings(
  input: BookingSettingsValues,
): { settings: BookingSettingsValues } | { refused: BookingRefusal } {
  if (!(BOOKING_SLOT_MINUTES as readonly number[]).includes(input.slotMinutes)) return { refused: 'invalid_settings' };
  if (!isIntegerIn(input.reminderMinutes, 0, BOOKING_REMINDER_MAX_MINUTES)) return { refused: 'invalid_settings' };
  if (!isIntegerIn(input.leadMinutes, 0, BOOKING_LEAD_MAX_MINUTES)) return { refused: 'invalid_settings' };
  if (!isIntegerIn(input.horizonDays, 1, BOOKING_HORIZON_MAX_DAYS)) return { refused: 'invalid_settings' };
  if (!isIntegerIn(input.cutoffMinutes, 0, BOOKING_CUTOFF_MAX_MINUTES)) return { refused: 'invalid_settings' };
  if (!isIntegerIn(input.lapseHours, BOOKING_LAPSE_MIN_HOURS, BOOKING_LAPSE_MAX_HOURS)) {
    return { refused: 'invalid_settings' };
  }
  if (typeof input.publicEnabled !== 'boolean') return { refused: 'invalid_settings' };

  const publicTitle = prepareBookingLine(input.publicTitle, BOOKING_PUBLIC_TITLE_MAX, { allowEmpty: true });
  // ⚠ A page with no name cannot be turned on: a customer must know whose page they are booking on.
  if (publicTitle === null || (input.publicEnabled && publicTitle === '')) return { refused: 'invalid_title' };
  const publicNote = prepareBookingBlock(input.publicNote, BOOKING_PUBLIC_NOTE_MAX);
  if (publicNote === null) return { refused: 'invalid_settings' };

  return {
    settings: {
      slotMinutes: input.slotMinutes,
      reminderMinutes: input.reminderMinutes,
      publicEnabled: input.publicEnabled,
      publicTitle,
      publicNote,
      leadMinutes: input.leadMinutes,
      horizonDays: input.horizonDays,
      cutoffMinutes: input.cutoffMinutes,
      lapseHours: input.lapseHours,
    },
  };
}

/**
 * Stored settings, or the defaults — and a stored value no longer on offer
 * reads back as its default, FIELD BY FIELD, so a release that drops a slot
 * size cannot leave a workspace offering no slots at all, and cannot switch
 * its public page off or on either.
 */
export function normalizeBookingSettings(row: Partial<BookingSettingsValues> | null): BookingSettingsValues {
  const merged = { ...BOOKING_DEFAULT_SETTINGS };
  if (!row) return merged;
  const keys = Object.keys(BOOKING_DEFAULT_SETTINGS) as (keyof BookingSettingsValues)[];
  // ⚠ `publicEnabled` LAST: it is only valid beside a title, so the title has to be in place before it is tried.
  const ordered = [...keys.filter((key) => key !== 'publicEnabled'), 'publicEnabled' as const];
  for (const key of ordered) {
    if (row[key] === undefined || row[key] === null) continue;
    const candidate = { ...merged, [key]: row[key] };
    const prepared = prepareBookingSettings(candidate);
    if (!('refused' in prepared)) Object.assign(merged, prepared.settings);
  }
  return merged;
}
