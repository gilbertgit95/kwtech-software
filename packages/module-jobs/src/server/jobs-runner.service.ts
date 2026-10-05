import {
  effectiveProcessSchedule,
  type ProcessContribution,
  type ProcessHandler,
  type ProcessRunContext,
  type ProcessRunResult,
  type ProcessWorkspacePage,
} from '@kwtech/module-kit';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { runCount, runErrorText } from '../domain/queue.js';
import type { ResolvedJobsOptions } from './jobs.options.js';
import type { JobProcessRow, JobRunRow } from './jobs.repository.js';
import { JOBS_ENTITLED_WORKSPACES, JOBS_OPTIONS } from './jobs.tokens.js';
import { type JobClaim, type JobRunSettlement, JobsQueueService } from './jobs-queue.service.js';
import type { JobsEntitledWorkspaces } from './ports.js';

type Claimed = Extract<JobClaim, { kind: 'claimed' }>;

const EMPTY_PAGE: ProcessWorkspacePage = { workspaces: [], nextCursor: null };

const NO_ENTITLEMENT_SOURCE =
  'Nothing answers which workspaces are entitled to it, so it reached none. Bind JOBS_ENTITLED_WORKSPACES.';
const ENTITLEMENT_UNREADABLE = 'The entitled workspaces could not be read, so it reached none';

/**
 * THE RUNNER: wakes, queues what is due, and runs what is queued — a few at a
 * time, each inside its time limit.
 *
 * It schedules, locks, records and stops. ⚠ IT HOLDS NO LOGIC OF ANY MODULE:
 * what is due, who is told and how late is too late are the process's own
 * (JOBS-PLAN §4a). It knows a process only as a declaration and a handler.
 *
 * ## What one wake-up does
 *
 *   1. lets go of runs whose server died (`reapLapsed`);
 *   2. queues every process whose schedule has come round (`enqueueDue`);
 *   3. takes runs off the queue while a slot is free, and starts them.
 *
 * A run is NOT awaited by the wake-up: it may outlast many. When one ends, the
 * queue is asked again at once, so the next does not wait for the next tick.
 *
 * ⚠ ONE FAILING PROCESS STOPS NOTHING ELSE. A throw is caught and written on
 * that run; a wake-up that cannot reach the database is logged and tried again
 * next time. Nothing here can crash the server it runs inside.
 */
