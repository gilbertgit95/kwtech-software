import type { ProcessSchedule } from '@kwtech/module-kit';
import { Inject } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { JobsWriteError } from '../jobs.errors.js';
import type { ResolvedJobsOptions } from '../jobs.options.js';
import { type JobControlView, type JobProcessView, type JobRunView, JobsService } from '../jobs.service.js';
import { JOBS_OPTIONS } from '../jobs.tokens.js';
import { JobsWriteService } from '../jobs-write.service.js';
import {
  JobControlType,
  JobHistoryArgs,
  JobHistoryPageType,
  JobProcessType,
  JobRunType,
  JobScheduleInputType,
  JobScheduleType,
} from './jobs.types.js';

/**
 * The admin page's GraphQL surface: every process, its history, and the
 * controls.
 *
 * ## ⚠ WHERE THE GUARD IS, since there is no decorator here
 *
 * Every operation is guarded by its BINDING in `JOBS_FEATURE_REGISTRY`, which
 * the app composes and `FeatureGuard` enforces — `@RequireFeature` belongs to
 * module-permissions, and a module may not import a module (PLAN §9).
 * `test/surface-coverage.test.ts` fails the build on an operation with no
 * binding.
 *
 * ## ⚠ NO DECLARED SCOPE, on purpose
 *
 * Every key here is APP level: a process is one thing for the whole
 * application (JOBS-PLAN D3, D7). A scope would make the guard ask the question
 * inside one tenant, where no app-level key is the answer.
 *
 * ## Every mutation answers with the process, re-read
 *
 * So the page shows what the database now holds, not what it hoped.
 */
@Resolver()
export class JobsResolver {
  constructor(
    private readonly jobs: JobsService,
    private readonly writes: JobsWriteService,
    @Inject(JOBS_OPTIONS) private readonly options: ResolvedJobsOptions,
  ) {}

  // ── reads (jobs:read) ─────────────────────────────────────────────────────

  @Query(() => [JobProcessType], { name: 'jobProcesses' })
  async processes(@Context() gql: { req?: unknown }): Promise<JobProcessType[]> {
    this.actor(gql.req);
    return (await this.jobs.processes(new Date())).map(renderProcess);
  }

  @Query(() => JobHistoryPageType, { name: 'jobProcessHistory' })
  async history(@Context() gql: { req?: unknown }, @Args() args: JobHistoryArgs): Promise<JobHistoryPageType> {
    this.actor(gql.req);
    const page = await this.jobs.history(args.processKey, args.cursor ?? null, args.limit ?? null);
    return {
      entries: page.entries.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        at: entry.at.toISOString(),
        run: entry.run ? renderRun(entry.run) : null,
        control: entry.control ? renderControl(entry.control) : null,
      })),
      nextCursor: page.nextCursor,
    };
  }

  // ── pause and resume (jobs:pause) ─────────────────────────────────────────

  @Mutation(() => JobProcessType, { name: 'pauseJobProcess' })
  async pause(
    @Context() gql: { req?: unknown },
    @Args('processKey') processKey: string,
    @Args('reason') reason: string,
  ): Promise<JobProcessType> {
    const now = new Date();
    await this.writes.pause(processKey, this.actor(gql.req), reason, now);
    return renderProcess(await this.jobs.process(processKey, now));
  }

  @Mutation(() => JobProcessType, { name: 'resumeJobProcess' })
  async resume(@Context() gql: { req?: unknown }, @Args('processKey') processKey: string): Promise<JobProcessType> {
    const now = new Date();
    await this.writes.resume(processKey, this.actor(gql.req), now);
    return renderProcess(await this.jobs.process(processKey, now));
  }

  // ── run now (jobs:run) ────────────────────────────────────────────────────

  @Mutation(() => JobProcessType, { name: 'runJobProcessNow' })
  async runNow(@Context() gql: { req?: unknown }, @Args('processKey') processKey: string): Promise<JobProcessType> {
    const now = new Date();
    await this.writes.runNow(processKey, this.actor(gql.req), now);
    return renderProcess(await this.jobs.process(processKey, now));
  }

  // ── the schedule (jobs:schedule) ──────────────────────────────────────────

  @Mutation(() => JobProcessType, { name: 'setJobProcessSchedule' })
  async setSchedule(
    @Context() gql: { req?: unknown },
    @Args('processKey') processKey: string,
    @Args('schedule') schedule: JobScheduleInputType,
  ): Promise<JobProcessType> {
    const now = new Date();
    await this.writes.setSchedule(processKey, this.actor(gql.req), scheduleOf(schedule), now);
    return renderProcess(await this.jobs.process(processKey, now));
  }

  @Mutation(() => JobProcessType, { name: 'resetJobProcessSchedule' })
  async resetSchedule(
    @Context() gql: { req?: unknown },
    @Args('processKey') processKey: string,
  ): Promise<JobProcessType> {
    const now = new Date();
    await this.writes.resetSchedule(processKey, this.actor(gql.req), now);
    return renderProcess(await this.jobs.process(processKey, now));
  }

  /** The actor, proven by the app's guard. The module never resolves identity itself. */
  private actor(request: unknown): string {
    const actorId = this.options.resolveActorId?.(request);
    if (!actorId) throw new JobsWriteError('not_signed_in');
    return actorId;
  }
}

