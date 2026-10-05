import type { ProcessHandler, ProcessRunContext, ProcessRunResult } from '@kwtech/module-kit';
import { Inject, Injectable } from '@nestjs/common';
import { logCutoff, STUDIO_LOG_RETENTION_DAYS } from '../domain/log.js';
import type { StudioModuleOptions } from './studio.options.js';
import type { StudioWriteClient } from './studio.repository.js';
import { STUDIO_OPTIONS, STUDIO_PRISMA_WRITE } from './studio.tokens.js';

/** Workspaces read per page: never all of them in memory (JOBS-PLAN §4c). */
const WORKSPACE_PAGE = 100;

/**
 * `studio.prune_logs` — print history older than the keep is deleted
 * (PRINT-STUDIO-PLAN decision 22).
 *
 * The history names the files that were printed, and a file name is often a
 * customer's name. Kept for ever it becomes a list of everybody a shop ever
 * served; so it is kept for a set number of days (`logRetentionDays`, 90 unless
 * the host says otherwise) and then removed.
 *
 * Built to the rules every process answers for (JOBS-PLAN §4c):
 *
 *   SWEEPS      "which entries here are past the keep", workspace by
 *               workspace. No timer per entry.
 *   IDEMPOTENT  by nature: it is a delete of everything older than a cutoff.
 *               Run twice, the second finds nothing. Two runs at once delete
 *               the same rows and neither is wrong.
 *   BATCHES     one delete per workspace, and at most `maxItems` workspaces
 *               PRUNED a run. ⚠ A workspace with nothing old does not use up
 *               the budget: a run always starts from the first workspace, so
 *               counting those would mean the same early ones spent it every
 *               night and a late one was never reached. A pruned workspace
 *               has nothing left tomorrow, so the budget moves down the list.
 *   ANY TIME    measured from the run's own clock. ⚠ NOTHING IS EVER TOO LATE
 *               to prune: skipping an entry found late would keep it for ever.
 *               So `skippedLate` is always 0 here.
 *
 * ⚠ IT TELLS NOBODY, and returns counts only: `handled` is the number of
 * entries deleted across every workspace — never a name, never a workspace.
 */
@Injectable()
export class StudioPruneLogsProcess implements ProcessHandler {
  constructor(
    @Inject(STUDIO_PRISMA_WRITE) private readonly prisma: StudioWriteClient,
    @Inject(STUDIO_OPTIONS) private readonly options: StudioModuleOptions,
  ) {}

  async run(context: ProcessRunContext): Promise<ProcessRunResult> {
    const counts: ProcessRunResult = { handled: 0, skippedLate: 0, leftForNext: 0 };
    const cutoff = logCutoff(context.now, this.options.logRetentionDays ?? STUDIO_LOG_RETENTION_DAYS);

    let pruned = 0;
    let cursor: string | null = null;
    // Sequential on purpose: the workspace limit is one budget across the whole run.
    do {
      const page = await context.workspaces(cursor, WORKSPACE_PAGE);
      for (const workspace of page.workspaces) {
        if (context.signal.aborted) return counts;
        if (pruned >= context.maxItems) {
          // An unknown number of workspaces remain. One is counted, to say "not finished" without a full scan.
          counts.leftForNext += 1;
          return counts;
        }
        const gone = await this.prisma.studioLog.deleteMany({
          where: {
            organizationId: workspace.organizationId,
            workspaceId: workspace.workspaceId,
            createdAt: { lt: cutoff },
          },
        });
        counts.handled += gone.count;
        if (gone.count > 0) pruned += 1;
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
    return counts;
  }
}
