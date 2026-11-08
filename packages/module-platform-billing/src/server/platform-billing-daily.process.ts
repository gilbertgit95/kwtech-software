import {
  type ProcessHandler,
  type ProcessRunContext,
  type ProcessRunResult,
  processOccurrence,
} from '@kwtech/module-kit';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type DayKey, platformDay } from '../domain/days.js';
import { isWaitingTooLong, type PlannedReminder, planReminders, type ReminderKind } from '../domain/notices.js';
import {
  dateColumnToDay,
  dayToDateColumn,
  type JsonValue,
  type NoticeRow,
  type PlatformBillingWriteClient,
} from './platform-billing.repository.js';
import { PlatformBillingService } from './platform-billing.service.js';
import { PLATFORM_BILLING_NOTIFIER, PLATFORM_BILLING_PRISMA_WRITE } from './platform-billing.tokens.js';
import type { BillingReminderNotice, PlatformBillingNotifier } from './ports.js';

/** Organizations read per page: never all of them in memory (JOBS-PLAN §4c). */
const ORGANIZATION_PAGE = 100;

/** Unsent notices retried per run, oldest first. */
const RETRY_BATCH = 200;

/**
 * How long an unsent notice is still worth sending: a day and a half. Past
 * it, what it says ("5 days left", "overdue") is stale, and the organization
 * may have renewed; the next run's own notice says the current thing. The
 * stale rows stay, unsent, counted in the log, and never starve newer ones.
 */
const RETRY_WINDOW_MS = 36 * 60 * 60 * 1000;

/** The organization id a notice to billing approvers is filed under: it belongs to no organization. */
export const PLATFORM_NOTICE_ORGANIZATION = 'platform';

/** The reminders that ask the organization to pay: not said once it cancelled (it chose to leave). */
const ASKS_TO_PAY: readonly ReminderKind[] = [
  'due_in_7',
  'due_in_3',
  'due_in_1',
  'due_today',
  'overdue',
  'last_warning',
];

/**
 * BILLING'S DAILY CHECK (`platform_billing.daily_check`, plan §4, #95).
 *
 * Reminds each organization's owner and admins as its due date nears and
 * passes, when its access ends, and while a request waits without payment
 * details; and tells billing approvers about requests waiting more than a
 * day.
 *
 * ## ⚠ It never decides access
 *
 * Access ends by itself: the entitlement check compares `accessUntil` with
 * now on every request (D14). This only tells people. It does NOT mark an
 * expired subscription `canceled` either (the plan said it would): the live
 * row is what says "your plan ended on <date>", what lets a late renewal
 * charge the access used (D10), and what keeps the organization renewing
 * rather than subscribing anew. Ending it would lose all three, for nothing
 * the clock does not already do.
 *
 * ## ⚠ Once, by a row of its own
 *
 * Each notice is a `platform_billing_notice` row under `@@unique`, written
 * BEFORE the send, its `sentAt` set only after the send succeeded. Every run
 * first retries the rows without `sentAt`. The key is the notice's own day
 * (`planReminders`), so a second run creates nothing and a missed run
 * catches up once.
 */
@Injectable()
export class PlatformBillingDailyCheck implements ProcessHandler {
  private readonly logger = new Logger('PlatformBillingDailyCheck');

  constructor(
    @Inject(PLATFORM_BILLING_PRISMA_WRITE) private readonly prisma: PlatformBillingWriteClient,
    private readonly reads: PlatformBillingService,
    /** Unbound: nobody is told, and nothing is written, so binding it later the same day still reminds. */
    @Optional() @Inject(PLATFORM_BILLING_NOTIFIER) private readonly notifier?: PlatformBillingNotifier,
  ) {}

