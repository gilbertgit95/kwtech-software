import {
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  type ProcessHandler,
  type ProcessRunContext,
  type ProcessRunResult,
  type ProcessWorkspace,
  processOccurrence,
  zonedStartOfDay,
} from '@kwtech/module-kit';
import { Inject, Injectable } from '@nestjs/common';
import { countPosOrders, type PosPopularityLine, popularityWindow } from '../domain/popularity.js';
import type { InScope, PosRankingOutcome, PosWriteClient } from './pos.repository.js';
import { POS_PRISMA_WRITE } from './pos.tokens.js';
import { isUniqueViolation } from './pos-catalogue.service.js';

/** Workspaces read per page: never all of them in memory (JOBS-PLAN §4c). */
const WORKSPACE_PAGE = 100;

/** Orders read per query while counting one store's week. */
const ORDER_PAGE = 500;

/**
 * The most orders one store's ranking reads: about 2,800 a day for a week.
 * Past it the ranking is made from the orders read so far — still a fair
 * picture of what sells — rather than a run that cannot finish in its time.
 */
export const POS_RANK_ORDERS_MAX = 20_000;

/**
 * `pos.rank_items` — once a day, each store's items and variants ranked by how
 * many orders included them in the 7 days before (issue #47).
 *
 * Built to the rules every process answers for (JOBS-PLAN §4c):
 *
 *   SWEEPS      it asks "which stores have reached their time today and have
 *               no ranking for today", store by store. No timer.
 *   IDEMPOTENT  the store's `pos_ranking` row says which day it was last dealt
 *               with, and is written IN THE SAME TRANSACTION as the snapshot it
 *               describes, so the two never disagree. Run twice, the second
 *               finds it done. Two servers at once both write the same counts,
 *               and the second's insert clash (`P2002`) is read as "done".
 *   BATCHES     one store is one item; at most `maxItems` stores a run, a
 *               week's orders read a page at a time, and one short
 *               transaction per store. The rest wait for the next sweep, which
 *               finds them still not ranked for today.
 *   ANY TIME    "today" is each store's own day, from the run's clock and the
 *               store's zone. Past `tooLateAfterMinutes` it records the day as
 *               skipped, counts it once, and leaves the old ranking in place.
 *
 * ⚠ IT REPLACES, IT NEVER ADDS. Each ranking is counted afresh from the order
 * lines, so a void, a cancelled order or a bug in an earlier run is gone by the
 * next day — the snapshot is a cache of `PosOrderLine`, never a ledger.
 */
@Injectable()
export class PosRankItemsProcess implements ProcessHandler {
  constructor(@Inject(POS_PRISMA_WRITE) private readonly prisma: PosWriteClient) {}

