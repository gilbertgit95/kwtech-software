'use client';

import { useMemo } from 'react';
import { FEATURE } from '../../feature-keys.js';
import type { PermissionsClient } from '../permissions-client.js';
import { createPermissionsClient } from '../permissions-client.js';
import { organizationHref, workspaceHref } from '../tenant-nav.js';
import { AdminPlaceholder } from './admin-page.js';
import { OrganizationNotices } from './organization-notices.js';
import { WorkspacesSection } from './organization-sections.js';
import { TenantPage } from './tenant-page.js';
import { useMyOrganization } from './use-my-organization.js';

/**
 * `/organizations/:organizationId/workspaces` — the tenant's workspaces.
 *
 * ## The grid is shared; the link out is not
 *
 * `WorkspacesSection` already took a `workspaceHref`, because the admin screen
 * links into `/admin/...` and this one links into the TENANT path — and that is
 * not a cosmetic difference. `/organizations/:orgId/workspaces/:wsId` is the
 * convention `scope.ts` parses, so a request there resolves at WORKSPACE level
 * and the guard checks `canAccessWorkspace` before answering; the `/admin` twin
 * resolves at app level and does not. Two paths, two levels, one grid.
 *
 * ## Creating one puts you in it
 *
 * Workspace membership is required to enter a workspace and no role widens it
 * (§12.33). `createWorkspace` therefore adds its creator as a member in the
 * same transaction — without that, a tenant administrator could create a
 * workspace and be refused entry to their own, with no way in that did not go
 * through platform staff. Platform staff creating one on a customer's behalf
 * join nothing, because they hold no membership to hang it off and enter by
 * `platform:support_access` instead.
 */
export function OrganizationWorkspacesPage({
  organizationId,
  client,
}: {
  organizationId: string | undefined;
  client?: PermissionsClient;
}) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  const { detail, error, notice, busy, run } = useMyOrganization(api, organizationId);

  return (
    <TenantPage
      organizationName={detail?.name}
      organizationId={detail?.id}
      title="Workspaces"
      feature={FEATURE.workspacesRead}
      layout="fill"
      backTo={{ href: organizationHref(organizationId ?? ''), label: detail?.name ?? 'Organization' }}
    >
      <OrganizationNotices error={error} notice={notice} />

      {detail === undefined ? (
        <div className="h-64 animate-pulse rounded-md bg-muted" />
      ) : !detail ? (
        <AdminPlaceholder>No organization with that id, or you are not a member of it.</AdminPlaceholder>
      ) : (
        <WorkspacesSection detail={detail} busy={busy} api={api} onRun={run} workspaceHref={workspaceHref} />
      )}
    </TenantPage>
  );
}
