import { Field, InputType, Int, ObjectType } from '@nestjs/graphql';

/*
 * The booking GraphQL shapes. Code-first, rendered from rows by the resolver's
 * `render*` functions. Kinds and statuses cross as documented STRINGS (no
 * `registerEnumType`), days as `YYYY-MM-DD`, moments as ISO strings, opening
 * hours as minutes of the workspace's day, and a price in the currency's
 * smallest unit.
 */

@ObjectType('BookingPerson')
export class BookingPersonType {
  @Field()
  userId!: string;

  @Field()
  displayName!: string;
}

@ObjectType('BookingService')
export class BookingServiceType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  @Field(() => Int)
  durationMinutes!: number;

  /** Time kept clear on the resource before and after a booking. */
  @Field(() => Int)
  bufferBeforeMinutes!: number;

  @Field(() => Int)
  bufferAfterMinutes!: number;

  /** In the currency's smallest unit. Null: no price shown. */
  @Field(() => Int, { nullable: true })
  price!: number | null;

  /** The resources that can perform it. None: it cannot be booked yet. */
  @Field(() => [String])
  resourceIds!: string[];

  @Field(() => String, { nullable: true })
  archivedAt!: string | null;
}

/** One stretch of a resource's week, `[startMinute, endMinute)` in minutes of the workspace's day. */
@ObjectType('BookingHoursWindow')
export class BookingHoursWindowType {
  /** 0 is Sunday. */
  @Field(() => Int)
  weekday!: number;

  @Field(() => Int)
  startMinute!: number;

  @Field(() => Int)
  endMinute!: number;
}

@ObjectType('BookingResource')
export class BookingResourceType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  /** `staff`, `place` or `equipment`. */
  @Field()
  kind!: string;

  /** For a `staff` resource: the member it is. */
  @Field(() => String, { nullable: true })
  userId!: string | null;

  /** Null when nobody is linked, or the app cannot name them — a former member. */
  @Field(() => String, { nullable: true })
  userName!: string | null;

  @Field(() => [BookingHoursWindowType])
  hours!: BookingHoursWindowType[];

  @Field(() => String, { nullable: true })
  archivedAt!: string | null;
}

@ObjectType('BookingCatalogue')
export class BookingCatalogueType {
  @Field(() => [BookingServiceType])
  services!: BookingServiceType[];

  @Field(() => [BookingResourceType])
  resources!: BookingResourceType[];
}

/** A closed day, or a closed stretch of one. */
@ObjectType('BookingException')
export class BookingExceptionType {
  @Field()
  id!: string;

  /** Null: every resource of the workspace. */
  @Field(() => String, { nullable: true })
  resourceId!: string | null;

  /** `YYYY-MM-DD`, a day of the workspace. */
  @Field()
  day!: string;

  /** Null with `endMinute`: the whole day. */
  @Field(() => Int, { nullable: true })
  startMinute!: number | null;

  @Field(() => Int, { nullable: true })
  endMinute!: number | null;

  @Field()
  note!: string;
}

@ObjectType('BookingSettings')
export class BookingSettingsType {
  /** How far apart the offered start times are, in minutes. */
  @Field(() => Int)
  slotMinutes!: number;

  /** How long before a booking starts staff are told. 0: no reminder. */
  @Field(() => Int)
  reminderMinutes!: number;

  /** Whether customers can book on the public page. */
  @Field()
  publicEnabled!: boolean;

  /** The public page is at `/book/<publicLinkId>`. Null until it has been turned on once. */
  @Field(() => String, { nullable: true })
  publicLinkId!: string | null;

  /** What the public page is headed with, and a few lines under it. */
  @Field()
  publicTitle!: string;

  @Field()
  publicNote!: string;

  /** The least notice a customer must give, in minutes. */
  @Field(() => Int)
  leadMinutes!: number;

  /** How far ahead a customer may book, in days. */
  @Field(() => Int)
  horizonDays!: number;

  /** Until how long before its start a customer may cancel or move a booking themselves, in minutes. */
  @Field(() => Int)
  cutoffMinutes!: number;

  /** How long a request waits for staff before it lapses, in hours. */
  @Field(() => Int)
  lapseHours!: number;
}

@ObjectType('BookingAppointment')
export class BookingAppointmentType {
  @Field()
  id!: string;

  @Field()
  serviceId!: string;

  @Field()
  serviceName!: string;

  @Field()
  resourceId!: string;

  @Field()
  resourceName!: string;

  /** ISO instants. Print them in the workspace's zone. */
  @Field()
  startsAt!: string;

  @Field()
  endsAt!: string;

