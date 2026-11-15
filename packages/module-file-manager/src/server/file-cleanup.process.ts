import {
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  type ProcessHandler,
  type ProcessRunContext,
  type ProcessRunResult,
  type ProcessWorkspace,
  processOccurrence,
} from '@kwtech/module-kit';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { fileCleanupCutoff, fileCleanupMoment } from '../domain/retention.js';
import { FileEventPublisher } from './file.events.js';
import type { FileWriteClient, InScope } from './file.repository.js';
import { FileService } from './file.service.js';
import { FILE_PRISMA_WRITE, FILE_STORE } from './file.tokens.js';
import type { FileStore } from './ports.js';

/** Workspaces read per page: never all of them in memory (JOBS-PLAN §4c). */
const WORKSPACE_PAGE = 100;

/**
 * ⚠ HOW OLD a stray must be before it is removed, in milliseconds. An upload
 * still arriving is a `.part` written moments ago; an hour is longer than any
 * upload this server takes, and short enough that a dead one is gone tonight.
 */
const STRAY_AGE_MS = 3_600_000;

/**
 * `file.cleanup` — every night at 10 PM in each workspace's own time, deletes
 * the files older than the workspace keeps them, and the strays.
 *
 * Built to the rules every process answers for (JOBS-PLAN §4c):
 *
 *   SWEEPS      "which files here were uploaded before tonight's cutoff",
 *               workspace by workspace. No timer per file.
 *   IDEMPOTENT  BY WHAT IT DELETES, not by a row of its own: a deleted file
 *               stops matching, and the cutoff is measured from the SCHEDULED
 *               10 PM (`fileCleanupMoment`), so the several sweeps of one
 *               night — on time, late, or twice — delete exactly the same
 *               files. There is no notice to send once, so no claim to write.
 *   BATCHES     a page of workspaces, at most `maxItems` files a run, one
 *               small delete per file. The rest still match the next sweep.
 *   ANY TIME    each workspace's 10 PM, from the run's clock and the
 *               workspace's zone.
 *
 * ⚠ LATE IS STILL DONE. A reminder past its time is worse than none; a
 * clean-up is not, so `too_late` deletes as `due` does, and nothing is ever
 * counted as skipped.
 *
 * ⚠ THE ROW FIRST, THEN THE BYTES. A failure between them leaves bytes with no
 * row, which nobody can download and the stray sweep removes. The other order
 * would leave a row whose download is broken.
 */
@Injectable()
export class FileCleanupProcess implements ProcessHandler {
  private readonly logger = new Logger('FileCleanup');

  constructor(
    @Inject(FILE_PRISMA_WRITE) private readonly prisma: FileWriteClient,
    private readonly files: FileService,
    private readonly events: FileEventPublisher,
    /** Unbound: rows are deleted all the same; there are no bytes to remove and no strays to find. */
    @Optional() @Inject(FILE_STORE) private readonly store?: FileStore,
  ) {}

  async run(context: ProcessRunContext): Promise<ProcessRunResult> {
    const counts: ProcessRunResult = { handled: 0, skippedLate: 0, leftForNext: 0 };
    let cursor: string | null = null;
    // Sequential on purpose: the item limit is one budget across every workspace.
    do {
      const page = await context.workspaces(cursor, WORKSPACE_PAGE);
      for (const workspace of page.workspaces) {
        if (context.signal.aborted) return counts;
        const budget = context.maxItems - counts.handled;
        if (budget <= 0) {
          counts.leftForNext += 1;
          continue;
        }
        await this.sweep(workspace, context, budget, counts);
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
    return counts;
  }

  private async sweep(
    workspace: ProcessWorkspace,
    context: ProcessRunContext,
    budget: number,
    counts: ProcessRunResult,
  ): Promise<void> {
    // ⚠ Never UTC for a zone that cannot be read: that would move 10 PM to 6 AM.
    const timeZone = isValidTimeZone(workspace.timeZone) ? workspace.timeZone : DEFAULT_TIME_ZONE;
    const occurrence = processOccurrence(context.schedule, context.now, timeZone, context.tooLateAfterMinutes);
    if (occurrence.kind === 'none') return;

    const scope: InScope = { organizationId: workspace.organizationId, workspaceId: workspace.workspaceId };
    const moment = fileCleanupMoment(context.schedule, context.now, timeZone);
    const cutoff = fileCleanupCutoff(moment, await this.files.retentionHours(scope, this.prisma));

    const expired = await this.prisma.fileEntry.findMany({
      where: { ...scope, createdAt: { lt: cutoff } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: budget,
    });
    let deleted = 0;
    for (const file of expired) {
      if (context.signal.aborted) break;
      // Conditional on the cutoff: a file is never deleted on a stale read.
      const gone = await this.prisma.fileEntry.deleteMany({
        where: { ...scope, id: file.id, createdAt: { lt: cutoff } },
      });
      if (gone.count === 0) continue;
      deleted += 1;
      await this.removeBytes(scope.workspaceId, file.storageKey);
    }
    counts.handled += deleted;
    // The limit was reached here: what still matches waits for the next sweep, and is counted as waiting.
    if (expired.length === budget) {
      counts.leftForNext += await this.countLeft(scope, cutoff, budget);
    }

    if (!context.signal.aborted) counts.handled += await this.removeStrays(scope, context.now);
    if (deleted > 0) {
      await this.events.publish({
        ...scope,
        change: 'cleanup',
        fileId: null,
        actorId: null,
        before: null,
        after: null,
      });
    }
  }

  /** How many more files match after a full batch — read one batch further, never counted unbounded. */
  private async countLeft(scope: InScope, cutoff: Date, budget: number): Promise<number> {
    const next = await this.prisma.fileEntry.findMany({
      where: { ...scope, createdAt: { lt: cutoff } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: budget,
    });
    return next.length;
  }

  /** Bytes with no row: an upload that died, or a delete whose bytes could not be removed. */
  private async removeStrays(scope: InScope, now: Date): Promise<number> {
    if (!this.store) return 0;
    const stored = await this.store.list(scope.workspaceId);
    const old = stored.filter((entry) => now.getTime() - entry.modifiedAt.getTime() > STRAY_AGE_MS);
    if (old.length === 0) return 0;

    const finished = old.filter((entry) => !entry.partial).map((entry) => entry.storageKey);
    const known = new Set(
      finished.length === 0
        ? []
        : (
            await this.prisma.fileEntry.findMany({
              where: { ...scope, storageKey: { in: finished } },
              orderBy: [{ id: 'asc' }],
              take: finished.length,
            })
          ).map((file) => file.storageKey),
    );
    let removed = 0;
    for (const entry of old) {
      if (!entry.partial && known.has(entry.storageKey)) continue;
      await this.removeBytes(scope.workspaceId, entry.storageKey);
      removed += 1;
    }
    return removed;
  }

  private async removeBytes(workspaceId: string, storageKey: string): Promise<void> {
    try {
      await this.store?.remove(workspaceId, storageKey);
    } catch (error) {
      // Counts and errors, never names: app-level staff read this.
      this.logger.warn({ event: 'file.cleanup_remove_failed', workspaceId, error: String(error) });
    }
  }
}
