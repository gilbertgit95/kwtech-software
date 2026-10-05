import type { BookingChangeActor, BookingChangeKind, BookingResourceKind, BookingStatus } from '../types.js';

/**
 * The slice of a Prisma client this module uses — declared STRUCTURALLY, never
 * imported from a generated one.
 *
 * The module ships `prisma/booking.prisma`; the host composes it into its own
 * schema and hands back the client. So this package has no `@prisma/client`
 * dependency. The app's `satisfies-modules.ts` proves its client fits, at
 * compile time.
 *
 * Every argument shape here is one the services actually send, and nothing
 * more: a wider interface is a wider promise the fake in the tests would have
 * to keep.
 *
 * ⚠ EVERY SERVICE, RESOURCE, EXCEPTION AND APPOINTMENT LOOKUP NAMES ITS
 * WORKSPACE AND ORGANIZATION (`InScope`); hours, links, changes and reminders
 * are reached THROUGH a row already found that way. There is no `{ id }`-only
 * shape to reach for.
 */

type SortOrder = 'asc' | 'desc';

export interface InScope {
  organizationId: string;
  workspaceId: string;
}

export interface BookingServiceRow extends InScope {
  id: string;
  name: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  price: number | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BookingResourceRow extends InScope {
  id: string;
  name: string;
  kind: BookingResourceKind;
  userId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BookingServiceResourceRow extends InScope {
  serviceId: string;
  resourceId: string;
}

export interface BookingHoursRow extends InScope {
  id: string;
  resourceId: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface BookingExceptionRow extends InScope {
  id: string;
  resourceId: string | null;
  /** A `DATE`: midnight UTC of the day (`bookingDayFromDate`). */
  day: Date;
  startMinute: number | null;
  endMinute: number | null;
  note: string;
  createdById: string;
  createdAt: Date;
}

export interface BookingAppointmentRow extends InScope {
  id: string;
  serviceId: string;
  resourceId: string;
  startsAt: Date;
  endsAt: Date;
  blockedFrom: Date;
  blockedUntil: Date;
  status: BookingStatus;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  customerId: string | null;
  note: string;
  createdById: string | null;
  decidedById: string | null;
  decidedAt: Date | null;
  /** Since when it has been waiting for staff. Null unless `pending`. */
  pendingSince: Date | null;
  /** ⚠ A secret, hashed: SHA-256 of the customer's manage token. Null for a booking made by staff. */
  manageTokenHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BookingChangeRow extends InScope {
  id: string;
  appointmentId: string;
  kind: BookingChangeKind;
  actorKind: BookingChangeActor;
  actorId: string | null;
  fromStartsAt: Date | null;
  toStartsAt: Date | null;
  fromResourceId: string | null;
  toResourceId: string | null;
  reason: string;
  createdAt: Date;
}

/** `sent`, `skipped_late` or `no_recipient` — see prisma/booking.prisma. */
export type BookingReminderOutcome = 'sent' | 'skipped_late' | 'no_recipient';

export interface BookingReminderRow extends InScope {
  appointmentId: string;
  startsAt: Date;
  outcome: BookingReminderOutcome;
  createdAt: Date;
}

export interface BookingSettingsRow extends InScope {
  slotMinutes: number;
  reminderMinutes: number;
  publicEnabled: boolean;
  /** The public page's address. Null until the page is first turned on. */
  publicLinkId: string | null;
  publicTitle: string;
  publicNote: string;
  leadMinutes: number;
  horizonDays: number;
  cutoffMinutes: number;
  lapseHours: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Live rows, or every row. */
type ArchivedFilter = { archivedAt?: null };

/**
 * ⚠ THE CLASH QUERY — the query-side twin of `rangesOverlap`: the bookings
 * that HOLD one of these resources and whose blocked range shares time with
 * `[blockedUntil.gt, blockedFrom.lt)`. `id.not` leaves out the booking being
 * moved, which cannot clash with itself.
 */
export interface BookingClashWhere extends InScope {
  resourceId: string | { in: string[] };
  status: { in: BookingStatus[] };
  blockedFrom: { lt: Date };
  blockedUntil: { gt: Date };
  id?: { not: string };
}

/** One workspace day: every booking that STARTS in `[gte, lt)`. */
export interface BookingDayWhere extends InScope {
  startsAt: { gte: Date; lt: Date };
}

/**
 * What the reminder sweep reads: a workspace's CONFIRMED bookings starting in a
 * window, ⚠ WITH NO REMINDER FOR A START IN THAT WINDOW YET. The last line is
 * the idempotence, in the query itself: a booking dealt with stops matching, so
 * a run never needs to remember where it got to.
 */
export interface BookingReminderWhere extends InScope {
  status: 'confirmed';
  startsAt: { gt: Date; lte: Date };
  reminders: { none: { startsAt: { gt: Date; lte: Date } } };
}

/**
 * The requests waiting for staff in a workspace — and, narrowed, the ones a
 * sweep lapses (their time has come, or they have waited too long) and the ones
 * one contact already has waiting.
 */
export interface BookingPendingWhere extends InScope {
  status: 'pending';
  startsAt?: { lte: Date };
  pendingSince?: { lte: Date };
  customerPhone?: string;
  customerEmail?: string;
}

/** The stored settings a write may set. `publicLinkId` is the service's to make, never the caller's. */
export interface BookingSettingsData {
  slotMinutes: number;
  reminderMinutes: number;
  publicEnabled: boolean;
  publicLinkId: string | null;
  publicTitle: string;
  publicNote: string;
  leadMinutes: number;
  horizonDays: number;
  cutoffMinutes: number;
  lapseHours: number;
}

export interface BookingAppointmentUpdate {
  resourceId?: string;
  startsAt?: Date;
  endsAt?: Date;
  blockedFrom?: Date;
  blockedUntil?: Date;
  status?: BookingStatus;
  customerName?: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  note?: string;
  decidedById?: string | null;
  decidedAt?: Date | null;
  pendingSince?: Date | null;
}

export interface BookingTransaction {
  bookingService: {
    /** ⚠ The only way to find one service: by id AND scope. */
    findFirst(args: { where: InScope & { id: string } }): Promise<BookingServiceRow | null>;
    findMany(args: {
      where: (InScope & ArchivedFilter) | (InScope & { id: { in: string[] } });
      orderBy: Array<{ name: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<BookingServiceRow[]>;
    /** Behind `BOOKING_SERVICES_MAX`. Archived services included. */
    count(args: { where: InScope }): Promise<number>;
    create(args: {
      data: InScope & {
        name: string;
        durationMinutes: number;
        bufferBeforeMinutes: number;
        bufferAfterMinutes: number;
        price: number | null;
      };
    }): Promise<BookingServiceRow>;
    updateMany(args: {
      where: InScope & { id: string };
      data: {
        name?: string;
        durationMinutes?: number;
        bufferBeforeMinutes?: number;
        bufferAfterMinutes?: number;
        price?: number | null;
        archivedAt?: Date | null;
      };
    }): Promise<{ count: number }>;
  };

  bookingResource: {
    /** ⚠ The only way to find one resource: by id AND scope. */
    findFirst(args: { where: InScope & { id: string } }): Promise<BookingResourceRow | null>;
    findMany(args: {
      where: (InScope & ArchivedFilter) | (InScope & { id: { in: string[] } });
      orderBy: Array<{ name: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<BookingResourceRow[]>;
    /** The count behind `booking:resources`: live resources only. */
    count(args: { where: InScope & { archivedAt: null } }): Promise<number>;
    create(args: {
      data: InScope & { name: string; kind: BookingResourceKind; userId: string | null };
    }): Promise<BookingResourceRow>;
    updateMany(args: {
      where: InScope & { id: string };
      data: { name?: string; kind?: BookingResourceKind; userId?: string | null; archivedAt?: Date | null };
    }): Promise<{ count: number }>;
  };

  bookingServiceResource: {
    findMany(args: {
      where: { serviceId: string | { in: string[] } } | { serviceId: string; resourceId: string };
    }): Promise<BookingServiceResourceRow[]>;
    create(args: { data: InScope & { serviceId: string; resourceId: string } }): Promise<BookingServiceResourceRow>;
    deleteMany(args: { where: { serviceId: string } }): Promise<{ count: number }>;
  };

  bookingHours: {
    findMany(args: {
      where: { resourceId: string | { in: string[] } };
      orderBy: Array<{ weekday: SortOrder } | { startMinute: SortOrder }>;
    }): Promise<BookingHoursRow[]>;
    create(args: {
      data: InScope & { resourceId: string; weekday: number; startMinute: number; endMinute: number };
    }): Promise<BookingHoursRow>;
    deleteMany(args: { where: { resourceId: string } }): Promise<{ count: number }>;
  };

  bookingException: {
    findMany(args: {
      /** From a day on, for the settings screen; or exactly one day, for the slots. */
      where: InScope & { day: Date | { gte: Date } };
      orderBy: Array<{ day: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<BookingExceptionRow[]>;
    create(args: {
      data: InScope & {
        resourceId: string | null;
        day: Date;
        startMinute: number | null;
        endMinute: number | null;
        note: string;
        createdById: string;
      };
    }): Promise<BookingExceptionRow>;
    /** A closed day is a setting, not a record: nothing refers to one, so it is removed outright. */
    deleteMany(args: { where: InScope & { id: string } }): Promise<{ count: number }>;
  };

  bookingAppointment: {
    /**
     * ⚠ The only two ways to find one booking: by id AND scope — or by the
     * hash of its manage token, which names no workspace because the TOKEN is
     * the authority (a customer has no session and belongs to no workspace).
     */
    findFirst(args: {
      where: (InScope & { id: string }) | { manageTokenHash: string };
    }): Promise<BookingAppointmentRow | null>;
    findMany(args: {
      where: BookingDayWhere | BookingClashWhere | BookingReminderWhere | BookingPendingWhere;
      orderBy: Array<{ startsAt: SortOrder } | { pendingSince: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<BookingAppointmentRow[]>;
    count(args: { where: BookingReminderWhere | BookingPendingWhere }): Promise<number>;
    create(args: {
      data: InScope & {
        serviceId: string;
        resourceId: string;
        startsAt: Date;
        endsAt: Date;
        blockedFrom: Date;
        blockedUntil: Date;
        status: BookingStatus;
        customerName: string;
        customerPhone: string | null;
        customerEmail: string | null;
        note: string;
        createdById: string | null;
        pendingSince?: Date | null;
        manageTokenHash?: string | null;
      };
    }): Promise<BookingAppointmentRow>;
    /**
     * ⚠ A COMPARE-AND-SET on `status`. Two people acting on one booking at once
     * both read it as `confirmed`; only the first write matches, and the second
     * is refused rather than marking a cancelled booking as arrived.
     */
    updateMany(args: {
      where: InScope & { id: string; status: BookingStatus };
      data: BookingAppointmentUpdate;
    }): Promise<{ count: number }>;
  };

  bookingChange: {
    findMany(args: {
      where: { appointmentId: string };
      orderBy: Array<{ createdAt: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<BookingChangeRow[]>;
    create(args: {
      data: InScope & {
        appointmentId: string;
        kind: BookingChangeKind;
        actorKind: BookingChangeActor;
        actorId: string | null;
        fromStartsAt?: Date | null;
        toStartsAt?: Date | null;
        fromResourceId?: string | null;
        toResourceId?: string | null;
        reason?: string;
      };
    }): Promise<BookingChangeRow>;
  };

  bookingReminder: {
    /**
     * ⚠ The claim on one booking's reminder for one start time. A second create
     * for the same pair raises a unique violation (`P2002`), which the process
     * reads as "somebody else dealt with it" and tells nobody.
     */
    create(args: {
      data: InScope & { appointmentId: string; startsAt: Date; outcome: BookingReminderOutcome };
    }): Promise<BookingReminderRow>;
  };

  bookingSettings: {
    findUnique(args: { where: { workspaceId: string } }): Promise<BookingSettingsRow | null>;
    /** The workspace a public link belongs to — only while its page is turned on. */
    findFirst(args: { where: { publicLinkId: string; publicEnabled: true } }): Promise<BookingSettingsRow | null>;
    upsert(args: {
      where: { workspaceId: string };
      create: InScope & BookingSettingsData;
      update: Partial<BookingSettingsData>;
    }): Promise<BookingSettingsRow>;
  };
}

/** The read client. The same delegates; a host may bind a replica. */
export type BookingPrismaClient = BookingTransaction;

export interface BookingWriteClient extends BookingTransaction {
  $transaction<T>(fn: (tx: BookingTransaction) => Promise<T>): Promise<T>;
}
