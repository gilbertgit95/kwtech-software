import {
  checkProcessSchedule,
  effectiveProcessSchedule,
  type ProcessContribution,
  type ProcessSchedule,
  parseProcessSchedule,
} from '@kwtech/module-kit';
import { Inject, Injectable } from '@nestjs/common';
import { checkPause, checkReschedule, checkResume, preparePauseReason } from '../domain/controls.js';
import { adminSchedule, isSameSchedule, normalizeSchedule, scheduleRefusalMessage } from '../domain/schedule.js';
import { JobsWriteError } from './jobs.errors.js';
import type { ResolvedJobsOptions } from './jobs.options.js';
import type { JobsWriteClient } from './jobs.repository.js';
import { JOBS_OPTIONS, JOBS_PRISMA_WRITE } from './jobs.tokens.js';
import { JobsQueueService } from './jobs-queue.service.js';

/**
 * THE CONTROLS (JOBS-PLAN §7): pause, resume, run now, and the schedule.
 *
 * ⚠ EVERY ACTION WRITES ITS AUDIT ROW (`job_control`) WITH THE CHANGE, in one
 * transaction: a process paused with no record of who and why is the thing
 * the audit trail exists to prevent. The one exception is Run now, said there.
 *
 * ⚠ EVERY CHANGE IS A COMPARE-AND-SET on the state it was decided against, so
 * two admins pressing Pause at once are one pause and one refusal, never two
 * audit rows for one act.
 *
 * ⚠ A PROCESS THIS BUILD DOES NOT DECLARE CANNOT BE CONTROLLED. Its limits are
 * the code's, and a row is not a way round them.
 *
 * Every method takes `now`. This class never reads the clock.
 */
@Injectable()
export class JobsWriteService {
  private readonly declarations: ReadonlyMap<string, ProcessContribution>;

  constructor(
    @Inject(JOBS_PRISMA_WRITE) private readonly prisma: JobsWriteClient,
    @Inject(JOBS_OPTIONS) options: ResolvedJobsOptions,
    private readonly queue: JobsQueueService,
  ) {
    this.declarations = new Map(options.processes.map((process) => [process.key, process]));
  }

  /**
   * Pauses a process for every organization (D3), saying why. Nothing more is
   * queued, and a run already queued is skipped when its turn comes; a run
   * under way finishes.
   */
  async pause(processKey: string, actorId: string, reason: string | null, now: Date): Promise<void> {
    this.declared(processKey);
    const prepared = preparePauseReason(reason);
    if ('refused' in prepared) throw new JobsWriteError(prepared.refused);

    await this.prisma.$transaction(async (tx) => {
      const refusal = checkPause(await tx.jobProcess.findUnique({ where: { key: processKey } }));
      if (refusal) throw new JobsWriteError(refusal);
      const paused = await tx.jobProcess.updateMany({
        where: { key: processKey, deprecatedAt: null, pausedAt: null },
        data: { pausedAt: now, pausedById: actorId, pauseReason: prepared.reason },
      });
      // Somebody else paused it between the read and the write.
      if (paused.count === 0) throw new JobsWriteError('already_paused');
      await tx.jobControl.create({
        data: { processKey, action: 'paused', actorId, reason: prepared.reason, createdAt: now },
      });
    });
  }

  /**
   * Resumes a paused process. ⚠ It is due again at once if its cadence passed
   * while it was paused; what it then finds past its "too late" window it
   * skips and counts (D1), so resuming never sends a backlog.
   */
  async resume(processKey: string, actorId: string, now: Date): Promise<void> {
    this.declared(processKey);
    await this.prisma.$transaction(async (tx) => {
      const refusal = checkResume(await tx.jobProcess.findUnique({ where: { key: processKey } }));
      if (refusal) throw new JobsWriteError(refusal);
      const resumed = await tx.jobProcess.updateMany({
        where: { key: processKey, pausedAt: { not: null } },
        data: { pausedAt: null, pausedById: null, pauseReason: null },
      });
      if (resumed.count === 0) throw new JobsWriteError('not_paused');
      await tx.jobControl.create({ data: { processKey, action: 'resumed', actorId, reason: null, createdAt: now } });
    });
  }

