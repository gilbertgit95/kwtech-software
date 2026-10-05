'use client';

import type { ProcessSchedule } from '@kwtech/module-kit';
import { JOBS_OPERATIONS } from '../operations.js';

/**
 * How the admin page reaches the API — through the app's same-origin route
 * handler, which attaches the session. The path is a parameter for the reason
 * chat's is: that handler belongs to `module-auth`, and this module may not name
 * its URL (PLAN §9). The default is where this app mounts it.
 */
export const DEFAULT_GRAPHQL_PATH = '/api/auth/graphql';

/** A `ProcessSchedule` as it crosses the wire: every field present, `kind` saying which mean anything. */
export interface JobScheduleView {
  /** 'interval' | 'daily'. */
  kind: string;
  everyMinutes: number | null;
  times: string[];
  weekdays: number[];
}

export interface JobRunView {
  id: string;
  /** 'scheduled' | 'forced'. */
  trigger: string;
  forcedByName: string | null;
  /** 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'interrupted'. */
  state: string;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  handled: number;
  skippedLate: number;
  leftForNext: number;
  note: string | null;
  error: string | null;
}

export interface JobProcessView {
  key: string;
  module: string;
  label: string;
  description: string;
  serves: string | null;
  schedule: JobScheduleView;
  defaultSchedule: JobScheduleView;
  scheduleIsDefault: boolean;
  scheduleOverrideIgnored: boolean;
  scheduleSetAt: string | null;
  scheduleSetByName: string | null;
  allowedKinds: string[];
  minEveryMinutes: number;
  maxRunSeconds: number;
  maxItemsPerRun: number;
  tooLateAfterMinutes: number;
  /** 'unsynced' | 'paused' | 'running' | 'queued' | 'failing' | 'idle'. */
  standing: string;
  queuePosition: number | null;
  pausedAt: string | null;
  pausedByName: string | null;
  pauseReason: string | null;
  activeRun: JobRunView | null;
  lastRun: JobRunView | null;
  failingError: string | null;
  nextCheckAt: string | null;
}

export interface JobControlView {
  /** 'paused' | 'resumed' | 'forced' | 'rescheduled' | 'reset_schedule'. */
  action: string;
  actorName: string | null;
  reason: string | null;
  scheduleFrom: JobScheduleView | null;
  scheduleTo: JobScheduleView | null;
}

export interface JobHistoryEntryView {
  id: string;
  /** 'run' | 'control'. */
  kind: string;
  at: string;
  run: JobRunView | null;
  control: JobControlView | null;
}

export interface JobHistoryPageView {
  entries: JobHistoryEntryView[];
  nextCursor: string | null;
}

/** One method per operation. Every control answers with the process, re-read by the server. */
export interface JobsClient {
  processes(): Promise<JobProcessView[]>;
  history(processKey: string, cursor: string | null, limit?: number): Promise<JobHistoryPageView>;
  pause(processKey: string, reason: string): Promise<JobProcessView>;
  resume(processKey: string): Promise<JobProcessView>;
  runNow(processKey: string): Promise<JobProcessView>;
  setSchedule(processKey: string, schedule: ProcessSchedule): Promise<JobProcessView>;
  resetSchedule(processKey: string): Promise<JobProcessView>;
}

export function createJobsClient(options: { graphqlPath?: string } = {}): JobsClient {
  const path = options.graphqlPath ?? DEFAULT_GRAPHQL_PATH;
  const ops = JOBS_OPERATIONS;

  async function graphql<T>(document: string, variables: Record<string, unknown> = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ query: document, variables }),
        cache: 'no-store',
      });
    } catch {
      throw new Error('Cannot reach the server.');
    }
    if (!response.ok) {
      throw new Error(response.status === 401 ? 'Your session has ended. Sign in again.' : 'Cannot reach the server.');
    }
    const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'The request was refused.');
    if (!body.data) throw new Error('The server returned no data.');
    return body.data;
  }

  return {
    async processes() {
      return (await graphql<{ jobProcesses: JobProcessView[] }>(ops.jobProcesses)).jobProcesses;
    },
    async history(processKey, cursor, limit) {
      return (
        await graphql<{ jobProcessHistory: JobHistoryPageView }>(ops.jobProcessHistory, {
          processKey,
          cursor,
          limit: limit ?? null,
        })
      ).jobProcessHistory;
    },
    async pause(processKey, reason) {
      return (await graphql<{ pauseJobProcess: JobProcessView }>(ops.pauseJobProcess, { processKey, reason }))
        .pauseJobProcess;
    },
    async resume(processKey) {
      return (await graphql<{ resumeJobProcess: JobProcessView }>(ops.resumeJobProcess, { processKey }))
        .resumeJobProcess;
    },
    async runNow(processKey) {
      return (await graphql<{ runJobProcessNow: JobProcessView }>(ops.runJobProcessNow, { processKey }))
        .runJobProcessNow;
    },
    async setSchedule(processKey, schedule) {
      return (
        await graphql<{ setJobProcessSchedule: JobProcessView }>(ops.setJobProcessSchedule, { processKey, schedule })
      ).setJobProcessSchedule;
    },
    async resetSchedule(processKey) {
      return (await graphql<{ resetJobProcessSchedule: JobProcessView }>(ops.resetJobProcessSchedule, { processKey }))
        .resetJobProcessSchedule;
    },
  };
}
