import {
  effectiveProcessSchedule,
  type ProcessContribution,
  type ProcessSchedule,
  parseProcessSchedule,
  processCadenceMinutes,
} from '@kwtech/module-kit';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { nextCheckAt, processStanding } from '../domain/controls.js';
import {
  encodeHistoryCursor,
  historyPageSize,
  JOB_HISTORY_TIE_ALLOWANCE,
  mergeHistory,
  parseHistoryCursor,
} from '../domain/history.js';
import { adminSchedule } from '../domain/schedule.js';
import type { JobProcessStanding, JobRunState } from '../types.js';
import { JobsWriteError } from './jobs.errors.js';
import type { ResolvedJobsOptions } from './jobs.options.js';
import type { JobControlRow, JobProcessRow, JobRunRow, JobsPrismaClient } from './jobs.repository.js';
import { JOBS_ACTOR_DIRECTORY, JOBS_OPTIONS, JOBS_PRISMA } from './jobs.tokens.js';
import type { JobsActorDirectory } from './ports.js';

/** A run as the admin page shows it: the row, and the name of whoever forced it. */
export interface JobRunView extends JobRunRow {
  /** Null for a scheduled run, and when nobody can say who the person is. */
  forcedByName: string | null;
}

/** A process as the admin page shows it. */
export interface JobProcessView {
  /** ⚠ From the CODE, never the row's mirror: what this build declares is what runs. */
  declaration: ProcessContribution;
  /** The schedule in force. */
  schedule: ProcessSchedule;
  /** True when no schedule of an admin's is in force. */
  scheduleIsDefault: boolean;
  /** An admin set one that the declaration no longer allows, so the default runs instead. */
  scheduleOverrideIgnored: boolean;
  scheduleSetAt: Date | null;
  scheduleSetByName: string | null;
  standing: JobProcessStanding;
  /** 1 for the next to start. Null unless it is queued. */
  queuePosition: number | null;
  pausedAt: Date | null;
  pausedByName: string | null;
  pauseReason: string | null;
  /** The run queued or under way. */
  activeRun: JobRunView | null;
  /** The last run that ended, however it ended. */
  lastRun: JobRunView | null;
  /** Why its last finished run failed. Null unless it is failing. */
  failingError: string | null;
  /** When the runner next queues it. Null while it cannot be queued: paused, never synced, or already queued. */
  nextCheckAt: Date | null;
}

export interface JobControlView extends JobControlRow {
  actorName: string | null;
  from: ProcessSchedule | null;
  to: ProcessSchedule | null;
}

export interface JobHistoryEntryView {
  id: string;
  kind: 'run' | 'control';
  at: Date;
  run: JobRunView | null;
  control: JobControlView | null;
}

export interface JobHistoryPageView {
  entries: JobHistoryEntryView[];
  nextCursor: string | null;
}

/** Every state a run can END in. */
const ENDED: JobRunState[] = ['succeeded', 'failed', 'skipped', 'interrupted'];
/** The two that say how the PROCESS did, which is what "failing" is judged on. */
const OUTCOMES: JobRunState[] = ['succeeded', 'failed'];

/** More queued runs than this cannot exist: a process is queued at most once. Read with room. */
const QUEUE_READ_LIMIT = 500;

const NEWEST_RUN_FIRST = [{ queuedAt: 'desc' as const }, { id: 'desc' as const }];

