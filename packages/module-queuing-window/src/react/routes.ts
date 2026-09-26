/**
 * Where the queue's pages live. Constants in their own file so the route, every
 * link to it, and the pages that link to each other agree without a cycle
 * through `module.tsx` — the reason chat's `routes.ts` exists.
 */

/**
 * ⚠ Under `/organizations/:organizationId/workspaces/:workspaceId`, which is
 * what makes the page WORKSPACE level (§12.13): the catch-all resolves the
 * route's key against that workspace, so `queue:read` is asked in the right
 * place before anything renders.
 */
export const QUEUE_CONSOLE_PATH = '/organizations/:organizationId/workspaces/:workspaceId/queue';
export const QUEUE_SETTINGS_PATH = `${QUEUE_CONSOLE_PATH}/settings`;

/**
 * The public board. By KEY, not id, because it is typed on a TV remote. ⚠ If an
 * organization or workspace key ever becomes renamable, every TV URL breaks.
 */
export const QUEUE_DISPLAY_PATH = '/queue-display/:organizationKey/:workspaceKey';

export function queueConsoleHref(organizationId: string, workspaceId: string): string {
  return `/organizations/${encodeURIComponent(organizationId)}/workspaces/${encodeURIComponent(workspaceId)}/queue`;
}

export function queueSettingsHref(organizationId: string, workspaceId: string): string {
  return `${queueConsoleHref(organizationId, workspaceId)}/settings`;
}