@Injectable()
export class JobsRunnerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Jobs');
  private readonly handlers = new Map<string, ProcessHandler>();
  /** Runs under way in THIS process, with the switch that stops each. */
  private readonly inFlight = new Map<string, { controller: AbortController; work: Promise<void> }>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private draining = false;
  private drainAgain = false;
  private stopped = false;
  /** Keys already warned about, so a missing sync is said once and not every 30 seconds. */
  private readonly warnedUnsynced = new Set<string>();

  constructor(
    private readonly queue: JobsQueueService,
    @Inject(JOBS_OPTIONS) private readonly options: ResolvedJobsOptions,
    /** Unbound in a test that hands its handlers over as objects. */
    @Optional() private readonly moduleRef?: ModuleRef,
    /** Unbound: a process serving a feature reaches no workspace. */
    @Optional() @Inject(JOBS_ENTITLED_WORKSPACES) private readonly entitled?: JobsEntitledWorkspaces,
  ) {}

  /**
   * Resolves every handler, then starts waking.
   *
   * ⚠ Handlers are resolved on EVERY instance, runner or not: a process whose
   * handler is not a provider is a wiring bug, and it should fail the boot of
   * whichever server is deployed first rather than the first run at 8:00.
   *
   * `onApplicationBootstrap` rather than `onModuleInit`: by now every module's
   * providers exist, whatever order Nest initialised them in.
   */
  onApplicationBootstrap(): void {
    for (const process of this.options.processes) this.handlers.set(process.key, this.resolveHandler(process));

    if (!this.options.runner) {
      this.logger.log('The runner is off on this server: it queues and runs no process.');
      return;
    }
    this.logger.log(
      `Running ${this.handlers.size} process(es), at most ${this.options.maxConcurrentRuns} at once, ` +
        `waking every ${this.options.tickSeconds}s.`,
    );
    this.timer = setInterval(() => void this.tick(), this.options.tickSeconds * 1000);
    // The runner must never be what keeps a process alive that was told to exit.
    this.timer.unref();
  }

  /** Stops waking and tells every run under way to stop. Their rows are let go by the lease. */
  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const { controller } of this.inFlight.values()) controller.abort();
  }

  /**
   * One wake-up. Public so a test — and "Run now", later — can drive it
   * without waiting for the clock.
   *
   * ⚠ Never overlaps itself: a wake-up still going when the next is due is
   * simply the one that does the work.
   */
  async tick(now: Date = new Date()): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      const reaped = await this.queue.reapLapsed(now);
      if (reaped > 0) this.logger.warn(`${reaped} run(s) were interrupted: the server running them stopped.`);

      const { unsynced } = await this.queue.enqueueDue(now);
      this.warnUnsynced(unsynced);

      await this.drain(now);
    } catch (error) {
      this.logger.error(`A wake-up failed and will be tried again: ${runErrorText(error)}`);
    } finally {
      this.ticking = false;
    }
  }

  /** Resolves once nothing is under way in this process. For tests and for a clean shutdown. */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.all([...this.inFlight.values()].map((entry) => entry.work));
  }

  /**
   * Starts queued runs while a slot is free.
   *
   * ⚠ One drain at a time in this process, and a request made during one is
   * remembered rather than dropped: a run ending while the queue is being read
   * must still lead to the queue being read again.
   */
  private async drain(now: Date): Promise<void> {
    if (this.draining) {
      this.drainAgain = true;
      return;
    }
    this.draining = true;
    try {
      do {
        this.drainAgain = false;
        await this.startQueued(now);
      } while (this.drainAgain && !this.stopped);
    } finally {
      this.draining = false;
    }
  }

  private async startQueued(now: Date): Promise<void> {
    while (!this.stopped) {
      const claim = await this.queue.claimNext(now);
      if (claim.kind === 'none') return;
      if (claim.kind === 'skipped') continue;

      const controller = new AbortController();
      this.inFlight.set(claim.run.id, { controller, work: this.runThenRefill(claim, controller) });
    }
  }

  /** Runs one claimed run to its end, then asks the queue for the next. Never throws. */
  private async runThenRefill(claim: Claimed, controller: AbortController): Promise<void> {
    try {
      const settlement = await this.execute(claim, controller);
      const written = await this.queue.finish(claim.run.id, settlement, new Date());
      if (!written)
        this.logger.warn(`'${claim.run.processKey}' finished after its lease lapsed; its result was dropped.`);
      if (settlement.state === 'failed') this.logger.warn(`'${claim.run.processKey}' failed: ${settlement.error}`);
    } catch (error) {
      // Only the database write can land here: the row stays `running` and the lease lets it go.
      this.logger.error(`Could not record the end of '${claim.run.processKey}': ${runErrorText(error)}`);
    } finally {
      this.inFlight.delete(claim.run.id);
    }
    try {
      await this.drain(new Date());
    } catch (error) {
      this.logger.error(`Could not read the queue after a run: ${runErrorText(error)}`);
    }
  }

  /**
   * Runs the process's handler inside its time limit, and says how it ended.
   *
   * ⚠ A run past its limit is marked FAILED and the queue moves on. JavaScript
   * cannot stop a function, so the handler is TOLD to stop (`signal`) and its
   * late result ignored: a process that never checks the signal wastes its own
   * work, not the queue's time.
   */
  private async execute(claim: Claimed, controller: AbortController): Promise<JobRunSettlement> {
    const { declaration, process, run } = claim;
    const handler = this.handlers.get(declaration.key);
    if (!handler) return { state: 'skipped', note: 'Its handler was never resolved on this server.' };
    if (declaration.serves !== null && !this.entitled) return { state: 'skipped', note: NO_ENTITLEMENT_SOURCE };

    const unreadable: { reason: string | null } = { reason: null };
    const context = this.contextFor(declaration, process, run, controller.signal, unreadable);

    let limit: NodeJS.Timeout | undefined;
    const timedOut = new Promise<{ kind: 'timed_out' }>((resolve) => {
      limit = setTimeout(() => resolve({ kind: 'timed_out' }), declaration.maxRunSeconds * 1000);
    });
    try {
      const outcome = await Promise.race([attempt(handler, context), timedOut]);
      switch (outcome.kind) {
        case 'timed_out':
          return {
            state: 'failed',
            error: `It ran past its limit of ${declaration.maxRunSeconds} seconds and was stopped.`,
          };
        case 'threw':
          // ⚠ D12: unreadable entitlements are "reached no workspace", not a failure of the process.
          if (unreadable.reason !== null) {
            return { state: 'skipped', note: `${ENTITLEMENT_UNREADABLE}: ${unreadable.reason}` };
          }
          return { state: 'failed', error: runErrorText(outcome.error) };
        case 'done':
          return {
            state: 'succeeded',
            handled: runCount(outcome.result?.handled),
            skippedLate: runCount(outcome.result?.skippedLate),
            leftForNext: runCount(outcome.result?.leftForNext),
          };
      }
    } finally {
      clearTimeout(limit);
      // Whatever happened, the handler is told the run is over.
      controller.abort();
    }
  }

  private contextFor(
    declaration: ProcessContribution,
    process: JobProcessRow,
    run: JobRunRow,
    signal: AbortSignal,
    unreadable: { reason: string | null },
  ): ProcessRunContext {
    const { serves } = declaration;
    const entitled = this.entitled;
    return {
      // When the run STARTED: one clock for the whole run, as the contract says.
      now: run.startedAt ?? new Date(),
      schedule: effectiveProcessSchedule(declaration, process.schedule).schedule,
      maxItems: declaration.maxItemsPerRun,
      tooLateAfterMinutes: declaration.tooLateAfterMinutes,
      signal,
      async workspaces(cursor, limit) {
        // A process that serves nothing is handed nothing — never "every workspace".
        if (serves === null || !entitled) return EMPTY_PAGE;
        try {
          return await entitled.page(serves, cursor, limit);
        } catch (error) {
          unreadable.reason = runErrorText(error);
          throw error;
        }
      },
    };
  }

  /**
   * The handler behind a contribution: an object with `run` as it is, anything
   * else as an injection token resolved from the WHOLE container (`strict:
   * false`), because the handler lives in its own module's injector, not this
   * one's.
   */
  private resolveHandler(process: ProcessContribution): ProcessHandler {
    if (isHandler(process.handler)) return process.handler;
    let resolved: unknown;
    try {
      resolved = this.moduleRef?.get(process.handler as never, { strict: false });
    } catch {
      resolved = undefined;
    }
    if (isHandler(resolved)) return resolved;
    throw new Error(
      `Process '${process.key}' has no handler the runner can resolve. Its module must list the handler class in ` +
        "its Nest module's providers, and it must implement ProcessHandler (a `run` method).",
    );
  }

  private warnUnsynced(keys: readonly string[]): void {
    const fresh = keys.filter((key) => !this.warnedUnsynced.has(key));
    if (fresh.length === 0) return;
    for (const key of fresh) this.warnedUnsynced.add(key);
    this.logger.warn(
      `Not running ${fresh.join(', ')}: declared in code but never synced. ` +
        'Run `pnpm --filter @kwtech/web-server db:sync`.',
    );
  }
}

function isHandler(value: unknown): value is ProcessHandler {
  return typeof value === 'object' && value !== null && typeof (value as { run?: unknown }).run === 'function';
}

/** The handler's run as a value, so a throw is an outcome to record rather than an exception to chase. */
async function attempt(
  handler: ProcessHandler,
  context: ProcessRunContext,
): Promise<{ kind: 'done'; result: ProcessRunResult | undefined } | { kind: 'threw'; error: unknown }> {
  try {
    return { kind: 'done', result: await handler.run(context) };
  } catch (error) {
    return { kind: 'threw', error };
  }
}