  async run(context: ProcessRunContext): Promise<ProcessRunResult> {
    const counts: ProcessRunResult = { handled: 0, skippedLate: 0, leftForNext: 0 };
    let cursor: string | null = null;
    // Sequential on purpose: the item limit is one budget across every store.
    do {
      const page = await context.workspaces(cursor, WORKSPACE_PAGE);
      for (const workspace of page.workspaces) {
        if (context.signal.aborted) return counts;
        const due = await this.dueToday(workspace, context);
        if (!due) continue;
        // The limit was reached: what is still due is the next sweep's, and counted as waiting.
        if (counts.handled + counts.skippedLate >= context.maxItems) {
          counts.leftForNext += 1;
          continue;
        }
        if (due.kind === 'too_late') {
          if (await this.record(due.scope, due.dayKey, 'skipped_late', context.now)) counts.skippedLate += 1;
          continue;
        }
        if (await this.rank(due.scope, due.dayKey, due.timeZone, context)) counts.handled += 1;
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
    return counts;
  }

  /**
   * Whether this store needs dealing with now: its time today has come, and
   * its day is not recorded yet. Null: nothing to do here.
   */
  private async dueToday(
    workspace: ProcessWorkspace,
    context: ProcessRunContext,
  ): Promise<{ kind: 'due' | 'too_late'; dayKey: string; timeZone: string; scope: InScope } | null> {
    // ⚠ Never UTC for a zone that cannot be read: that would count every evening's sales on the next day.
    const timeZone = isValidTimeZone(workspace.timeZone) ? workspace.timeZone : DEFAULT_TIME_ZONE;
    const occurrence = processOccurrence(context.schedule, context.now, timeZone, context.tooLateAfterMinutes);
    if (occurrence.kind === 'none') return null;
    const done = await this.prisma.posRanking.findUnique({ where: { workspaceId: workspace.workspaceId } });
    if (done && done.rankedFor.getTime() === dayDate(occurrence.dayKey).getTime()) return null;
    const scope = { organizationId: workspace.organizationId, workspaceId: workspace.workspaceId };
    return { kind: occurrence.kind, dayKey: occurrence.dayKey, timeZone, scope };
  }

  /**
   * Counts the store's week and replaces its snapshot. False when the run was
   * stopped part way (nothing written: the next sweep starts it again) or
   * another run got there first.
   */
  private async rank(scope: InScope, dayKey: string, timeZone: string, context: ProcessRunContext): Promise<boolean> {
    const lines = await this.linesOfWindow(scope, dayKey, timeZone, context.signal);
    if (lines === null) return false;
    const { items, variants } = countPosOrders(lines);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.posItemRank.deleteMany({ where: { workspaceId: scope.workspaceId } });
        await tx.posVariantRank.deleteMany({ where: { workspaceId: scope.workspaceId } });
        if (items.length > 0) {
          await tx.posItemRank.createMany({
            data: items.map((entry) => ({ ...scope, itemId: entry.id, orders: entry.orders })),
          });
        }
        if (variants.length > 0) {
          await tx.posVariantRank.createMany({
            data: variants.map((entry) => ({
              ...scope,
              itemId: entry.itemId,
              variantId: entry.id,
              orders: entry.orders,
            })),
          });
        }
        await this.mark(tx, scope, dayKey, 'ranked', context.now);
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  /**
   * The lines of the store's finalised orders in the window — paid and unpaid
   * (released to pay later), so neither voided nor cancelled ones; a refund
   * leaves its order paid, and counted. Null when the run was told to stop.
   */
  private async linesOfWindow(
    scope: InScope,
    dayKey: string,
    timeZone: string,
    signal: AbortSignal,
  ): Promise<PosPopularityLine[] | null> {
    const { fromDay } = popularityWindow(dayKey);
    const gte = zonedStartOfDay(fromDay, timeZone);
    // The window ends where today starts: today is never counted.
    const lt = zonedStartOfDay(dayKey, timeZone);
    if (!gte || !lt) throw new Error(`Could not work out the ranking window for ${dayKey} in ${timeZone}.`);

    const lines: PosPopularityLine[] = [];
    let read = 0;
    let after: string | null = null;
    // Sequential on purpose: each page starts after the last id of the one before.
    while (read < POS_RANK_ORDERS_MAX) {
      if (signal.aborted) return null;
      const orders = await this.prisma.posOrder.findMany({
        where: {
          ...scope,
          status: { in: ['paid', 'unpaid'] },
          finalisedAt: { gte, lt },
          ...(after === null ? {} : { id: { gt: after } }),
        },
        orderBy: [{ id: 'asc' }],
        take: Math.min(ORDER_PAGE, POS_RANK_ORDERS_MAX - read),
      });
      if (orders.length === 0) break;
      const found = await this.prisma.posOrderLine.findMany({
        where: { orderId: { in: orders.map((order) => order.id) } },
        orderBy: [{ orderId: 'asc' }, { position: 'asc' }],
      });
      for (const line of found) lines.push({ orderId: line.orderId, itemId: line.itemId, variantId: line.variantId });
      read += orders.length;
      after = orders[orders.length - 1]?.id ?? null;
      if (orders.length < ORDER_PAGE) break;
    }
    return lines;
  }

  /** Records a day skipped as too late. False when another run recorded the day first. */
  private async record(scope: InScope, dayKey: string, outcome: PosRankingOutcome, now: Date): Promise<boolean> {
    try {
      await this.prisma.$transaction((tx) => this.mark(tx, scope, dayKey, outcome, now));
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  private async mark(
    tx: Pick<PosWriteClient, 'posRanking'>,
    scope: InScope,
    dayKey: string,
    outcome: PosRankingOutcome,
    now: Date,
  ): Promise<void> {
    const rankedFor = dayDate(dayKey);
    await tx.posRanking.upsert({
      where: { workspaceId: scope.workspaceId },
      create: { ...scope, rankedFor, outcome, rankedAt: now },
      update: { rankedFor, outcome, rankedAt: now },
    });
  }
}

/** A day key as a `@db.Date` column holds it: that day's UTC midnight, which has no zone of its own. */
function dayDate(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00.000Z`);
}
