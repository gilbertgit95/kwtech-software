import type { ProcessHandler, ProcessRunContext, ProcessRunResult, ProcessWorkspace } from '@kwtech/module-kit';
import { Inject, Injectable } from '@nestjs/common';
import { normalizeBookingSettings } from '../domain/catalogue.js';
import { BOOKING_LAPSED_REASON } from '../domain/public.js';
import { addMinutes } from '../domain/time.js';
import type { BookingAppointmentRow, BookingPendingWhere, BookingWriteClient, InScope } from './booking.repository.js';
import { BOOKING_PRISMA_WRITE } from './booking.tokens.js';
import { BookingWriteService } from './booking-write.service.js';

/** Workspaces read per page: never all of them in memory (JOBS-PLAN §4c). */
const WORKSPACE_PAGE = 100;

/**
 * `booking.lapse_requests` — a request nobody confirmed in time is declined by
 * the app, which frees its slot (BOOKING-PLAN §8).
 *
 * A pending request HOLDS its slot (D2). Left alone it would hold it for ever:
 * nobody else could take that time, and the customer would wait on an answer
 * that is not coming. It lapses when it has waited the workspace's
 * `lapseHours`, or when its own start time arrives — whichever is first.
 *
 * Built to the rules every process answers for (JOBS-PLAN §4c):
 *
 *   SWEEPS      "which requests here are still pending and past their time",
 *               workspace by workspace. No timer per request.
 *   IDEMPOTENT  by the booking's own row: the lapse is a compare-and-set from
 *               `pending`, with its history row in the same transaction. A
 *               request already answered — by staff, by the customer, or by
 *               another run — no longer matches, and a lost race changes
 *               nothing. Run twice, the second finds nothing.
 *   BATCHES     at most `maxItems` requests a run, one small transaction each.
 *   ANY TIME    measured from the run's own clock. ⚠ NOTHING IS EVER TOO LATE
 *               to lapse: a request found a day after its time is still
 *               lapsed, because the alternative is a slot held for ever. So
 *               `skippedLate` is always 0 here.
 *
 * ⚠ IT TELLS NOBODY. The desk sees the request leave its list; the customer
 * sees "Not confirmed in time" on their manage link. The app cannot message a
 * customer yet (D3, PLAN §12.91).
 */
@Injectable()
export class BookingLapseRequestsProcess implements ProcessHandler {
  constructor(
    @Inject(BOOKING_PRISMA_WRITE) private readonly prisma: BookingWriteClient,
    private readonly writes: BookingWriteService,
  ) {}

  async run(context: ProcessRunContext): Promise<ProcessRunResult> {
    const counts: ProcessRunResult = { handled: 0, skippedLate: 0, leftForNext: 0 };

    let cursor: string | null = null;
    // Sequential on purpose: the item limit is one budget across every workspace.
    do {
      const page = await context.workspaces(cursor, WORKSPACE_PAGE);
      for (const workspace of page.workspaces) {
        if (context.signal.aborted) return counts;
        const full = await this.sweep(workspace, context, context.maxItems - counts.handled, counts);
        // The limit was reached here: later workspaces are the next run's, found because they are still pending.
        if (full) return counts;
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
    return counts;
  }

  /** One workspace. Returns true when the run's item limit was reached in it. */
  private async sweep(
    workspace: ProcessWorkspace,
    context: ProcessRunContext,
    budget: number,
    counts: ProcessRunResult,
  ): Promise<boolean> {
    const scope: InScope = { organizationId: workspace.organizationId, workspaceId: workspace.workspaceId };
    const row = await this.prisma.bookingSettings.findUnique({ where: { workspaceId: scope.workspaceId } });
    const settings = normalizeBookingSettings(row && row.organizationId === scope.organizationId ? row : null);

    // The two ways a request lapses, as the two queries the structural client can express.
    const timeCame: BookingPendingWhere = { ...scope, status: 'pending', startsAt: { lte: context.now } };
    const waitedTooLong: BookingPendingWhere = {
      ...scope,
      status: 'pending',
      pendingSince: { lte: addMinutes(context.now, -settings.lapseHours * 60) },
    };
    const [byTime, byWaiting] = await Promise.all([
      this.prisma.bookingAppointment.findMany({
        where: timeCame,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        take: budget,
      }),
      this.prisma.bookingAppointment.findMany({
        where: waitedTooLong,
        orderBy: [{ pendingSince: 'asc' }, { id: 'asc' }],
        take: budget,
      }),
    ]);
    // A request can match both; it is lapsed once.
    const due = [...new Map([...byTime, ...byWaiting].map((request) => [request.id, request])).values()];
    if (due.length === 0) return false;

    await this.lapseEach(due.slice(0, budget), context, counts);
    if (due.length < budget) return false;

    // Whatever still matches was not reached: it waits for the next run.
    const [leftByTime, leftByWaiting] = await Promise.all([
      this.prisma.bookingAppointment.count({ where: timeCame }),
      this.prisma.bookingAppointment.count({ where: waitedTooLong }),
    ]);
    // An upper bound: a request matching both is counted twice. Counts, never names.
    counts.leftForNext += Math.max(leftByTime, leftByWaiting);
    return true;
  }

  private async lapseEach(
    due: readonly BookingAppointmentRow[],
    context: ProcessRunContext,
    counts: ProcessRunResult,
  ): Promise<void> {
    // In order, one at a time: each is its own small transaction, and the limit is counted as it goes.
    for (const request of due) {
      if (context.signal.aborted) return;
      // False: answered between the read and the write. Not ours to count.
      if (await this.writes.lapse(request, BOOKING_LAPSED_REASON)) counts.handled += 1;
    }
  }
}
