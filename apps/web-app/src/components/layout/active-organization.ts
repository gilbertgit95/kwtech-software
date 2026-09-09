import { ACTIVE_ORGANIZATION_COOKIE, ACTIVE_WORKSPACE_COOKIE, writePreferenceCookie } from '@/lib/preferences';

/**
 * The organization the switcher has selected — remembered across navigation.
 *
 * ## Why it is remembered at all
 *
 * The drawer's tenant section used to exist only while the URL was
 * `/organizations/:id/*`, so it vanished the moment somebody opened the
 * dashboard or an admin screen and came back changed. A switcher that selects
 * something implies the selection PERSISTS; one whose effect disappears when
 * you navigate is a filter, not a switcher.
 *
 * ## Where the active organization comes from, in order
 *
 *   1. THE URL. `/organizations/:orgId/*` is unambiguous — you are looking at
 *      that tenant's page, so the drawer beside it must be that tenant's. This
 *      wins outright, including for a platform engineer inside a customer they
 *      do not belong to.
 *   2. THE COOKIE, and only if it names an organization the viewer is actually
 *      in. Anywhere else in the app.
 *   3. Nothing. The tenant section is absent, which is correct for somebody who
 *      belongs nowhere and has selected nothing.
 *
 * ⚠ **A COOKIE IS NOT AUTHORISATION.** The browser can put any string in it.
 * `resolveActiveOrganization` refuses one that is not in the viewer's own
 * organizations — which is the list the API returned for THIS session — so a
 * forged value selects nothing. And even a legitimate one only decides what the
 * drawer offers: every page it links to is authorised again, server-side, at
 * its own scope.
 */
export { ACTIVE_ORGANIZATION_COOKIE, ACTIVE_WORKSPACE_COOKIE } from '@/lib/preferences';

/** What the shell needs to know about each organization to validate a selection. */
export interface SelectableOrganization {
  organizationId: string;
}

/**
 * Which organization the drawer should be showing, or null.
 *
 * @param urlOrganizationId from `parseScope` — the page's own tenant, if it has one.
 * @param cookieValue the remembered selection, unvalidated.
 * @param organizations the viewer's OWN organizations, from this session's API answer.
 *
 * The URL is not validated against `organizations` and the cookie is, and that
 * asymmetry is deliberate. A URL is a place the reader has navigated to and the
 * page there is authorised on its own; platform staff legitimately open tenants
 * they are not members of, and blanking their drawer would be wrong. A cookie is
 * a remembered preference with no page behind it, so the only thing that makes
 * it meaningful is being one of yours.
 */
export function resolveActiveOrganization(
  urlOrganizationId: string | null | undefined,
  cookieValue: string | undefined,
  organizations: readonly SelectableOrganization[],
): string | null {
  if (urlOrganizationId) return urlOrganizationId;
  if (!cookieValue) return null;
  return organizations.some((organization) => organization.organizationId === cookieValue) ? cookieValue : null;
}

/**
 * Remembers a selection. Called from the browser when the URL names one of the
 * viewer's own organizations — see `<RememberOrganization>`.
 */
export function writeActiveOrganizationCookie(organizationId: string): void {
  writePreferenceCookie(ACTIVE_ORGANIZATION_COOKIE, organizationId);
}

/** A workspace the viewer may enter, as the selector lists them. */
export interface SelectableWorkspace {
  id: string;
}

/**
 * Which workspace the selector should be showing, or null.
 *
 * The same shape as `resolveActiveOrganization`, one level down, and with the
 * same asymmetry: the URL wins outright, and the cookie is only honoured when
 * it names something the viewer can actually reach.
 *
 * ## Changing organization drops the workspace, without clearing anything
 *
 * `workspaces` is the SELECTED organization's — the workspaces of that tenant
 * the viewer may enter. A workspace remembered from a different organization is
 * simply not in it, so it resolves to null. That is the requirement "unselect
 * the current workspace when another organization is chosen" met by
 * ARITHMETIC rather than by a cleanup step, which means it also covers the
 * cases nobody would have written a step for: a workspace the viewer was
 * removed from, and one that has since been archived.
 *
 * Null whenever no organization is selected, because the list is then empty —
 * which is exactly the state that leaves the selector disabled.
 */
export function resolveActiveWorkspace(
  urlWorkspaceId: string | null | undefined,
  cookieValue: string | undefined,
  workspaces: readonly SelectableWorkspace[],
): string | null {
  const candidate = urlWorkspaceId ?? cookieValue;
  if (!candidate) return null;
  /*
   * The URL is validated here where the ORGANIZATION's was not, and the
   * difference is the model: a URL naming a workspace is a claim that the
   * reader may enter it, and §12.33 says membership is the only thing that
   * makes that true — no role widens it. `workspaces` is the viewer's own
   * `accessibleWorkspaceIds`, so this check IS that rule. A page they cannot
   * enter refuses them anyway; the selector must not meanwhile show it as the
   * current one.
   */
  return workspaces.some((workspace) => workspace.id === candidate) ? candidate : null;
}

/** Remembers a workspace selection. See `writeActiveOrganizationCookie`. */
export function writeActiveWorkspaceCookie(workspaceId: string): void {
  writePreferenceCookie(ACTIVE_WORKSPACE_COOKIE, workspaceId);
}