  /** `pending`, `confirmed`, `declined`, `arrived`, `done`, `cancelled` or `no_show`. */
  @Field()
  status!: string;

  @Field()
  customerName!: string;

  @Field(() => String, { nullable: true })
  customerPhone!: string | null;

  @Field(() => String, { nullable: true })
  customerEmail!: string | null;

  @Field()
  note!: string;

  /** The member of staff who made it. Null: the customer, on the public link. */
  @Field(() => String, { nullable: true })
  createdById!: string | null;

  @Field(() => String, { nullable: true })
  createdByName!: string | null;

  @Field()
  createdAt!: string;

  @Field()
  updatedAt!: string;
}

/** One entry of a booking's history. */
@ObjectType('BookingChange')
export class BookingChangeType {
  @Field()
  id!: string;

  /** `created`, `confirmed`, `declined`, `rescheduled`, `cancelled`, `arrived`, `done`, `no_show` or `details`. */
  @Field()
  kind!: string;

  /** `staff`, `customer` or `system` (a request that lapsed). */
  @Field()
  actorKind!: string;

  @Field(() => String, { nullable: true })
  actorId!: string | null;

  /** Null for the customer, and for a member the app cannot name. */
  @Field(() => String, { nullable: true })
  actorName!: string | null;

  /** For `rescheduled`: where it moved from and to. */
  @Field(() => String, { nullable: true })
  fromStartsAt!: string | null;

  @Field(() => String, { nullable: true })
  toStartsAt!: string | null;

  @Field(() => String, { nullable: true })
  fromResourceName!: string | null;

  @Field(() => String, { nullable: true })
  toResourceName!: string | null;

  @Field()
  reason!: string;

  @Field()
  createdAt!: string;
}

@ObjectType('BookingAppointmentDetail')
export class BookingAppointmentDetailType extends BookingAppointmentType {
  /** Oldest first. */
  @Field(() => [BookingChangeType])
  changes!: BookingChangeType[];
}

@ObjectType('BookingDay')
export class BookingDayType {
  /** `YYYY-MM-DD`. */
  @Field()
  day!: string;

  /** The workspace's zone, in which the day was cut. */
  @Field()
  timeZone!: string;

  @Field(() => [BookingAppointmentType])
  appointments!: BookingAppointmentType[];

  /** More bookings start that day than one read returns. */
  @Field()
  truncated!: boolean;
}

/** The starts one resource can still take on a day, as ISO instants in order. */
@ObjectType('BookingResourceSlots')
export class BookingResourceSlotsType {
  @Field()
  resourceId!: string;

  @Field(() => [String])
  starts!: string[];
}

/**
 * Something changed; read again. `sync` on every (re)subscribe; otherwise what
 * changed: `appointment`, `catalogue` or `settings`.
 */
@ObjectType('BookingEvent')
export class BookingEventType {
  @Field()
  kind!: string;

  @Field(() => String, { nullable: true })
  appointmentId!: string | null;

  @Field(() => String, { nullable: true })
  actorId!: string | null;
}

// ── inputs ──────────────────────────────────────────────────────────────────

@InputType('BookingServiceInput')
export class BookingServiceInputType {
  @Field()
  name!: string;

  @Field(() => Int)
  durationMinutes!: number;

  @Field(() => Int, { nullable: true })
  bufferBeforeMinutes?: number | null;

  @Field(() => Int, { nullable: true })
  bufferAfterMinutes?: number | null;

  @Field(() => Int, { nullable: true })
  price?: number | null;

  /** The resources that can perform it — the whole list, replacing what was there. */
  @Field(() => [String])
  resourceIds!: string[];
}

@InputType('BookingResourceInput')
export class BookingResourceInputType {
  @Field()
  name!: string;

  /** `staff`, `place` or `equipment`. */
  @Field()
  kind!: string;

  /** For a `staff` resource: the member it is. Ignored for the other kinds. */
  @Field(() => String, { nullable: true })
  userId?: string | null;
}

@InputType('BookingHoursWindowInput')
export class BookingHoursWindowInputType {
  @Field(() => Int)
  weekday!: number;

  @Field(() => Int)
  startMinute!: number;

  @Field(() => Int)
  endMinute!: number;
}

@InputType('BookingExceptionInput')
export class BookingExceptionInputType {
  /** Omitted: every resource of the workspace. */
  @Field(() => String, { nullable: true })
  resourceId?: string | null;

  @Field()
  day!: string;

  /** Both omitted: the whole day. */
  @Field(() => Int, { nullable: true })
  startMinute?: number | null;