/**
 * THE ADMIN PAGE'S READS (JOBS-PLAN §7): every process and how it stands, and
 * one process's history.
 *
 * ⚠ IT LISTS WHAT THIS BUILD DECLARES, and nothing else. A row left by a
 * module that was composed once is not shown (the sync retires it), and a
 * process declared but never synced IS shown, as unable to run until
 * `db:sync` — the one state an operator can fix and would otherwise never see.
 *
 * ⚠ Every method takes `now`. This class never reads the clock.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger('Jobs');
  private readonly declarations: ReadonlyMap<string, ProcessContribution>;

  constructor(
    @Inject(JOBS_PRISMA) private readonly prisma: JobsPrismaClient,
    @Inject(JOBS_OPTIONS) options: ResolvedJobsOptions,
    /** Absent: no names. The page says "an administrator". */
    @Optional() @Inject(JOBS_ACTOR_DIRECTORY) private readonly directory?: JobsActorDirectory,
  ) {
    if (!prisma) {
      throw new Error('JobsService needs a client. Bind JOBS_PRISMA via prismaProvider in jobsServerModule.');
    }
    this.declarations = new Map(options.processes.map((process) => [process.key, process]));
  }

  /** Every process this build declares, by module and then key: the order the page groups in. */
  async processes(now: Date): Promise<JobProcessView[]> {
    const declarations = [...this.declarations.values()].sort(
      (a, b) => a.module.localeCompare(b.module) || a.key.localeCompare(b.key),
    );
    return this.describe(declarations, now);
  }

  /** One process, re-read after a control action so the page shows what the database now holds. */
  async process(processKey: string, now: Date): Promise<JobProcessView> {
    const [view] = await this.describe([this.declared(processKey)], now);
    if (!view) throw new JobsWriteError('unknown_process');
    return view;
  }

  /**
   * A page of one process's history: its runs and its control actions, merged,
   * newest first.
   */
  async history(processKey: string, cursor: string | null, limit: number | null): Promise<JobHistoryPageView> {
    this.declared(processKey);
    const from = cursor === null ? null : parseHistoryCursor(cursor);
    if (cursor !== null && from === null) throw new JobsWriteError('invalid_cursor');

    const size = historyPageSize(limit);
    // One more than the page, to know whether another follows; and the ties — see `JOB_HISTORY_TIE_ALLOWANCE`.
    const take = size + 1 + JOB_HISTORY_TIE_ALLOWANCE;
    const [runs, controls] = await Promise.all([
      this.prisma.jobRun.findMany({
        where: { processKey, ...(from ? { queuedAt: { lte: from.at } } : {}) },
        orderBy: NEWEST_RUN_FIRST,
        take,
      }),
      this.prisma.jobControl.findMany({
        where: { processKey, ...(from ? { createdAt: { lte: from.at } } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      }),
    ]);

    const page = mergeHistory(runs, controls, from, size);
    const names = await this.names(
      page.items.map((item) => (item.entry.kind === 'run' ? item.entry.run.forcedById : item.entry.control.actorId)),
    );
    return {
      entries: page.items.map((item) => ({
        id: item.id,
        kind: item.entry.kind,
        at: item.at,
        run: item.entry.kind === 'run' ? withForcer(item.entry.run, names) : null,
        control: item.entry.kind === 'control' ? withActor(item.entry.control, names) : null,
      })),
      nextCursor: page.nextCursor ? encodeHistoryCursor(page.nextCursor) : null,
    };
  }

  /** The declaration behind a key, or the refusal: a process this build does not have cannot be shown or controlled. */
  private declared(processKey: string): ProcessContribution {
    const declaration = this.declarations.get(processKey);
    if (!declaration) throw new JobsWriteError('unknown_process');
    return declaration;
  }

  private async describe(declarations: readonly ProcessContribution[], now: Date): Promise<JobProcessView[]> {
    const [rows, queue] = await Promise.all([
      this.prisma.jobProcess.findMany({ where: { deprecatedAt: null }, orderBy: [{ key: 'asc' }] }),
      // The queue in the order it will be taken (`claimNext`), for "second in the queue".
      this.prisma.jobRun.findMany({
        where: { state: 'queued' },
        orderBy: [{ queuedAt: 'asc' }, { processKey: 'asc' }, { id: 'asc' }],
        take: QUEUE_READ_LIMIT,
      }),
    ]);
    const rowByKey = new Map(rows.map((row) => [row.key, row]));
    const shown = declarations.map((declaration) => rowByKey.get(declaration.key)).filter((row) => row !== undefined);

    const activeIds = shown.map((row) => row.activeRunId).filter((id) => id !== null);
    const [active, lasts] = await Promise.all([
      activeIds.length === 0
        ? Promise.resolve([])
        : this.prisma.jobRun.findMany({
            where: { id: { in: activeIds } },
            orderBy: [{ id: 'asc' }],
            take: activeIds.length,
          }),
      // Independent reads, a pair per process; processes are few (one or two a module).
      Promise.all(shown.map((row) => this.lastRuns(row.key))),
    ]);
    const activeById = new Map(active.map((run) => [run.id, run]));
    const lastByKey = new Map(shown.map((row, index) => [row.key, lasts[index]]));

    const names = await this.names([
      ...shown.flatMap((row) => [row.pausedById, row.scheduleSetAt === null ? null : row.scheduleSetById]),
      ...active.map((run) => run.forcedById),
      ...lasts.map((last) => last.ended?.forcedById ?? null),
    ]);

    return declarations.map((declaration) => {
      const row = rowByKey.get(declaration.key) ?? null;
      const last = lastByKey.get(declaration.key) ?? NO_RUNS;
      const activeRun = row?.activeRunId ? (activeById.get(row.activeRunId) ?? null) : null;
      return describeProcess({ declaration, row, activeRun, last, queue, names, now });
    });
  }

  /** A process's last ended run, and the last that says how the process itself did. */
  private async lastRuns(processKey: string): Promise<LastRuns> {
    const [ended] = await this.prisma.jobRun.findMany({
      where: { processKey, state: { in: ENDED } },
      orderBy: NEWEST_RUN_FIRST,
      take: 1,
    });
    if (!ended) return NO_RUNS;
    if (ended.state === 'succeeded' || ended.state === 'failed') return { ended, outcome: ended };
    // Skipped or interrupted says nothing about the process: look past it.
    const [outcome] = await this.prisma.jobRun.findMany({
      where: { processKey, state: { in: OUTCOMES } },
      orderBy: NEWEST_RUN_FIRST,
      take: 1,
    });
    return { ended, outcome: outcome ?? null };
  }

  /**
   * Names for ids, or none.
   *
   * ⚠ A look-up that fails never fails the page: who did it is a courtesy
   * beside what was done, and the id is still on the row.
   */
  private async names(userIds: ReadonlyArray<string | null>): Promise<ReadonlyMap<string, string>> {
    const ids = [...new Set(userIds.filter((id) => id !== null))];
    if (!this.directory || ids.length === 0) return NO_NAMES;
    try {
      return await this.directory.names(ids);
    } catch (error) {
      this.logger.warn(`Could not read who acted on the processes: ${(error as Error).message}`);
      return NO_NAMES;
    }
  }
}

interface LastRuns {
  ended: JobRunRow | null;
  outcome: JobRunRow | null;
}

const NO_RUNS: LastRuns = { ended: null, outcome: null };
const NO_NAMES: ReadonlyMap<string, string> = new Map();

function withForcer(run: JobRunRow, names: ReadonlyMap<string, string>): JobRunView {
  return { ...run, forcedByName: run.forcedById ? (names.get(run.forcedById) ?? null) : null };
}

function withActor(control: JobControlRow, names: ReadonlyMap<string, string>): JobControlView {
  return {
    ...control,
    actorName: names.get(control.actorId) ?? null,
    from: parseProcessSchedule(control.scheduleFrom),
    to: parseProcessSchedule(control.scheduleTo),
  };
}

/** Kept apart from the reads so the arithmetic of one process is one place. */
function describeProcess(facts: {
  declaration: ProcessContribution;
  row: JobProcessRow | null;
  activeRun: JobRunRow | null;
  last: LastRuns;
  queue: readonly JobRunRow[];
  names: ReadonlyMap<string, string>;
  now: Date;
}): JobProcessView {
  const { declaration, row, activeRun, last, names, now } = facts;
  const override = row ? adminSchedule(row) : null;
  const { schedule, overrideIgnored } = effectiveProcessSchedule(declaration, override);
  const lastOutcome = last.outcome?.state === 'failed' ? 'failed' : last.outcome ? 'succeeded' : null;
  const standing = processStanding({
    synced: row !== null,
    pausedAt: row?.pausedAt ?? null,
    activeRunState: activeRun?.state ?? null,
    lastOutcome,
  });
  const position = activeRun ? facts.queue.findIndex((run) => run.id === activeRun.id) : -1;
  // Only a process the runner could queue has a next check.
  const waiting = standing === 'idle' || standing === 'failing';

  return {
    declaration,
    schedule,
    scheduleIsDefault: override == null,
    scheduleOverrideIgnored: overrideIgnored,
    scheduleSetAt: override == null ? null : (row?.scheduleSetAt ?? null),
    scheduleSetByName: override != null && row?.scheduleSetById ? (names.get(row.scheduleSetById) ?? null) : null,
    standing,
    queuePosition: position >= 0 ? position + 1 : null,
    pausedAt: row?.pausedAt ?? null,
    pausedByName: row?.pausedById ? (names.get(row.pausedById) ?? null) : null,
    pauseReason: row?.pauseReason ?? null,
    activeRun: activeRun ? withForcer(activeRun, names) : null,
    lastRun: last.ended ? withForcer(last.ended, names) : null,
    failingError: standing === 'failing' ? (last.outcome?.error ?? null) : null,
    nextCheckAt:
      row && waiting
        ? nextCheckAt(row.lastQueuedAt, processCadenceMinutes(schedule, declaration.scheduleLimits), now)
        : null,
  };
}
