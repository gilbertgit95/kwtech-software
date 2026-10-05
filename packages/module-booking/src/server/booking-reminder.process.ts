import {
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  type ProcessHandler,
  type ProcessRunContext,
  type ProcessRunResult,
  type ProcessWorkspace,
} from '@kwtech/module-kit';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { normalizeBookingSettings } from '../domain/catalogue.js';
import { upcomingSessionRecipients } from '../domain/reminders.js';
import { addMinutes } from '../domain/time.js';
import { isUniqueViolation } from './booking.errors.js';
import type {
  BookingAppointmentRow,
  BookingReminderOutcome,
  BookingReminderWhere,
  BookingWriteClient,
  InScope,
} from './booking.repository.js';
import { BOOKING_MEMBER_DIRECTORY, BOOKING_NOTIFIER, BOOKING_PRISMA_WRITE } from './booking.tokens.js';
import type { BookingMemberDirectory, BookingNotifier } from './ports.js';

/** Workspaces read per page: never all of them in memory (JOBS-PLAN §4c). */
const WORKSPACE_PAGE = 100;

/**
 * `booking.upcoming_sessions` — shortly before a confirmed booking starts,
 * tells the staff it concerns.
 *
 * Built to the rules every process answers for (JOBS-PLAN §4c):
 *
 *   SWEEPS      it asks "which confirmed bookings here start within the
 *               workspace's notice, with no reminder yet", workspace by
 *               workspace. No timer per booking.
 *   IDEMPOTENT  the reminder's row (`booking_reminder`, keyed by booking and
 *               start) is written BEFORE anybody is told, and a booking with
 *               one stops matching the sweep. Run twice, the second finds
 *               nothing.
 *   BATCHES     a page of workspaces, at most `maxItems` bookings a run, one
 *               small write per booking and no long transaction. The rest wait
 *               for the next run, which finds them because they are unmarked.
 *   ANY TIME    it measures from the run's own clock. A booking that had
 *               already STARTED when a run first saw it — after a pause or an
 *               outage — is skipped and counted, never announced as "starting
 *               soon".
 *
 * ⚠ AT MOST ONCE, deliberately. The row is written first, so a server dying
 * between the write and the notice loses that one reminder rather than risking
 * two. A reminder is a courtesy; the same one twice is a fault.
 *
 * ⚠ A booking MOVED is reminded of its new time, unless both times fall inside
 * one notice window: moved from 10:10 to 10:20 by the desk at 10:00, the people
 * told about 10:10 are not told again — the one who moved it knows.
 */
@Injectable()
export class BookingUpcomingSessionsProcess implements ProcessHandler {
  private readonly logger = new Logger('BookingUpcomingSessions');

  constructor(
    @Inject(BOOKING_PRISMA_WRITE) private readonly prisma: BookingWriteClient,
    /** Unbound: nobody can be shown to work the desk, so nobody is told — fail closed. */
    @Optional() @Inject(BOOKING_MEMBER_DIRECTORY) private readonly directory?: BookingMemberDirectory,
    /** Unbound: nobody is told, and nothing is marked, so binding it later still reminds of what is ahead. */
    @Optional() @Inject(BOOKING_NOTIFIER) private readonly notifier?: BookingNotifier,
  ) {}