  /**
   * Run now: joins the same queue as a scheduled run. Refused while a run of
   * it is queued or under way (D2), and while it is paused.
   *
   * ⚠ Two transactions, not one: the queue owns queueing, and its claim on the
   * process must not wait on this row. The run itself records who forced it
   * (`forcedById`), so a control row that failed to be written after it would
   * lose a line of the trail and not the fact.
   */
  async runNow(processKey: string, actorId: string, now: Date): Promise<void> {
    this.declared(processKey);
    const result = await this.queue.enqueue(processKey, 'forced', now, actorId);
    if ('refused' in result) throw new JobsWriteError(result.refused);
    await this.prisma.jobControl.create({
      data: { processKey, action: 'forced', actorId, reason: null, createdAt: now },
    });
  }

  /**
   * Sets an admin's schedule, inside what the module declares the process can
   * bear. A schedule outside it is refused with the limit said.
   *
   * Setting the schedule already in force changes nothing and writes no audit
   * row: "rescheduled from X to X" is noise in a trail people read for causes.
   */
  async setSchedule(processKey: string, actorId: string, raw: unknown, now: Date): Promise<void> {
    const declaration = this.declared(processKey);
    const parsed = parseProcessSchedule(raw);
    if (!parsed) {
      throw new JobsWriteError('invalid_schedule', scheduleRefusalMessage('malformed', declaration.scheduleLimits));
    }
    const refusal = checkProcessSchedule(parsed, declaration.scheduleLimits);
    if (refusal) {
      throw new JobsWriteError('invalid_schedule', scheduleRefusalMessage(refusal, declaration.scheduleLimits), {
        refusal,
      });
    }
    const schedule = normalizeSchedule(parsed);

    await this.prisma.$transaction(async (tx) => {
      const process = await tx.jobProcess.findUnique({ where: { key: processKey } });
      const blocked = checkReschedule(process);
      if (blocked || !process) throw new JobsWriteError(blocked ?? 'unknown_process');

      const override = adminSchedule(process);
      const from = effectiveProcessSchedule(declaration, override).schedule;
      if (override != null && isSameSchedule(from, schedule)) return;

      const set = await tx.jobProcess.updateMany({
        where: { key: processKey, deprecatedAt: null },
        data: { schedule: stored(schedule), scheduleSetById: actorId, scheduleSetAt: now },
      });
      if (set.count === 0) throw new JobsWriteError('deprecated');
      await tx.jobControl.create({
        data: {
          processKey,
          action: 'rescheduled',
          actorId,
          reason: null,
          scheduleFrom: stored(from),
          scheduleTo: stored(schedule),
          createdAt: now,
        },
      });
    });
  }

  /**
   * Puts a process back on the module's default schedule.
   *
   * ⚠ Clears `scheduleSetAt` and leaves the `schedule` column as it was — see
   * `adminSchedule` for why SQL NULL is not written there.
   */
  async resetSchedule(processKey: string, actorId: string, now: Date): Promise<void> {
    const declaration = this.declared(processKey);
    await this.prisma.$transaction(async (tx) => {
      const process = await tx.jobProcess.findUnique({ where: { key: processKey } });
      const blocked = checkReschedule(process);
      if (blocked || !process) throw new JobsWriteError(blocked ?? 'unknown_process');

      const override = adminSchedule(process);
      if (override == null) throw new JobsWriteError('already_default');
      const from = effectiveProcessSchedule(declaration, override).schedule;

      const reset = await tx.jobProcess.updateMany({
        where: { key: processKey, deprecatedAt: null },
        data: { scheduleSetById: null, scheduleSetAt: null },
      });
      if (reset.count === 0) throw new JobsWriteError('deprecated');
      await tx.jobControl.create({
        data: {
          processKey,
          action: 'reset_schedule',
          actorId,
          reason: null,
          scheduleFrom: stored(from),
          scheduleTo: stored(declaration.defaultSchedule),
          createdAt: now,
        },
      });
    });
  }

  private declared(processKey: string): ProcessContribution {
    const declaration = this.declarations.get(processKey);
    if (!declaration) throw new JobsWriteError('unknown_process');
    return declaration;
  }
}

/** A schedule as a Json column takes it: a fresh plain object with plain arrays, never a caller's own. */
function stored(schedule: ProcessSchedule): object {
  if (schedule.kind === 'interval') return { kind: 'interval', everyMinutes: schedule.everyMinutes };
  return { kind: 'daily', times: [...schedule.times], weekdays: [...schedule.weekdays] };
}
