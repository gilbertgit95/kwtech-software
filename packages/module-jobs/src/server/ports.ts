import type { ProcessWorkspacePage } from '@kwtech/module-kit';

/**
 * The one question the runner needs answered and cannot answer itself.
 *
 * Which workspaces belong to an organization whose PLAN includes this feature?
 * Plans are `module-permissions`' tables, and a module may not import a module
 * (PLAN §9), so the app answers.
 *
 * ⚠ ENTITLEMENT, NOT GRANTS (JOBS-PLAN D12). The question is "did this
 * organization buy the app", never "does some user hold the key": a run is the
 * application acting, and there is no actor whose grants to check.
 *
 * ⚠ A page at a time, in a stable order, never archived workspaces. Each
 * carries its time zone, because every process works by the workspace's own
 * day. Nothing is cached between runs: a plan that changes takes effect on the
 * next one.
 *
 * UNBOUND, OR THROWING, MEANS NO WORKSPACE — the run is recorded as skipped.
 */
export interface JobsEntitledWorkspaces {
  page(featureKey: string, cursor: string | null, limit: number): Promise<ProcessWorkspacePage>;
}

/**
 * Who a user id is, in words, for the admin page: "Paused by Ana Cruz".
 *
 * Accounts are `module-auth`'s tables, and a module may not import a module
 * (PLAN §9), so the app answers. The same question `QueueStaffDirectory`
 * asks, copied structurally rather than shared: nothing else needs this shape.
 *
 * ⚠ A LOOK-UP OF NAMES ONLY, for ids this module already holds. It is never a
 * search, and an id with no answer is simply left out.
 *
 * UNBOUND, OR THROWING, MEANS NO NAMES — the page says "an administrator".
 */
export interface JobsActorDirectory {
  names(userIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}