  @Field(() => Int, { nullable: true })
  endMinute?: number | null;

  @Field(() => String, { nullable: true })
  note?: string | null;
}

/** Only what is given changes. */
@InputType('BookingSettingsInput')
export class BookingSettingsInputType {
  @Field(() => Int, { nullable: true })
  slotMinutes?: number | null;

  @Field(() => Int, { nullable: true })
  reminderMinutes?: number | null;

  @Field(() => Boolean, { nullable: true })
  publicEnabled?: boolean | null;

  @Field(() => String, { nullable: true })
  publicTitle?: string | null;

  @Field(() => String, { nullable: true })
  publicNote?: string | null;

  @Field(() => Int, { nullable: true })
  leadMinutes?: number | null;

  @Field(() => Int, { nullable: true })
  horizonDays?: number | null;

  @Field(() => Int, { nullable: true })
  cutoffMinutes?: number | null;

  @Field(() => Int, { nullable: true })
  lapseHours?: number | null;
}

@InputType('BookingAppointmentDetailsInput')
export class BookingAppointmentDetailsInputType {
  @Field()
  customerName!: string;

  @Field(() => String, { nullable: true })
  customerPhone?: string | null;

  @Field(() => String, { nullable: true })
  customerEmail?: string | null;

  @Field(() => String, { nullable: true })
  note?: string | null;
}

@InputType('BookingAppointmentInput')
export class BookingAppointmentInputType extends BookingAppointmentDetailsInputType {
  @Field()
  serviceId!: string;

  @Field()
  resourceId!: string;

  /** An ISO instant with its zone, on a whole minute. */
  @Field()
  startsAt!: string;
}

// ── the public page ─────────────────────────────────────────────────────────
//
// ⚠ What a VISITOR is sent. No ids of the workspace or organization, no member's
// name, nothing about anybody else's booking.

/** A service as a customer chooses it. */
@ObjectType('BookingPublicService')
export class BookingPublicServiceType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  @Field(() => Int)
  durationMinutes!: number;

  @Field(() => Int, { nullable: true })
  price!: number | null;
}

@ObjectType('BookingPublicPage')
export class BookingPublicPageType {
  @Field()
  title!: string;

  @Field()
  note!: string;

  /** The workspace's zone. Check it with `isValidTimeZone` before printing in it. */
  @Field()
  timeZone!: string;

  /** The workspace's today and the last day that can be booked, `YYYY-MM-DD`. */
  @Field()
  today!: string;

  @Field()
  lastDay!: string;

  @Field(() => Int)
  cutoffMinutes!: number;

  @Field(() => [BookingPublicServiceType])
  services!: BookingPublicServiceType[];
}

@ObjectType('BookingPublicSlots')
export class BookingPublicSlotsType {
  @Field()
  resourceId!: string;

  @Field()
  resourceName!: string;

  @Field(() => [String])
  starts!: string[];
}

/** One booking as its customer sees it. */
@ObjectType('BookingPublicBooking')
export class BookingPublicBookingType {
  @Field()
  title!: string;

  @Field()
  note!: string;

  @Field()
  timeZone!: string;

  @Field()
  today!: string;

  @Field()
  lastDay!: string;

  @Field(() => Int)
  cutoffMinutes!: number;

  @Field()
  serviceId!: string;

  @Field()
  serviceName!: string;

  @Field()
  resourceId!: string;

  @Field()
  resourceName!: string;

  @Field()
  startsAt!: string;

  @Field()
  endsAt!: string;

  /** `pending`, `confirmed`, `declined`, `arrived`, `done`, `cancelled` or `no_show`. */
  @Field()
  status!: string;

  @Field()
  customerName!: string;

  /** Why it was declined or cancelled, when somebody said. */
  @Field()
  reason!: string;

  /** Whether the customer may still cancel or move it themselves. */
  @Field()
  canChange!: boolean;
}

/** A request, just made: the booking, and ⚠ its manage token — sent this once and never again. */
@ObjectType('BookingPublicRequest')
export class BookingPublicRequestType {
  @Field()
  manageToken!: string;

  @Field(() => BookingPublicBookingType)
  booking!: BookingPublicBookingType;
}

@InputType('BookingPublicRequestInput')
export class BookingPublicRequestInputType {
  @Field()
  serviceId!: string;

  @Field()
  resourceId!: string;

  @Field()
  startsAt!: string;

  @Field()
  customerName!: string;

  @Field(() => String, { nullable: true })
  customerPhone?: string | null;

  @Field(() => String, { nullable: true })
  customerEmail?: string | null;

  @Field(() => String, { nullable: true })
  note?: string | null;
}
