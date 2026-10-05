import type { JobControlAction, JobRunState, JobRunTrigger } from '../types.js';

/**
 * The slice of a Prisma client this module uses — declared STRUCTURALLY, never
 * imported from a generated one.
 *
 * The module ships `prisma/jobs.prisma`; the host composes it into its own
 * schema and hands back the client. So this package has no `@prisma/client`
 * dependency. The app's `satisfies-modules.ts` proves its client fits, at
 * compile time.
 *
 * Every argument shape here is one the services actually send, and nothing
 * more: a wider interface is a wider promise the fake in the tests would have
 * to keep.
 */

type SortOrder = 'asc' | 'desc';

export interface JobProcessRow {
  key: string;
  module: string;
  label: string;
  description: string;
  serves: string | null;
  /** Json. Mirrored for the admin screen; the runner reads the code's. */
  defaultSchedule: unknown;
  /** Json. As above. */
  scheduleLimits: unknown;
  maxRunSeconds: number;
  maxItemsPerRun: number;
  tooLateAfterMinutes: number;
  deprecatedAt: Date | null;
  /** Json. The admin's schedule — ⚠ in force only while `scheduleSetAt` is set: read it through `adminSchedule`. */
  schedule: unknown;
  scheduleSetById: string | null;
  scheduleSetAt: Date | null;
  pausedAt: Date | null;
  pausedById: string | null;
  pauseReason: string | null;
  activeRunId: string | null;
  lastQueuedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobRunRow {
  id: string;
  processKey: string;
  trigger: JobRunTrigger;
  forcedById: string | null;
  state: JobRunState;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  leaseExpiresAt: Date | null;
  handled: number;
  skippedLate: number;
  leftForNext: number;
  note: string | null;
  error: string | null;
}

export interface JobControlRow {
  id: string;
  processKey: string;
  action: JobControlAction;
  actorId: string;
  reason: string | null;
  /** Json. A `ProcessSchedule`, for `rescheduled` and `reset_schedule`. */
  scheduleFrom: unknown;
  /** Json. As above. */
  scheduleTo: unknown;
  createdAt: Date;
}

/** What the sync writes: the declaration, and nothing an admin set. */
export interface JobProcessMirror {
  module: string;
  label: string;
  description: string;
  serves: string | null;
  // A schedule and its limits are plain objects — what the Json columns hold.
  defaultSchedule: object;
  scheduleLimits: object;
  maxRunSeconds: number;
  maxItemsPerRun: number;
  tooLateAfterMinutes: number;
  deprecatedAt: null;
}

export interface JobsTransaction {
  jobProcess: {
    findUnique(args: { where: { key: string } }): Promise<JobProcessRow | null>;
    /** Every live process, for "what is due". */
    findMany(args: { where: { deprecatedAt: null }; orderBy: Array<{ key: SortOrder }> }): Promise<JobProcessRow[]>;
    upsert(args: {
      where: { key: string };
      create: JobProcessMirror & { key: string };
      update: JobProcessMirror;
    }): Promise<JobProcessRow>;
    /**
     * ⚠ THE COMPARE-AND-SETS. Queueing takes the process only while
     * `activeRunId` is null; finishing frees it only while it still names that
     * run. Zero rows means somebody else got there, and the caller does nothing.
     */
    updateMany(args: {
      where:
        | { key: string; activeRunId: null; deprecatedAt: null; pausedAt: null }
        | { activeRunId: string }
        | { key: { notIn: string[] }; deprecatedAt: null }
        /** Pausing: only a live process that is not paused already. */
        | { key: string; deprecatedAt: null; pausedAt: null }
        /** Resuming: only one that is paused. */
        | { key: string; pausedAt: { not: null } }
        /** Setting or resetting a schedule. */
        | { key: string; deprecatedAt: null };
      data: {
        activeRunId?: string | null;
        lastQueuedAt?: Date;
        deprecatedAt?: Date;
        pausedAt?: Date | null;
        pausedById?: string | null;
        pauseReason?: string | null;
        /** ⚠ Never null: a reset clears `scheduleSetAt` instead (`adminSchedule`). */
        schedule?: object;
        scheduleSetById?: string | null;
        scheduleSetAt?: Date | null;
      };
    }): Promise<{ count: number }>;
  };

  jobRun: {
    create(args: {
      data: {
        id: string;
        processKey: string;
        trigger: JobRunTrigger;
        forcedById: string | null;
        state: 'queued';
        queuedAt: Date;
      };
    }): Promise<JobRunRow>;
    /**
     * The head of the queue, or the running rows whose lease has lapsed. For
     * the admin page: the runs some processes are held by, a process's last
     * run in given states, and a page of its history from an instant back.
     */
    findMany(args: {
      where:
        | { state: 'queued' }
        | { state: 'running'; leaseExpiresAt: { lt: Date } }
        | { id: { in: string[] } }
        | { processKey: string; state: { in: JobRunState[] } }
        | { processKey: string; queuedAt?: { lte: Date } };
      orderBy: Array<{ queuedAt: SortOrder } | { processKey: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<JobRunRow[]>;
    /** How many are under way — counted behind the queue lock. */
    count(args: { where: { state: 'running' } }): Promise<number>;
    /**
     * ⚠ Always conditional on the state the decision was made against, so a
     * run reaped as `interrupted` is never overwritten by its late finish.
     */
    updateMany(args: {
      where: { id: string; state: 'queued' | 'running' };
      data: {
        state: JobRunState;
        startedAt?: Date;
        finishedAt?: Date;
        leaseExpiresAt?: Date | null;
        handled?: number;
        skippedLate?: number;
        leftForNext?: number;
        note?: string | null;
        error?: string | null;
      };
    }): Promise<{ count: number }>;
  };

  jobControl: {
    /** ⚠ `createdAt` is passed, never defaulted: it is the service's one clock, shared with the row it explains. */
    create(args: {
      data: {
        processKey: string;
        action: JobControlAction;
        actorId: string;
        reason: string | null;
        scheduleFrom?: object;
        scheduleTo?: object;
        createdAt: Date;
      };
    }): Promise<JobControlRow>;
    /** A page of a process's control actions, from an instant back. */
    findMany(args: {
      where: { processKey: string; createdAt?: { lte: Date } };
      orderBy: Array<{ createdAt: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<JobControlRow[]>;
  };

  jobQueueLock: {
    upsert(args: {
      where: { id: string };
      create: { id: string };
      update: { touchedAt: Date };
    }): Promise<{ id: string }>;
    /** ⚠ The row lock every claim waits on. Zero rows: never synced, claim nothing. */
    updateMany(args: { where: { id: string }; data: { touchedAt: Date } }): Promise<{ count: number }>;
  };
}

/** The read client. The same delegates; a host may bind a replica. */
export type JobsPrismaClient = JobsTransaction;

export interface JobsWriteClient extends JobsTransaction {
  $transaction<T>(fn: (tx: JobsTransaction) => Promise<T>): Promise<T>;
}
