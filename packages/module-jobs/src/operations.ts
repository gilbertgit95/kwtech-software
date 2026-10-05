/**
 * Every GraphQL document this module sends, as data.
 *
 * A document is the ONE part of a typed client that nothing typechecks: a
 * renamed field or a moved argument is a runtime refusal on a screen. Lifted out
 * here, the host hands every one of them to `graphql`'s own validator against
 * the schema it serves — `apps/web-server/test/module-operations.test.ts`.
 *
 * ⚠ FRAMEWORK-FREE, and exported from the package ROOT rather than `/react`, so
 * a server validating them never resolves React to read a string.
 */

const SCHEDULE = 'kind everyMinutes times weekdays';
const RUN = 'id trigger forcedByName state queuedAt startedAt finishedAt handled skippedLate leftForNext note error';
const PROCESS = `key module label description serves
  schedule { ${SCHEDULE} }
  defaultSchedule { ${SCHEDULE} }
  scheduleIsDefault scheduleOverrideIgnored scheduleSetAt scheduleSetByName
  allowedKinds minEveryMinutes maxRunSeconds maxItemsPerRun tooLateAfterMinutes
  standing queuePosition
  pausedAt pausedByName pauseReason
  activeRun { ${RUN} }
  lastRun { ${RUN} }
  failingError
  nextCheckAt`;

export const JOBS_OPERATIONS = {
  jobProcesses: `query JobProcesses {
    jobProcesses { ${PROCESS} }
  }`,

  /** Runs and control actions as one list, newest first. `cursor` is the previous page's `nextCursor`. */
  jobProcessHistory: `query JobProcessHistory($processKey: String!, $cursor: String, $limit: Int) {
    jobProcessHistory(processKey: $processKey, cursor: $cursor, limit: $limit) {
      entries {
        id kind at
        run { ${RUN} }
        control { action actorName reason scheduleFrom { ${SCHEDULE} } scheduleTo { ${SCHEDULE} } }
      }
      nextCursor
    }
  }`,

  pauseJobProcess: `mutation PauseJobProcess($processKey: String!, $reason: String!) {
    pauseJobProcess(processKey: $processKey, reason: $reason) { ${PROCESS} }
  }`,

  resumeJobProcess: `mutation ResumeJobProcess($processKey: String!) {
    resumeJobProcess(processKey: $processKey) { ${PROCESS} }
  }`,

  runJobProcessNow: `mutation RunJobProcessNow($processKey: String!) {
    runJobProcessNow(processKey: $processKey) { ${PROCESS} }
  }`,

  setJobProcessSchedule: `mutation SetJobProcessSchedule($processKey: String!, $schedule: JobScheduleInput!) {
    setJobProcessSchedule(processKey: $processKey, schedule: $schedule) { ${PROCESS} }
  }`,

  resetJobProcessSchedule: `mutation ResetJobProcessSchedule($processKey: String!) {
    resetJobProcessSchedule(processKey: $processKey) { ${PROCESS} }
  }`,
} as const;
