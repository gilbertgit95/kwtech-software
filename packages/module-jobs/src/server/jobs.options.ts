import type { ProcessContribution } from '@kwtech/module-kit';
import { JOBS_MAX_CONCURRENT_RUNS, JOBS_MAX_RUN_SECONDS_CEILING, JOBS_TICK_SECONDS } from '../domain/queue.js';

/**
 * What the host supplies, and what it may leave out.
 *
 * Every seam is a NAMED PORT with a documented default, and the host's total
 * comes to one descriptor plus the one adapter only it can write.
 */
export interface JobsModuleOptions {
  /** The write client, which must expose `$transaction`. Structural, host-injected. */
  prismaWriteProvider?: unknown;

  /**
   * Every process the application's modules declare: `composeProcesses(…)` over
   * the app's server descriptors. ⚠ The runner runs these and ONLY these — an
   * application without a module has none of its processes, with nothing to
   * switch off. Omitted: there is nothing to run.
   */
  processes?: readonly ProcessContribution[];

  /** A `JobsEntitledWorkspaces` provider. ⚠ Unbound: a process serving a feature reaches no workspace. */
  entitledWorkspacesProvider?: unknown;

  /** Modules the host wants visible inside this one's injector. */
  imports?: unknown[];

  /**
   * Whether THIS server takes runs off the queue. Default true.
   *
   * ⚠ False does not stop the processes: it makes this instance an API that
   * runs none, for a deployment where another instance (a worker, JOBS-PLAN §8)
   * does. With it false everywhere, nothing runs and nothing says so but the
   * boot log.
   */
  runner?: boolean | undefined;

  /**
   * How many runs may be under way at once (default 2). ⚠ Counted in the
   * database, so more server instances do not raise it.
   */
  maxConcurrentRuns?: number | undefined;

  /** Seconds between wake-ups (default 30). */
  tickSeconds?: number | undefined;

  /**
   * Seconds: the longest any process may declare for one run (default 300).
   * A declaration above it fails the boot rather than being silently cut.
   */
  maxRunSecondsCeiling?: number | undefined;
}

/** The options with every default applied — what the services read. */
export interface ResolvedJobsOptions {
  processes: readonly ProcessContribution[];
  runner: boolean;
  maxConcurrentRuns: number;
  tickSeconds: number;
  maxRunSecondsCeiling: number;
}

/**
 * Applies the defaults and refuses what cannot work, at BOOT.
 *
 * ⚠ A process whose `maxRunSeconds` is above the runner's ceiling throws here,
 * naming it. Cutting it down silently would stop a run its developer sized
 * deliberately, and letting it through would let one module hold the shared
 * queue for as long as it liked.
 */
export function resolveJobsOptions(options: JobsModuleOptions): ResolvedJobsOptions {
  const resolved: ResolvedJobsOptions = {
    processes: options.processes ?? [],
    runner: options.runner ?? true,
    maxConcurrentRuns: options.maxConcurrentRuns ?? JOBS_MAX_CONCURRENT_RUNS,
    tickSeconds: options.tickSeconds ?? JOBS_TICK_SECONDS,
    maxRunSecondsCeiling: options.maxRunSecondsCeiling ?? JOBS_MAX_RUN_SECONDS_CEILING,
  };

  for (const [name, value] of [
    ['maxConcurrentRuns', resolved.maxConcurrentRuns],
    ['tickSeconds', resolved.tickSeconds],
    ['maxRunSecondsCeiling', resolved.maxRunSecondsCeiling],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`jobsServerModule: ${name} must be a whole number of at least 1, and was ${value}.`);
    }
  }

  for (const process of resolved.processes) {
    if (process.maxRunSeconds > resolved.maxRunSecondsCeiling) {
      throw new Error(
        `Process '${process.key}' declares maxRunSeconds ${process.maxRunSeconds}, above the runner's ceiling of ` +
          `${resolved.maxRunSecondsCeiling}. Make the run shorter (smaller batches, fewer items per run), or raise ` +
          'maxRunSecondsCeiling in jobsServerModule.',
      );
    }
  }
  return resolved;
}
