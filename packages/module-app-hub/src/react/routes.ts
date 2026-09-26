/**
 * Where the Apps page lives. Constants in their own file so the route, every
 * link to it, and the tests agree without a cycle through `module.tsx`.
 */

/**
 * The drawer section the Apps entry sits in: the workspace's own.
 *
 * ⚠ A DELIBERATE DUPLICATE of `module-permissions`' `WORKSPACE_NAV_GROUP`,
 * which this module may not import (PLAN §9). A group is a shared NAME, so the
 * two only have to spell it the same; `web-module.test.ts` pins the spelling.
 */
export const WORKSPACE_NAV_GROUP = 'Workspace';

/**
 * ⚠ Under `/organizations/:organizationId/workspaces/:workspaceId`, which is
 * what makes the page WORKSPACE level (§12.13): the catch-all asks
 * `app_hub:read` of this workspace before anything renders.
 */
export const APP_HUB_PATH = '/organizations/:organizationId/workspaces/:workspaceId/apps';

export function appHubHref(organizationId: string, workspaceId: string): string {
  return `/organizations/${encodeURIComponent(organizationId)}/workspaces/${encodeURIComponent(workspaceId)}/apps`;
}