  async run(context: ProcessRunContext): Promise<ProcessRunResult> {
    const counts: ProcessRunResult = { handled: 0, skippedLate: 0, leftForNext: 0 };
    if (!this.notifier) return counts;

    let cursor: string | null = null;
    // Sequential on purpose: the item limit is one budget across every workspace.
    do {
      const page = await context.workspaces(cursor, WORKSPACE_PAGE);
      for (const workspace of page.workspaces) {
        if (context.signal.aborted) return counts;
        const budget = context.maxItems - counts.handled - counts.skippedLate;
        const full = await this.sweep(workspace, context, budget, counts);
        // The limit was reached here: later workspaces are the next run's, found because they are unmarked.
        if (full) return counts;
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
    return counts;
  }

  /**
   * One workspace. Returns true when the run's item limit was reached in it,
   * having counted what this workspace still has waiting.
   */
  private async sweep(
    workspace: ProcessWorkspace,
    context: ProcessRunContext,
    budget: number,
    counts: ProcessRunResult,
  ): Promise<boolean> {
    const scope: InScope = { organizationId: workspace.organizationId, workspaceId: workspace.workspaceId };
    const row = await this.prisma.bookingSettings.findUnique({ where: { workspaceId: scope.workspaceId } });
    const settings = normalizeBookingSettings(row && row.organizationId === scope.organizationId ? row : null);
    // The workspace turned its reminders off.
    if (settings.reminderMinutes === 0) return false;

    const window = {
      // Looking back, so a booking that started unreminded is counted once instead of going unnoticed.
      gt: addMinutes(context.now, -context.tooLateAfterMinutes),
      lte: addMinutes(context.now, settings.reminderMinutes),
    };
    const where: BookingReminderWhere = {
      ...scope,
      status: 'confirmed',
      startsAt: window,
      reminders: { none: { startsAt: window } },
    };
    const due = await this.prisma.bookingAppointment.findMany({
      where,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: budget,
    });
    if (due.length === 0) return false;

    const ahead = due.filter((appointment) => appointment.startsAt.getTime() > context.now.getTime());
    const started = due.filter((appointment) => appointment.startsAt.getTime() <= context.now.getTime());
    await this.skipLate(started, context, counts);
    if (ahead.length > 0) await this.remind(scope, workspace, ahead, context, counts);

    if (due.length < budget) return false;
    // Whatever still matches was neither reminded nor skipped: it waits.
    counts.leftForNext += await this.prisma.bookingAppointment.count({ where });
    return true;
  }

  private async skipLate(
    started: readonly BookingAppointmentRow[],
    context: ProcessRunContext,
    counts: ProcessRunResult,
  ): Promise<void> {
    for (const appointment of started) {
      if (context.signal.aborted) return;
      if (await this.record(appointment, 'skipped_late')) counts.skippedLate += 1;
    }
  }

  private async remind(
    scope: InScope,
    workspace: ProcessWorkspace,
    ahead: readonly BookingAppointmentRow[],
    context: ProcessRunContext,
    counts: ProcessRunResult,
  ): Promise<void> {
    const serviceIds = [...new Set(ahead.map((appointment) => appointment.serviceId))];
    const resourceIds = [...new Set(ahead.map((appointment) => appointment.resourceId))];
    // One question for the whole batch: who works the desk here.
    const [services, resources, desk] = await Promise.all([
      this.prisma.bookingService.findMany({
        where: { ...scope, id: { in: serviceIds } },
        orderBy: [{ id: 'asc' }],
        take: serviceIds.length,
      }),
      this.prisma.bookingResource.findMany({
        where: { ...scope, id: { in: resourceIds } },
        orderBy: [{ id: 'asc' }],
        take: resourceIds.length,
      }),
      this.directory ? this.directory.listDesk(scope.organizationId, scope.workspaceId) : Promise.resolve([]),
    ]);
    const serviceById = new Map(services.map((service) => [service.id, service]));
    const resourceById = new Map(resources.map((resource) => [resource.id, resource]));
    const deskIds = desk.map((member) => member.userId);
    // ⚠ Never UTC for a zone that cannot be read: the notice would print the wrong hour.
    const timeZone = isValidTimeZone(workspace.timeZone) ? workspace.timeZone : DEFAULT_TIME_ZONE;

    // In order, one at a time: each is a claim then a notice, and the limit is counted as it goes.
    for (const appointment of ahead) {
      if (context.signal.aborted) return;
      const service = serviceById.get(appointment.serviceId);
      const resource = resourceById.get(appointment.resourceId);
      const recipientIds = resource ? upcomingSessionRecipients(resource.userId, deskIds) : [];

      // ⚠ The row first. Somebody else's row means somebody else's reminder: tell nobody.
      const claimed = await this.record(appointment, recipientIds.length > 0 ? 'sent' : 'no_recipient');
      if (!claimed) continue;
      counts.handled += 1;
      if (!service || !resource || recipientIds.length === 0) continue;

      await this.notifier
        ?.startingSoon({
          recipientIds,
          organizationId: scope.organizationId,
          workspaceId: scope.workspaceId,
          appointmentId: appointment.id,
          startsAt: appointment.startsAt.toISOString(),
          timeZone,
          serviceName: service.name,
          resourceName: resource.name,
          customerName: appointment.customerName,
        })
        // A notice that cannot be sent never fails the run. Counts and errors, never names.
        .catch((error: unknown) => this.logger.warn(`Could not send a booking reminder: ${(error as Error).message}`));
    }
  }

  /**
   * Writes that this booking's reminder for this start is dealt with. False
   * when it already was — another run, or another server, got there first.
   */
  private async record(appointment: BookingAppointmentRow, outcome: BookingReminderOutcome): Promise<boolean> {
    try {
      await this.prisma.bookingReminder.create({
        data: {
          organizationId: appointment.organizationId,
          workspaceId: appointment.workspaceId,
          appointmentId: appointment.id,
          startsAt: appointment.startsAt,
          outcome,
        },
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }
}