/**
 * The input as the loose shape the service judges. ⚠ Only the fields its
 * `kind` uses are carried over, so "interval" sent with stray times is an
 * interval and not a malformed schedule. Nothing is validated here.
 */
function scheduleOf(input: JobScheduleInputType): unknown {
  if (input.kind === 'interval') return { kind: 'interval', everyMinutes: input.everyMinutes ?? null };
  return { kind: input.kind, times: input.times ?? [], weekdays: input.weekdays ?? [] };
}

function renderSchedule(schedule: ProcessSchedule): JobScheduleType {
  if (schedule.kind === 'interval') {
    return { kind: 'interval', everyMinutes: schedule.everyMinutes, times: [], weekdays: [] };
  }
  return { kind: 'daily', everyMinutes: null, times: [...schedule.times], weekdays: [...schedule.weekdays] };
}

function renderRun(run: JobRunView): JobRunType {
  return {
    id: run.id,
    trigger: run.trigger,
    forcedByName: run.forcedByName,
    state: run.state,
    queuedAt: run.queuedAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    handled: run.handled,
    skippedLate: run.skippedLate,
    leftForNext: run.leftForNext,
    note: run.note,
    error: run.error,
  };
}

function renderControl(control: JobControlView): JobControlType {
  return {
    action: control.action,
    actorName: control.actorName,
    reason: control.reason,
    scheduleFrom: control.from ? renderSchedule(control.from) : null,
    scheduleTo: control.to ? renderSchedule(control.to) : null,
  };
}

function renderProcess(view: JobProcessView): JobProcessType {
  const { declaration } = view;
  return {
    key: declaration.key,
    module: declaration.module,
    label: declaration.label,
    description: declaration.description,
    serves: declaration.serves,
    schedule: renderSchedule(view.schedule),
    defaultSchedule: renderSchedule(declaration.defaultSchedule),
    scheduleIsDefault: view.scheduleIsDefault,
    scheduleOverrideIgnored: view.scheduleOverrideIgnored,
    scheduleSetAt: view.scheduleSetAt?.toISOString() ?? null,
    scheduleSetByName: view.scheduleSetByName,
    allowedKinds: [...declaration.scheduleLimits.kinds],
    minEveryMinutes: declaration.scheduleLimits.minEveryMinutes,
    maxRunSeconds: declaration.maxRunSeconds,
    maxItemsPerRun: declaration.maxItemsPerRun,
    tooLateAfterMinutes: declaration.tooLateAfterMinutes,
    standing: view.standing,
    queuePosition: view.queuePosition,
    pausedAt: view.pausedAt?.toISOString() ?? null,
    pausedByName: view.pausedByName,
    pauseReason: view.pauseReason,
    activeRun: view.activeRun ? renderRun(view.activeRun) : null,
    lastRun: view.lastRun ? renderRun(view.lastRun) : null,
    failingError: view.failingError,
    nextCheckAt: view.nextCheckAt?.toISOString() ?? null,
  };
}
