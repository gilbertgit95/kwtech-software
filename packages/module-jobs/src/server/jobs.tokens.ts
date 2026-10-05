/**
 * Injection tokens, in their own file so nothing has to import a Nest module to
 * name one. Strings rather than symbols, matching every module here.
 */

/**
 * The WRITE client, which must expose `$transaction`: queueing and claiming a
 * run are compare-and-sets that only mean something inside one. The runner has
 * no read-only path yet (the admin page, JOBS-PLAN phase 2, brings one), so
 * there is no separate read client to bind.
 */
export const JOBS_PRISMA_WRITE = 'kwtech:jobs-prisma-write';

export const JOBS_OPTIONS = 'kwtech:jobs-options';

/**
 * A `JobsEntitledWorkspaces`. ⚠ Unbound means a process that serves a feature
 * REACHES NO WORKSPACE: its run is recorded as skipped, saying so. Fail closed
 * (JOBS-PLAN D12).
 */
export const JOBS_ENTITLED_WORKSPACES = 'kwtech:jobs-entitled-workspaces';
