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
