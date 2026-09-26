'use client';

import { useMemo, useState } from 'react';
import { FEATURE } from '../../feature-keys.js';
import { FeatureGate } from '../feature-gate.js';
import type { PermissionsClient } from '../permissions-client.js';
import { createPermissionsClient } from '../permissions-client.js';
import { workspaceHref } from '../tenant-nav.js';
import { AdminPlaceholder } from './admin-page.js';
import { OrganizationNotices } from './organization-notices.js';
import { TenantPage } from './tenant-page.js';
import { useMyWorkspace } from './use-my-workspace.js';
import { AddWorkspaceMemberDialog, WorkspaceMembers } from './workspace-sections.js';

/**
 * `/organizations/:organizationId/workspaces/:workspaceId/members` — who is in
 * this workspace, and what role each holds here.
 *
 * ## Why it is its own page
 *
 * The list used to sit on the workspace's Overview, on the argument that a
 * workspace had too few people to earn a third page. It moved here so the
 * workspace area reads the way the organization's does — Overview, Members,
 * Settings — and a reader who learned one finds the other where they expect.
 * The Overview keeps the COUNT and a way in, as the organization's does.
 *
 * ## The same key as the Overview, not `members:read`
 *
 * Gated on `organization:read`, exactly as the list was while it lived on the
 * Overview, so nobody who could see it before the split is refused it after.
 * The controls inside keep their own keys (`workspace:members_add`,
 * `workspace:members_remove`, the role key), and the API authorises every one
 * of them again.
 *
 * ## One query, not two
 *
 * `myWorkspace` returns the workspace AND the organization's member list,
 * because the add-member picker may only offer people already in the
 * organization. Loading them separately would be a second round trip and, worse,
 * two lists that can disagree about who is in what.
 */
export function OrganizationWorkspaceMembersPage({
  organizationId,
  workspaceId,
  client,
}: {
  organizationId: string | undefined;
  workspaceId: string | undefined;
  client?: PermissionsClient;
}) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  const { view, workspace, grantable, people, error, notice, busy, run } = useMyWorkspace(
    api,
    organizationId,
    workspaceId,
  );
  const [adding, setAdding] = useState(false);

  return (
    <TenantPage
      organizationName={view?.organizationName}
      organizationId={view?.organizationId}
      title="Members"
      description={workspace?.name}
      feature={FEATURE.organizationRead}
      backTo={{
        href: workspaceHref(organizationId ?? '', workspaceId ?? ''),
        label: workspace?.name ?? 'Workspace',
      }}
    >
      <OrganizationNotices error={error} notice={notice} />

      {view === undefined ? (
        <div className="h-64 animate-pulse rounded-md bg-muted" />
      ) : !view || !workspace ? (
        <AdminPlaceholder>
          No workspace with that id here, or you are not a member of it. Membership is required to reach a workspace and
          no role widens that — ask somebody already inside to add you.
        </AdminPlaceholder>
      ) : (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-medium">Members ({workspace.members.length})</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Only people already in this organization can be added — a workspace membership hangs off an organization
                one. Membership is required to reach the workspace at all; a role says what they may do once there.
              </p>
            </div>
            {/* An archived workspace resolves for nobody, so adding to it would grant nothing. */}
            {workspace.archived ? null : (
              <FeatureGate allOf={[FEATURE.workspaceMembersAdd]}>
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  disabled={busy}
                  className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                >
                  Add member
                </button>
              </FeatureGate>
            )}
          </div>

          <div className="rounded-lg border border-border">
            <WorkspaceMembers
              workspace={workspace}
              organizationId={view.organizationId}
              people={people}
              roles={grantable}
              busy={busy}
              api={api}
              onRun={run}
            />
          </div>
        </section>
      )}

      {view ? (
        <AddWorkspaceMemberDialog
          workspace={adding ? (workspace ?? null) : null}
          organizationId={view.organizationId}
          organizationMembers={view.organizationMembers}
          people={people}
          roles={grantable}
          busy={busy}
          api={api}
          onRun={run}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </TenantPage>
  );
}
