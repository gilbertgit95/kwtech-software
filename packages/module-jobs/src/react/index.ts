/**
 * `@kwtech/module-jobs/react` — the admin page and its descriptor.
 *
 * May import the package root (pure), `@kwtech/module-kit` and
 * `@kwtech/web-ui`. ⚠ NEVER `/server`: that would put Nest in the browser
 * bundle (PLAN §9 rule 2).
 *
 * ⚠ NAMED re-exports, never `export *`. Half of this barrel is `'use client'`,
 * and a Next app replaces such a module with a client-reference proxy that does
 * not answer the enumeration `export *` compiles to — the re-export then yields
 * nothing and fails at render with "Element type is invalid". See
 * packages/module-auth/src/react/index.ts, where that cost a debugging session.
 */

export {
  createJobsClient,
  DEFAULT_GRAPHQL_PATH,
  type JobControlView,
  type JobHistoryEntryView,
  type JobHistoryPageView,
  type JobProcessView,
  type JobRunView,
  type JobScheduleView,
  type JobsClient,
} from './jobs-client.js';
export { ADMINISTRATION_NAV_GROUP, JOBS_ADMIN_HREF, type JobsWebModuleOptions, jobsWebModule } from './module.js';
export { JobsPage, type JobsPageProps } from './pages/jobs-page.js';
export { type JobHistoryState, useJobHistory } from './use-job-history.js';
export { JOBS_REFRESH_MS, type JobsAdminState, useJobsAdmin } from './use-jobs-admin.js';
