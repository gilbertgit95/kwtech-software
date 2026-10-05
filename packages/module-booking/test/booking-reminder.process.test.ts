import type { ProcessRunContext, ProcessWorkspace } from '@kwtech/module-kit';
import { BOOKING_PROCESS, BOOKING_PROCESS_REGISTRY } from '../src/processes.js';
import { ANA, BEN, book, harness, manila, OTHER_WORKSPACE, SCOPE, shop } from './harness.js';

const DECLARATION = BOOKING_PROCESS_REGISTRY.find((entry) => entry.key === BOOKING_PROCESS.upcomingSessions);
if (!DECLARATION) throw new Error('booking.upcoming_sessions is not declared');

const HERE: ProcessWorkspace = { ...SCOPE, timeZone: 'Asia/Manila' };

/** One run's context: the run's own clock, the declared limits, and the workspaces the plan entitles. */
function contextAt(
  time: string,
  options: { workspaces?: readonly ProcessWorkspace[]; maxItems?: number; signal?: AbortSignal } = {},
): ProcessRunContext {
  const workspaces = options.workspaces ?? [HERE];
  return {
    now: new Date(manila(time)),
    schedule: DECLARATION?.defaultSchedule ?? { kind: 'interval', everyMinutes: 5 },
    maxItems: options.maxItems ?? DECLARATION?.maxItemsPerRun ?? 500,
    tooLateAfterMinutes: DECLARATION?.tooLateAfterMinutes ?? 60,
    signal: options.signal ?? new AbortController().signal,
    async workspaces() {
      return { workspaces, nextCursor: null };
    },
  };
}

const telling = () => harness({ desk: [ANA, BEN], notify: true });

