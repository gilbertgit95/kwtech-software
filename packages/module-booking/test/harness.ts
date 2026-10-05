import type { LimitChecker } from '@kwtech/module-kit';
import { BookingEventPublisher } from '../src/server/booking.events.js';
import type { BookingEvent, BookingPubSub } from '../src/server/booking.pubsub.js';
import { BookingReadService } from '../src/server/booking.service.js';
import { BookingCatalogueService } from '../src/server/booking-catalogue.service.js';
import { BookingLapseRequestsProcess } from '../src/server/booking-lapse.process.js';
import { BookingPublicService } from '../src/server/booking-public.service.js';
import { BookingUpcomingSessionsProcess } from '../src/server/booking-reminder.process.js';
import { BookingTimeZoneService } from '../src/server/booking-time-zone.service.js';
import { BookingWriteService } from '../src/server/booking-write.service.js';
import { BookingResolver } from '../src/server/graphql/booking.resolver.js';
import { BookingPublicResolver } from '../src/server/graphql/booking-public.resolver.js';
import type {
  BookingMember,
  BookingMemberDirectory,
  BookingNotifier,
  BookingStartingSoonNotice,
} from '../src/server/ports.js';
import type { BookingWindow } from '../src/types.js';
import { type FakeClient, fakeClient } from './fake-client.js';

/** Shared set-up for the service, process, resolver and realtime suites. */

export const SCOPE = { organizationId: 'org-1', workspaceId: 'ws-1' };
export const OTHER_WORKSPACE = { organizationId: 'org-1', workspaceId: 'ws-2' };
export const ANA = 'user-ana';
export const BEN = 'user-ben';
export const CAL = 'user-cal';

/** The shop's zone in every suite unless a test says otherwise: UTC+8, with no daylight saving. */
export const MANILA = 'Asia/Manila';

/**
 * A day far enough ahead that no test booking is ever "in the past", whenever
 * the suite runs. 9:00 in Manila that day is 01:00 UTC.
 */
export const DAY = '2031-03-03';

/** `HH:MM` in Manila on `DAY` (or another day), as the ISO instant a client would send. */
export function manila(time: string, day: string = DAY): string {
  return new Date(`${day}T${time}:00+08:00`).toISOString();
}

