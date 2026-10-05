/**
 * Injection tokens, in their own file so nothing has to import a Nest module to
 * name one. Strings rather than symbols, matching every module here.
 */

/**
 * The READ client, for the admin page. ⚠ Unbound, the page's queries fail at
 * boot, naming this token: the runner itself needs only the write client.
 */
export const JOBS_PRISMA = 'kwtech:jobs-prisma';

/**
 * The WRITE client, which must expose `$transaction`: queueing and claiming a
 * run are compare-and-sets that only mean something inside one, and a control
 * action is the change and its audit row together.
 */
export const JOBS_PRISMA_WRITE = 'kwtech:jobs-prisma-write';

export const JOBS_OPTIONS = 'kwtech:jobs-options';

/**
 * A `JobsEntitledWorkspaces`. ⚠ Unbound means a process that serves a feature
 * REACHES NO WORKSPACE: its run is recorded as skipped, saying so. Fail closed
 * (JOBS-PLAN D12).
 */
export const JOBS_ENTITLED_WORKSPACES = 'kwtech:jobs-entitled-workspaces';

/**
 * A `JobsActorDirectory`: the names of the people who paused, forced or
 * rescheduled a process. ⚠ Unbound, or failing, means NO NAMES: the page says
 * "an administrator". Who did it is still on the row, by id.
 */
export const JOBS_ACTOR_DIRECTORY = 'kwtech:jobs-actor-directory';