describe('booking.upcoming_sessions', () => {
  it('tells the desk of a confirmed booking starting within the workspace’s notice', async () => {
    const h = telling();
    const made = await book(h, await shop(h), '10:00');
    expect(await h.reminders.run(contextAt('09:50'))).toEqual({ handled: 1, skippedLate: 0, leftForNext: 0 });
    expect(h.notices).toEqual([
      {
        recipientIds: [ANA, BEN],
        ...SCOPE,
        appointmentId: made.id,
        startsAt: manila('10:00'),
        timeZone: 'Asia/Manila',
        serviceName: 'Consultation',
        resourceName: 'Chair 1',
        customerName: 'Maria Santos',
      },
    ]);
  });

  it('says nothing of a booking still further ahead than the notice', async () => {
    const h = telling();
    await book(h, await shop(h), '10:00');
    expect(await h.reminders.run(contextAt('09:30'))).toEqual({ handled: 0, skippedLate: 0, leftForNext: 0 });
    expect(h.notices).toEqual([]);
  });

  it('⚠ run twice, the second run does nothing', async () => {
    const h = telling();
    await book(h, await shop(h), '10:00');
    await h.reminders.run(contextAt('09:50'));
    expect(await h.reminders.run(contextAt('09:55'))).toEqual({ handled: 0, skippedLate: 0, leftForNext: 0 });
    expect(h.notices).toHaveLength(1);
  });

  it('⚠ a booking that had already started is skipped and counted, once', async () => {
    const h = telling();
    await book(h, await shop(h), '10:00');
    // The runner was paused: its first look is twenty minutes after the start.
    expect(await h.reminders.run(contextAt('10:20'))).toEqual({ handled: 0, skippedLate: 1, leftForNext: 0 });
    expect(await h.reminders.run(contextAt('10:25'))).toEqual({ handled: 0, skippedLate: 0, leftForNext: 0 });
    expect(h.notices).toEqual([]);
    expect(h.prisma.state.bookingReminder.map((row) => row.outcome)).toEqual(['skipped_late']);
  });

  it('⚠ stops at its item limit, and the next run finishes', async () => {
    const h = telling();
    const ids = await shop(h, { durationMinutes: 5 });
    for (const time of ['10:00', '10:05', '10:10']) await book(h, ids, time);
    await h.catalogue.saveSettings(SCOPE, ANA, { slotMinutes: 5, reminderMinutes: 30 });

    expect(await h.reminders.run(contextAt('09:50', { maxItems: 2 }))).toEqual({
      handled: 2,
      skippedLate: 0,
      leftForNext: 1,
    });
    expect(await h.reminders.run(contextAt('09:50', { maxItems: 2 }))).toEqual({
      handled: 1,
      skippedLate: 0,
      leftForNext: 0,
    });
    expect(h.notices.map((notice) => notice.startsAt)).toEqual([manila('10:00'), manila('10:05'), manila('10:10')]);
  });

  it('⚠ measures from the run’s clock, not the machine’s, and prints the hour in the workspace’s zone', async () => {
    const h = telling();
    await book(h, await shop(h), '10:00');
    // The same instant, handed two workspaces' zones: the notice carries each one's own.
    await h.reminders.run(contextAt('09:50', { workspaces: [{ ...SCOPE, timeZone: 'Europe/London' }] }));
    const [notice] = h.notices;
    expect(notice?.timeZone).toBe('Europe/London');
    const hourIn = (timeZone: string) =>
      new Date(notice?.startsAt ?? 0).toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' });
    expect([hourIn('Asia/Manila'), hourIn('Europe/London')]).toEqual(['10:00', '02:00']);
  });

  it('falls back to Manila, never UTC, for a zone it cannot read', async () => {
    const h = telling();
    await book(h, await shop(h), '10:00');
    await h.reminders.run(contextAt('09:50', { workspaces: [{ ...SCOPE, timeZone: 'Mars/Olympus' }] }));
    expect(h.notices[0]?.timeZone).toBe('Asia/Manila');
  });

  it('tells only the member a staff resource is', async () => {
    const h = telling();
    const ids = await shop(h);
    const ben = await h.catalogue.saveResource(SCOPE, ANA, null, { name: 'Ben', kind: 'staff', userId: BEN });
    await h.catalogue.setResourceHours(SCOPE, ANA, ben.resource.id, [{ weekday: 1, startMinute: 0, endMinute: 1440 }]);
    await h.catalogue.saveService(SCOPE, ANA, ids.serviceId, {
      name: 'Consultation',
      durationMinutes: 60,
      resourceIds: [ben.resource.id],
    });
    await book(h, { ...ids, resourceId: ben.resource.id }, '10:00');
    await h.reminders.run(contextAt('09:50'));
    expect(h.notices.map((notice) => notice.recipientIds)).toEqual([[BEN]]);
  });

  it('reminds of a booking moved to a new time, at the new time', async () => {
    const h = telling();
    const ids = await shop(h);
    const made = await book(h, ids, '10:00');
    await h.reminders.run(contextAt('09:50'));
    await h.writes.reschedule(SCOPE, ANA, made.id, manila('15:00'), ids.resourceId);
    expect(await h.reminders.run(contextAt('14:50'))).toEqual({ handled: 1, skippedLate: 0, leftForNext: 0 });
    expect(h.notices.map((notice) => notice.startsAt)).toEqual([manila('10:00'), manila('15:00')]);
  });

  it('says nothing of a cancelled booking', async () => {
    const h = telling();
    const made = await book(h, await shop(h), '10:00');
    await h.writes.cancel(SCOPE, ANA, made.id, 'Customer called');
    expect(await h.reminders.run(contextAt('09:50'))).toEqual({ handled: 0, skippedLate: 0, leftForNext: 0 });
  });

  it('respects a workspace that turned its reminders off', async () => {
    const h = telling();
    await book(h, await shop(h), '10:00');
    await h.catalogue.saveSettings(SCOPE, ANA, { slotMinutes: 30, reminderMinutes: 0 });
    expect(await h.reminders.run(contextAt('09:50'))).toEqual({ handled: 0, skippedLate: 0, leftForNext: 0 });
    expect(h.prisma.state.bookingReminder).toEqual([]);
  });

  it('⚠ reaches only the workspaces it is handed — the plan, applied', async () => {
    const h = telling();
    await book(h, await shop(h), '10:00');
    const elsewhere = [{ ...OTHER_WORKSPACE, timeZone: 'Asia/Manila' }];
    expect(await h.reminders.run(contextAt('09:50', { workspaces: elsewhere }))).toEqual({
      handled: 0,
      skippedLate: 0,
      leftForNext: 0,
    });
    expect(h.notices).toEqual([]);
  });

  it('marks a booking nobody could be told about, so it is not asked about again', async () => {
    const h = harness({ desk: [], notify: true });
    await book(h, await shop(h), '10:00');
    expect(await h.reminders.run(contextAt('09:50'))).toEqual({ handled: 1, skippedLate: 0, leftForNext: 0 });
    expect(h.prisma.state.bookingReminder.map((row) => row.outcome)).toEqual(['no_recipient']);
    expect(h.notices).toEqual([]);
  });

  it('⚠ with no notifier bound, tells nobody and marks nothing — binding it later still reminds', async () => {
    const h = harness({ desk: [ANA] });
    await book(h, await shop(h), '10:00');
    expect(await h.reminders.run(contextAt('09:50'))).toEqual({ handled: 0, skippedLate: 0, leftForNext: 0 });
    expect(h.prisma.state.bookingReminder).toEqual([]);
  });

  it('stops when it is told to', async () => {
    const h = telling();
    await book(h, await shop(h), '10:00');
    const stopped = new AbortController();
    stopped.abort();
    expect(await h.reminders.run(contextAt('09:50', { signal: stopped.signal }))).toEqual({
      handled: 0,
      skippedLate: 0,
      leftForNext: 0,
    });
  });

  it('a notice that cannot be sent does not fail the run, and is not sent twice', async () => {
    const h = telling();
    await book(h, await shop(h), '10:00');
    const down = async () => Promise.reject(new Error('the inbox is down'));
    const failing = { startingSoon: down, requestWaiting: down, customerCancelled: down, customerRescheduled: down };
    // The process under test, with a notifier that throws.
    const { BookingUpcomingSessionsProcess } = await import('../src/server/booking-reminder.process.js');
    const process = new BookingUpcomingSessionsProcess(h.prisma, undefined, failing);
    expect(await process.run(contextAt('09:50'))).toEqual({ handled: 1, skippedLate: 0, leftForNext: 0 });
    expect(await process.run(contextAt('09:55'))).toEqual({ handled: 0, skippedLate: 0, leftForNext: 0 });
  });
});