/** An engine like `graphql-subscriptions`' in-memory one: fan-out, no replay. */
export function memoryPubSub(): BookingPubSub & { sent: BookingEvent[] } {
  const listeners = new Set<(trigger: string, payload: unknown) => void>();
  const engine = {
    sent: [] as BookingEvent[],
    async publish(trigger: string, payload: unknown) {
      engine.sent.push(payload as BookingEvent);
      for (const listener of [...listeners]) listener(trigger, payload);
    },
    asyncIterableIterator<T>(triggers: string | readonly string[]): AsyncIterableIterator<T> {
      const wanted = new Set(typeof triggers === 'string' ? [triggers] : triggers);
      const queue: T[] = [];
      let wake: (() => void) | null = null;
      let closed = false;
      const listener = (trigger: string, payload: unknown) => {
        if (!wanted.has(trigger)) return;
        queue.push(payload as T);
        wake?.();
      };
      listeners.add(listener);
      const iterator: AsyncIterableIterator<T> = {
        async next(): Promise<IteratorResult<T>> {
          while (!closed && queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
          wake = null;
          const value = queue.shift();
          return value === undefined ? { value: undefined, done: true } : { value, done: false };
        },
        async return(): Promise<IteratorResult<T>> {
          closed = true;
          listeners.delete(listener);
          wake?.();
          return { value: undefined, done: true };
        },
        [Symbol.asyncIterator]() {
          return iterator;
        },
      };
      return iterator;
    },
  };
  return engine;
}

export interface HarnessOptions {
  limits?: LimitChecker;
  /** The workspace's zone. Omitted: the zone port is UNBOUND (so, Asia/Manila). */
  timeZone?: string;
  /** Who works the desk. Omitted: the directory is UNBOUND. */
  desk?: readonly string[];
  /** Omitted: the notifier is UNBOUND. */
  notify?: boolean;
}

export function harness(options: HarnessOptions = {}) {
  const prisma: FakeClient = fakeClient();
  const pubsub = memoryPubSub();
  const directory: BookingMemberDirectory | undefined = options.desk
    ? {
        async listDesk(): Promise<readonly BookingMember[]> {
          return (options.desk ?? []).map((userId) => ({ userId, displayName: userId.replace('user-', '') }));
        },
        async describe(userIds) {
          return userIds.map((userId) => ({ userId, displayName: userId.replace('user-', '') }));
        },
      }
    : undefined;
  const notices: BookingStartingSoonNotice[] = [];
  /** What the desk was told a CUSTOMER did, in order. */
  const deskNotices: Array<{ what: string; notice: BookingStartingSoonNotice }> = [];
  const notifier: BookingNotifier | undefined = options.notify
    ? {
        async startingSoon(notice) {
          notices.push(notice);
        },
        async requestWaiting(notice) {
          deskNotices.push({ what: 'requestWaiting', notice });
        },
        async customerCancelled(notice) {
          deskNotices.push({ what: 'customerCancelled', notice });
        },
        async customerRescheduled(notice) {
          deskNotices.push({ what: 'customerRescheduled', notice });
        },
      }
    : undefined;

  const zone = options.timeZone;
  const zones = new BookingTimeZoneService(zone ? { timeZoneOf: async () => zone } : undefined);
  const events = new BookingEventPublisher(pubsub);
  const reads = new BookingReadService(prisma, zones, directory);
  const catalogue = new BookingCatalogueService(prisma, reads, events, options.limits, directory);
  const writes = new BookingWriteService(prisma, zones, events);
  const resolver = new BookingResolver(reads, catalogue, writes, { resolveActorId: (req) => req as string }, pubsub);
  const reminders = new BookingUpcomingSessionsProcess(prisma, directory, notifier);
  const publicBooking = new BookingPublicService(prisma, reads, writes, zones, directory, notifier);
  const publicResolver = new BookingPublicResolver(publicBooking);
  const lapses = new BookingLapseRequestsProcess(prisma, writes);
  return {
    prisma,
    pubsub,
    reads,
    catalogue,
    writes,
    resolver,
    reminders,
    notices,
    deskNotices,
    publicBooking,
    publicResolver,
    lapses,
  };
}

/** Open every day of the week, 9:00 to 17:00. */
export const NINE_TO_FIVE: BookingWindow[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  startMinute: 9 * 60,
  endMinute: 17 * 60,
}));

/**
 * A shop that can take a booking: one resource open nine to five every day, and
 * a one-hour service it performs.
 */
export async function shop(
  h: ReturnType<typeof harness>,
  service: { durationMinutes?: number; bufferBeforeMinutes?: number; bufferAfterMinutes?: number } = {},
) {
  const chair = await h.catalogue.saveResource(SCOPE, ANA, null, { name: 'Chair 1', kind: 'place' });
  await h.catalogue.setResourceHours(SCOPE, ANA, chair.resource.id, NINE_TO_FIVE);
  const cut = await h.catalogue.saveService(SCOPE, ANA, null, {
    name: 'Consultation',
    durationMinutes: 60,
    ...service,
    resourceIds: [chair.resource.id],
  });
  return { resourceId: chair.resource.id, serviceId: cut.service.id };
}

/** A confirmed booking for Maria at `time` in Manila on `DAY`. */
export function book(
  h: ReturnType<typeof harness>,
  ids: { resourceId: string; serviceId: string },
  time: string,
  day: string = DAY,
) {
  return h.writes.create(SCOPE, ANA, { ...ids, startsAt: manila(time, day), customerName: 'Maria Santos' });
}

/** Turns the shop's public page on, with rules that let the suite's far-off DAY be booked. Returns its link id. */
export async function openPublicPage(
  h: ReturnType<typeof harness>,
  rules: { leadMinutes?: number; horizonDays?: number; cutoffMinutes?: number; lapseHours?: number } = {},
): Promise<string> {
  const saved = await h.catalogue.saveSettings(SCOPE, ANA, {
    publicEnabled: true,
    publicTitle: 'Ana’s Shop',
    publicNote: '2nd floor, beside the bakery.',
    // DAY is years ahead, so the suite's horizon is the longest allowed unless a test says otherwise.
    horizonDays: 365,
    ...rules,
  });
  if (!saved.publicLinkId) throw new Error('the public page has no link');
  return saved.publicLinkId;
}