  /** One run: retry what was never sent, sweep the organizations, then the approvers' digest. Counts, never names. */
  async run(context: ProcessRunContext): Promise<ProcessRunResult> {
    const result: ProcessRunResult = { handled: 0, skippedLate: 0, leftForNext: 0 };
    const notifier = this.notifier;
    if (!notifier) return result;

    // ⚠ The billing zone's day and time, from the run's one clock: never the machine's.
    const settings = await this.reads.settings();
    const occurrence = processOccurrence(context.schedule, context.now, settings.timeZone, context.tooLateAfterMinutes);
    if (occurrence.kind === 'none') return result;
    if (occurrence.kind === 'too_late') return { ...result, skippedLate: 1 };
    const today: DayKey = occurrence.dayKey;

    /*
     * ⚠ ONE BUDGET FOR THE WHOLE RUN (`maxItems`), spent by retries, the
     * organizations' reminders and the digest alike. What does not fit is
     * never claimed, so it is still owed, and found, on the next run.
     */
    let budget = context.maxItems;
    try {
      const retried = await this.retryUnsent(notifier, context, budget);
      result.handled += retried.sent;
      // Every ATTEMPT spends the budget, delivered or not: the limit is on work, not on luck.
      budget -= retried.attempted;
    } catch (error) {
      // Reading the unsent rows failed: today's notices are still worth sending.
      this.logger.warn(`The billing notice retry failed: ${errorText(error)}`);
    }
    const now = context.now;

    let cursor: string | null = null;
    do {
      if (context.signal.aborted) break;
      const page = await context.organizations(cursor, ORGANIZATION_PAGE);
      for (const [index, organization] of page.organizations.entries()) {
        if (context.signal.aborted) break;
        if (budget <= 0) {
          // Left for the next run, which finds them still owed: delayed, never skipped.
          result.leftForNext += page.organizations.length - index;
          break;
        }
        /*
         * ⚠ The budget counts notices HANDLED, not organizations looked at. One
         * with nothing due costs nothing, so a run capped below the number of
         * organizations reaches further each time instead of re-reading the
         * first ones forever. Sequential: a few reads and at most two notices each.
         */
        try {
          const checked = await this.checkOrganization(notifier, organization.organizationId, now, today, budget);
          result.handled += checked.sent;
          budget -= checked.claimed;
        } catch (error) {
          // ⚠ One organization's failure must not silence the ones after it: the order is stable, so it would every run.
          this.logger.warn(`The billing check of one organization failed: ${errorText(error)}`);
        }
      }
      cursor = budget > 0 ? page.nextCursor : null;
    } while (cursor !== null);

    if (!context.signal.aborted && budget > 0) {
      try {
        result.handled += await this.approversDigest(notifier, now, today);
      } catch (error) {
        this.logger.warn(`The billing approvers' digest failed: ${errorText(error)}`);
      }
    }
    return result;
  }

  /** The reminders one organization is owed today, each written once and sent. */
  private async checkOrganization(
    notifier: PlatformBillingNotifier,
    organizationId: string,
    now: Date,
    today: DayKey,
    allowance: number,
  ): Promise<{ claimed: number; sent: number }> {
    const billing = await this.reads.context(organizationId, now);
    const window = billing.standing.hasPaidSubscription ? billing.standing.window : null;
    const pending = billing.pending
      ? { covered: billing.pending.coveredOn !== null, hasDetails: billing.pending.detailsVersion > 0 }
      : null;
    const planned = planReminders(window, today, pending).filter(
      (reminder) => !(billing.cancelled && ASKS_TO_PAY.includes(reminder.kind)),
    );
    let sent = 0;
    let claimed = 0;
    for (const reminder of planned) {
      // At most `allowance` NEW claims: one already written costs nothing, and one past it is not written, so the next run still owes it.
      if (claimed >= allowance) break;
      const notice: BillingReminderNotice = {
        organizationId,
        kind: reminder.kind,
        planKey: billing.live?.planKey ?? null,
        periodEnd: window?.periodEnd ?? null,
        accessUntil: window?.accessUntil ?? null,
        daysLeft: reminder.daysLeft,
      };
      let row: NoticeRow | null;
      try {
        row = await this.claim(organizationId, reminder, window?.periodEnd ?? null, { ...notice }, now);
      } catch (error) {
        // Not written, so still owed next run; what was claimed before it is kept and charged.
        this.logger.warn(`A billing reminder (${reminder.kind}) could not be recorded: ${errorText(error)}`);
        continue;
      }
      if (!row) continue;
      claimed += 1;
      try {
        if (await this.deliver(row, () => notifier.reminder(notice), now)) sent += 1;
      } catch (error) {
        // Its row stays unsent for the retry; the organization's other reminder still goes.
        this.logger.warn(`A billing reminder (${reminder.kind}) could not be marked sent: ${errorText(error)}`);
      }
    }
    return { claimed, sent };
  }

  /** One notice a day to billing approvers, when requests have waited more than a day. Counts, never names. */
  private async approversDigest(notifier: PlatformBillingNotifier, now: Date, today: DayKey): Promise<number> {
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const where = { state: 'pending' as const, requestedAt: { lt: dayAgo } };
    const waiting = await this.prisma.platformBillingRequest.count({ where });
    if (waiting === 0) return 0;
    const oldest = await this.prisma.platformBillingRequest.findFirst({ where, orderBy: { requestedAt: 'asc' } });
    if (!oldest || !isWaitingTooLong(oldest.requestedAt, now)) return 0;
    const settings = await this.reads.settings();
    const notice = {
      waiting,
      oldestRequestedAt: oldest.requestedAt.toISOString(),
      oldestRequestedOn: platformDay(oldest.requestedAt, settings.timeZone),
    };
    const row = await this.claim(
      PLATFORM_NOTICE_ORGANIZATION,
      { kind: 'approvers_pending', day: today },
      null,
      { ...notice },
      now,
    );
    if (!row) return 0;
    return (await this.deliver(row, () => notifier.approversDigest(notice), now)) ? 1 : 0;
  }

