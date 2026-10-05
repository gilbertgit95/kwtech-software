import type { WebModuleDescriptor } from '@kwtech/module-kit';
import { JOBS_FEATURE, JOBS_FEATURE_REGISTRY } from '../feature-keys.js';
import { JobsPage } from './pages/jobs-page.js';
import { JOBS_ADMIN_HREF } from './routes.js';

/**
 * The runner's web descriptor — its one admin page and its feature
 * contributions, as data the app composes:
 *
 *   const WEB_MODULES = [..., jobsWebModule({ moduleLabels: { task: 'Tasks' } })];
 *
 * ⚠ `.tsx` for the reason every module's descriptor is: a route adapter must
 * RENDER its page, never call it. The page is `'use client'`, and across that
 * boundary Next replaces it with a client-reference proxy that can only be
 * rendered.
 *
 * ⚠ CORE, NOT A SUB-APP (JOBS-PLAN D9): no entry on a workspace's Apps page,
 * and no workspace-level key. One page in the drawer, at app level.
 */

export { JOBS_ADMIN_HREF } from './routes.js';

/** The drawer group the page sits in. A shared NAME, pinned by `web-module.test.ts`. */
export const ADMINISTRATION_NAV_GROUP = 'Administration';

export interface JobsWebModuleOptions {
  /**
   * What to head each module's processes with: `{ task: 'Tasks', booking:
   * 'Booking' }`. Only the app knows what it calls its modules — this one may
   * import none of them. A module left out is headed by its key, in words.
   *
   * ⚠ A plain object of strings, because it crosses to the client page.
   */
  moduleLabels?: Readonly<Record<string, string>>;
}

export function jobsWebModule(options: JobsWebModuleOptions = {}): WebModuleDescriptor {
  const moduleLabels = options.moduleLabels ?? {};
  function JobsRoute() {
    return <JobsPage moduleLabels={moduleLabels} />;
  }

  return {
    key: 'jobs',
    features: JOBS_FEATURE_REGISTRY,
    routes: [
      {
        path: JOBS_ADMIN_HREF,
        component: JobsRoute,
        // Short, because it is also the drawer's entry: "Background processes" was cut off there.
        title: 'Processes',
        /*
         * `jobs:read`, the key the page's two queries are bound to. Each control
         * inside checks its own (`jobs:pause`, `jobs:run`, `jobs:schedule`), so
         * somebody who may only look is shown the page and none of the buttons.
         */
        feature: JOBS_FEATURE.read,
        /*
         * 60: after Users (50, module-auth) and before Send notifications (80)
         * and Defaults (90). The order is a NUMBER because modules that cannot
         * import each other still have to agree on one drawer.
         */
        nav: { group: ADMINISTRATION_NAV_GROUP, order: 60, icon: 'clock' },
      },
    ],
  };
}
