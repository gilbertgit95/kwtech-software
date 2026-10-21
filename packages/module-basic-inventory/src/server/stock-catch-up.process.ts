import type { ProcessHandler, ProcessRunContext, ProcessRunResult, ProcessWorkspace } from '@kwtech/module-kit';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { STOCK_CATCH_UP_OVERLAP_MS } from '../processes.js';
import type { StockSaleFeed } from './ports.js';
import type { StockWriteClient } from './stock.repository.js';
import { STOCK_PRISMA_WRITE, STOCK_SALE_FEED } from './stock.tokens.js';
import { StockIntakeService } from './stock-intake.service.js';

/** Workspaces read per page: never all of them in memory (JOBS-PLAN §4c). */
const WORKSPACE_PAGE = 100;

/** Events asked of the feed at once, per workspace. */
const FEED_PAGE = 200;

/**
 * `stock.catch_up` — takes off stock the point-of-sale lines whose push was
 * lost (INVENTORY-PLAN §5).
 *
 * Built to the rules every process answers for (JOBS-PLAN §4c):
 *
 *   SWEEPS      per workspace, "what did the POS do since my cursor", read a
 *               little before it (`STOCK_CATCH_UP_OVERLAP_MS`) so an event
 *               committed while the last run read is not missed.
 *   IDEMPOTENT  by the movements' own key (`@@unique([workspaceId, sourceKey,
 *               stockItemId])`): an event the push already recorded is skipped,
 *               so reading back over the overlap costs nothing.
 *   BATCHES     a page of events at a time, at most `maxItems` a run, one small
 *               transaction per event. The cursor moves after each page, so the
 *               next run starts where this one stopped.
 *   ANY TIME    nothing here is a time of day: it reads instants, and a late
 *               run simply finds more.
 *
 * ⚠ ONLY WORKSPACES WITH A CURSOR. The cursor starts when the store first hangs
 * a list on a product; before that no sale took stock, and there is nothing to
 * catch up on.
 */
@Injectable()
export class StockCatchUpProcess implements ProcessHandler {
  private readonly logger = new Logger('StockCatchUp');

  constructor(
    @Inject(STOCK_PRISMA_WRITE) private readonly prisma: StockWriteClient,
    private readonly intake: StockIntakeService,
    /** Unbound: there is no feed, and the run does nothing. */
    @Optional() @Inject(STOCK_SALE_FEED) private readonly feed?: StockSaleFeed,
  ) {}

  async run(context: ProcessRunContext): Promise<ProcessRunResult> {
    const counts: ProcessRunResult = { handled: 0, skippedLate: 0, leftForNext: 0 };
    if (!this.feed) return counts;

    let cursor: string | null = null;
    // Sequential on purpose: the item limit is one budget across every workspace.
    do {
      const page = await context.workspaces(cursor, WORKSPACE_PAGE);
      for (const workspace of page.workspaces) {
        if (context.signal.aborted) return counts;
        const full = await this.sweep(this.feed, workspace, context, counts);
        if (full) return counts;
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
    return counts;
  }

  /** One workspace. True when the run's item limit was reached in it. */
  private async sweep(
    feed: StockSaleFeed,
    workspace: ProcessWorkspace,
    context: ProcessRunContext,
    counts: ProcessRunResult,
  ): Promise<boolean> {
    const scope = { organizationId: workspace.organizationId, workspaceId: workspace.workspaceId };
    const mark = await this.prisma.stockFeedCursor.findFirst({
      where: { workspaceId: scope.workspaceId, source: 'pos' },
    });
    if (!mark) return false;

    let since = new Date(mark.through.getTime() - STOCK_CATCH_UP_OVERLAP_MS);
    let through = mark.through;
    for (;;) {
      if (context.signal.aborted) return true;
      const budget = context.maxItems - counts.handled;
      if (budget <= 0) {
        counts.leftForNext += 1;
        return true;
      }
      let events: Awaited<ReturnType<StockSaleFeed['eventsSince']>>;
      try {
        events = await feed.eventsSince(scope.organizationId, scope.workspaceId, since, Math.min(FEED_PAGE, budget));
      } catch (error) {
        // One workspace's feed failing must not stop the others; the next run tries again from the same cursor.
        this.logger.warn(`The point of sale's feed could not be read for a workspace: ${(error as Error).message}`);
        return false;
      }
      if (events.length === 0) break;
      const result = await this.intake.apply(scope, events);
      counts.handled += result.recorded + result.skipped;
      const last = events.at(-1);
      const lastAt = last ? new Date(last.at) : since;
      if (lastAt > through) through = lastAt;
      // The cursor never moves back, and never past the run's own clock.
      await this.prisma.stockFeedCursor.updateMany({
        where: { workspaceId: scope.workspaceId, source: 'pos' },
        data: { through: through > context.now ? context.now : through },
      });
      if (events.length < FEED_PAGE) break;
      /*
       * ⚠ The next page starts AT the last event's time, not after it: two
       * events in the same millisecond would otherwise lose the second. The
       * first ones read again are skipped by their keys.
       */
      if (lastAt.getTime() <= since.getTime()) {
        // A page of events all at one instant: step past it rather than loop forever.
        since = new Date(lastAt.getTime() + 1);
      } else {
        since = lastAt;
      }
    }
    return false;
  }
}
