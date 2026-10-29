import { cookies } from 'next/headers';
import { cache } from 'react';
import {
  ACTIVE_ORGANIZATION_COOKIE,
  ACTIVE_WORKSPACE_COOKIE,
  resolveActiveOrganization,
  resolveActiveWorkspace,
} from '@/components/layout/active-organization';
import { getNavContext, getSessionSnapshot, type SessionScope, type ViewerWorkspace } from '@/lib/session-query';

/**
 * Where a phone's page is: the session, and which organization and workspace
 * are selected (issue #22).
 *
 * The same resolution `AppShell` does for the drawer — the URL first, then
 * the remembered cookie, each validated against the viewer's own list — with
 * ONE addition the phone needs and the drawer does not: a person in exactly
 * one organization, or one workspace, has it selected without choosing. A
 * seller has nothing to choose, and a picker with one row is a tap for
 * nothing.
 *
 * `cache()`d on the scope, like the queries under it, so the page and the
 * shell asking for it in one render are one resolution.
 */
export const getMobilePlace = cache(async (organizationId: string | null, workspaceId: string | null) => {
  const scope: SessionScope = { organizationId, workspaceId };
  const [snapshot, cookieStore] = await Promise.all([getSessionSnapshot(scope), cookies()]);

  const onlyOrganization = snapshot.organizations.length === 1 ? snapshot.organizations[0] : undefined;
  const activeOrganizationId =
    resolveActiveOrganization(
      organizationId,
      cookieStore.get(ACTIVE_ORGANIZATION_COOKIE)?.value,
      snapshot.organizations,
    ) ??
    onlyOrganization?.organizationId ??
    null;

  const rememberedWorkspace = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value;
  const nav =
    snapshot.viewer && activeOrganizationId
      ? await getNavContext(activeOrganizationId, workspaceId ?? rememberedWorkspace ?? null)
      : null;
  const workspaces: readonly ViewerWorkspace[] = nav?.workspaces ?? [];
  /*
   * The only-one fallback applies only when the URL names no workspace. A URL
   * naming one the viewer cannot enter resolves to null and must STAY null:
   * quietly showing another workspace under that address would be the page
   * contradicting its own URL.
   */
  const onlyWorkspace = !workspaceId && workspaces.length === 1 ? workspaces[0] : undefined;
  const activeWorkspaceId =
    resolveActiveWorkspace(workspaceId, rememberedWorkspace, workspaces) ?? onlyWorkspace?.id ?? null;

  return {
    scope,
    snapshot,
    activeOrganizationId,
    activeWorkspaceId,
    workspaces,
    /*
     * The grants at each level, for the Manage tab's three groups. Empty —
     * holding nothing — when there is no organization, as the queries fail
     * closed. The workspace level is the snapshot's own `effective`, read at
     * the page's scope.
     */
    appGranted: nav?.appGranted ?? [],
    organizationEffective: nav?.organizationEffective ?? [],
    activeWorkspace: workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
  };
});

export type MobilePlaceContext = Awaited<ReturnType<typeof getMobilePlace>>;