  /**
   * Writes the notice's row, or returns null when it already exists: that
   * run told (or is retrying) it. ⚠ BEFORE the send, so a failure between the
   * two is retried, never lost.
   */
  private async claim(
    organizationId: string,
    reminder: Pick<PlannedReminder, 'day'> & { kind: string },
    periodEnd: DayKey | null,
    data: Record<string, JsonValue>,
    now: Date,
  ): Promise<NoticeRow | null> {
    try {
      return await this.prisma.platformBillingNotice.create({
        data: {
          organizationId,
          kind: reminder.kind,
          periodKey: periodEnd ?? '-',
          day: dayToDateColumn(reminder.day),
          data,
          // The run's clock, never the machine's: a replayed run stamps its own time.
          createdAt: now,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  /** Sends, and marks the row sent only when the send succeeded. A failed send never fails the run. */
  private async deliver(row: NoticeRow, send: () => Promise<boolean>, now: Date): Promise<boolean> {
    let delivered = false;
    try {
      delivered = await send();
    } catch (error) {
      this.logger.warn(`A billing notice (${row.kind}) could not be sent: ${errorText(error)}`);
    }
    if (delivered) await this.prisma.platformBillingNotice.update({ where: { id: row.id }, data: { sentAt: now } });
    return delivered;
  }

  /** The rows a previous run wrote and could not send, oldest first, sent again from what they recorded. */
  private async retryUnsent(
    notifier: PlatformBillingNotifier,
    context: ProcessRunContext,
    allowance: number,
  ): Promise<{ attempted: number; sent: number }> {
    if (allowance <= 0) return { attempted: 0, sent: 0 };
    const cutoff = new Date(context.now.getTime() - RETRY_WINDOW_MS);
    const stale = await this.prisma.platformBillingNotice.count({
      where: { sentAt: null, createdAt: { lte: cutoff } },
    });
    if (stale > 0) this.logger.warn(`${stale} billing notice(s) were never sent and are now too old to send.`);
    const rows = await this.prisma.platformBillingNotice.findMany({
      where: { sentAt: null, createdAt: { gt: cutoff } },
      orderBy: { createdAt: 'asc' },
      take: Math.min(RETRY_BATCH, allowance),
    });
    let sent = 0;
    let attempted = 0;
    for (const row of rows) {
      if (context.signal.aborted) break;
      attempted += 1;
      const data = (typeof row.data === 'object' && row.data !== null ? row.data : {}) as Record<string, unknown>;
      const send =
        row.organizationId === PLATFORM_NOTICE_ORGANIZATION
          ? () =>
              notifier.approversDigest({
                waiting: Number(data.waiting ?? 0),
                oldestRequestedAt: String(data.oldestRequestedAt ?? ''),
                oldestRequestedOn: String(data.oldestRequestedOn ?? noticeDay(row)),
              })
          : () => notifier.reminder(reminderFrom(row, data));
      try {
        if (await this.deliver(row, send, context.now)) sent += 1;
      } catch (error) {
        // A row whose `sentAt` cannot be written stays unsent and is retried; the rest still go.
        this.logger.warn(`A billing notice (${row.kind}) could not be retried: ${errorText(error)}`);
      }
    }
    return { attempted, sent };
  }
}

/** A stored reminder read back for a retry: what was recorded, with the row's own keys as the fallback. */
function reminderFrom(row: NoticeRow, data: Record<string, unknown>): BillingReminderNotice {
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  return {
    organizationId: row.organizationId,
    kind: row.kind as ReminderKind,
    planKey: text(data.planKey),
    periodEnd: text(data.periodEnd) ?? (row.periodKey === '-' ? null : row.periodKey),
    accessUntil: text(data.accessUntil),
    daysLeft: typeof data.daysLeft === 'number' ? data.daysLeft : 0,
  };
}

/** P2002, detected structurally: this module never imports Prisma. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

/** An error as a sentence for the log. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The day a notice row is for, as a day key (for tests and the retry). */
export function noticeDay(row: Pick<NoticeRow, 'day'>): DayKey {
  return dateColumnToDay(row.day);
}
