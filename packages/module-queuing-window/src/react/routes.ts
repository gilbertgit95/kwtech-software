/**
 * Where the queue's pages live. Constants in their own file so the route, every
 * link to it, and the pages that link to each other agree without a cycle
 * through `module.tsx` — the reason chat's `routes.ts` exists.
 */

/**
 * The drawer group every workspace page sits in.
 *
 * ⚠ A DELIBERATE DUPLICATE of `module-permissions`' `WORKSPACE_NAV_GROUP`, which
 * this module may not import (PLAN §9). A group is a shared NAME, so the two
 * only have to spell it the same; `web-module.test.ts` pins the spelling.
 */
export const WORKSPACE_NAV_GROUP = 'Workspace';

/**
 * ⚠ Under `/organizations/:organizationId/workspaces/:workspaceId`, which is
 * what makes the page WORKSPACE level (§12.13): the catch-all resolves the
 * route's key against that workspace, so `queue:read` is asked in the right
 * place before anything renders.
 */
export const QUEUE_CONSOLE_PATH = '/organizations/:organizationId/workspaces/:workspaceId/queue';
export const QUEUE_SETTINGS_PATH = `${QUEUE_CONSOLE_PATH}/settings`;

export function queueConsoleHref(organizationId: string, workspaceId: string): string {
  return `/organizations/${encodeURIComponent(organizationId)}/workspaces/${encodeURIComponent(workspaceId)}/queue`;
}

export function queueSettingsHref(organizationId: string, workspaceId: string): string {
  return `${queueConsoleHref(organizationId, workspaceId)}/settings`;
}
