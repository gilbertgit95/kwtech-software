import { ArgsType, Field, InputType, Int, ObjectType } from '@nestjs/graphql';

/**
 * The public shapes. Code-first, so these classes ARE the schema.
 *
 * ⚠ Dates cross as ISO STRINGS and enums as documented `String` fields,
 * matching every other type in this schema.
 */

/** A `ProcessSchedule`. `kind` says which of the other fields mean anything. */
@ObjectType('JobSchedule')
export class JobScheduleType {
  /** interval | daily */
  @Field()
  kind!: string;

  /** For `interval`. */
  @Field(() => Int, { nullable: true })
  everyMinutes!: number | null;

  /** For `daily`: `HH:MM`, ⚠ in EACH WORKSPACE'S OWN time. Empty for `interval`. */
  @Field(() => [String])
  times!: string[];

  /** For `daily`: 0 (Sunday) to 6. Empty for `interval`. */
  @Field(() => [Int])
  weekdays!: number[];
}

/** The schedule an admin asks for. Checked against the process's declared limits, in the service. */
@InputType('JobScheduleInput')
export class JobScheduleInputType {
  /** interval | daily */
  @Field()
  kind!: string;

  @Field(() => Int, { nullable: true })
  everyMinutes?: number | null;

  @Field(() => [String], { nullable: true })
  times?: string[] | null;

  @Field(() => [Int], { nullable: true })
  weekdays?: number[] | null;
}

/** One run. ⚠ Counts and errors, never names of the people it reached (JOBS-PLAN D5). */
@ObjectType('JobRun')
export class JobRunType {
  @Field()
  id!: string;

  /** scheduled | forced */
  @Field()
  trigger!: string;

  /** Who pressed Run now. Null for a scheduled run, and when nobody can say who the person is. */
  @Field(() => String, { nullable: true })
  forcedByName!: string | null;

  /** queued | running | succeeded | failed | skipped | interrupted */
  @Field()
  state!: string;

  @Field()
  queuedAt!: string;

  @Field(() => String, { nullable: true })
  startedAt!: string | null;

  @Field(() => String, { nullable: true })
  finishedAt!: string | null;

  @Field(() => Int)
  handled!: number;

  /** Skipped as past the process's "too late" window. */
  @Field(() => Int)
  skippedLate!: number;

  /** Seen and left for the next run, because the item limit was reached. */
  @Field(() => Int)
  leftForNext!: number;

  /** Why it was skipped. */
  @Field(() => String, { nullable: true })
  note!: string | null;

  /** Why it failed. */
  @Field(() => String, { nullable: true })
  error!: string | null;
}

@ObjectType('JobProcess')
export class JobProcessType {
  @Field()
  key!: string;

  /** The module that declares it, for grouping. */
  @Field()
  module!: string;

  @Field()
  label!: string;

  @Field()
  description!: string;

  /** The feature it serves, so it reaches only organizations whose plan includes it. Null: it serves no workspace. */
  @Field(() => String, { nullable: true })
  serves!: string | null;

  /** The schedule in force. */
  @Field(() => JobScheduleType)
  schedule!: JobScheduleType;

  @Field(() => JobScheduleType)
  defaultSchedule!: JobScheduleType;

  @Field()
  scheduleIsDefault!: boolean;

  /** An admin's schedule no longer fits the declared limits, so the default runs instead. */
  @Field()
  scheduleOverrideIgnored!: boolean;

  @Field(() => String, { nullable: true })
  scheduleSetAt!: string | null;

  @Field(() => String, { nullable: true })
  scheduleSetByName!: string | null;

  /** The schedule kinds an admin may choose: interval, daily. */
  @Field(() => [String])
  allowedKinds!: string[];

  /** The shortest interval allowed, and how often a daily schedule is checked. */
  @Field(() => Int)
  minEveryMinutes!: number;

  @Field(() => Int)
  maxRunSeconds!: number;

  @Field(() => Int)
  maxItemsPerRun!: number;

  @Field(() => Int)
  tooLateAfterMinutes!: number;

  /** unsynced | paused | running | queued | failing | idle */
  @Field()
  standing!: string;

  /** 1 for the next to start. Null unless it is queued. */
  @Field(() => Int, { nullable: true })
  queuePosition!: number | null;

  @Field(() => String, { nullable: true })
  pausedAt!: string | null;

  @Field(() => String, { nullable: true })
  pausedByName!: string | null;

  @Field(() => String, { nullable: true })
  pauseReason!: string | null;

  /** The run queued or under way. */
  @Field(() => JobRunType, { nullable: true })
  activeRun!: JobRunType | null;

  /** The last run that ended, however it ended. */
  @Field(() => JobRunType, { nullable: true })
  lastRun!: JobRunType | null;

  /** Why its last finished run failed. Null unless it is failing. */
  @Field(() => String, { nullable: true })
  failingError!: string | null;

  /** When the runner next queues it. Null while it cannot be queued. */
  @Field(() => String, { nullable: true })
  nextCheckAt!: string | null;
}

/** One thing an admin did to a process. */
@ObjectType('JobControl')
export class JobControlType {
  /** paused | resumed | forced | rescheduled | reset_schedule */
  @Field()
  action!: string;

  /** Null when nobody can say who the person is. */
  @Field(() => String, { nullable: true })
  actorName!: string | null;

  @Field(() => String, { nullable: true })
  reason!: string | null;

  @Field(() => JobScheduleType, { nullable: true })
  scheduleFrom!: JobScheduleType | null;

  @Field(() => JobScheduleType, { nullable: true })
  scheduleTo!: JobScheduleType | null;
}

/** One line of a process's history: a run, or a control action. */
@ObjectType('JobHistoryEntry')
export class JobHistoryEntryType {
  @Field()
  id!: string;

  /** run | control — which of the two fields below is set. */
  @Field()
  kind!: string;

  /** When it was queued, or done. */
  @Field()
  at!: string;

  @Field(() => JobRunType, { nullable: true })
  run!: JobRunType | null;

  @Field(() => JobControlType, { nullable: true })
  control!: JobControlType | null;
}

@ObjectType('JobHistoryPage')
export class JobHistoryPageType {
  @Field(() => [JobHistoryEntryType])
  entries!: JobHistoryEntryType[];

  /** Pass back as `cursor` for the next page. Null: that was the last. */
  @Field(() => String, { nullable: true })
  nextCursor!: string | null;
}

/** Grouped, because inline optional arguments fail at boot. */
@ArgsType()
export class JobHistoryArgs {
  @Field()
  processKey!: string;

  @Field(() => String, { nullable: true })
  cursor?: string | null;

  @Field(() => Int, { nullable: true })
  limit?: number | null;
}
