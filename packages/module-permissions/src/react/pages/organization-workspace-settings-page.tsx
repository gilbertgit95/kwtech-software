'use client';

import { ConfirmDialog } from '@kwtech/web-ui/react';
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
import { WorkspaceSettings } from './workspace-sections.js';

/**
 * `/organizations/:organizationId/workspaces/:workspaceId/settings` — the
 * things that CHANGE a workspace.
 *
 * ## Why it is its own page
 *
 * All of this used to sit on the workspace's one screen, under the label
 * "Overview" — a rename form, the member list and an archive control, none of
 * which is an overview. The split mirrors the organization area: a landing page
 * that answers "where am I and who is here", and this, for editing.
 *
 * Members stayed on the Overview rather than coming here with the rest.
 * Members are not settings, and "who is in this workspace" is the first thing
 * somebody opening one wants to see.
 *
 * ## Two keys, and the page takes the weaker one
 *
 * Gated on `organization:read` like every screen in this area, with
 * `workspaces:manage` on the controls INSIDE. So somebody without it who
 * follows a link here is shown what the workspace is called rather than a
 * denial — the same shape the organization's own Settings page has, where
 * renaming is gated and leaving is not.
 *
 * The Overview only OFFERS this page to somebody holding `workspaces:manage`,
 * so arriving without it means following a bookmark, which is a state to render
 * honestly rather than to prevent.
 *
 * ## Archiving is at the bottom, and quiet
 *
 * It is not part of editing a workspace: it stops the workspace resolving, so a
 * control for it must not sit beside Save where a mis-click lands.
 */
export function OrganizationWorkspaceSettingsPage({
  organizationId,
  workspaceId,
  client,
}: {
  organizationId: string | undefined;
  workspaceId: string | undefined;
  client?: PermissionsClient;
}) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  const { view, workspace, error, notice, busy, run } = useMyWorkspace(api, organizationId, workspaceId);
  const [archiving, setArchiving] = useState(false);

  return (
    <TenantPage
      organizationName={view?.organizationName}
      organizationId={view?.organizationId}
      title="Settings"
      description={workspace?.name}
      feature={FEATURE.organizationRead}
      backTo={{
        href: workspaceHref(organizationId ?? '', workspaceId ?? ''),
        label: workspace?.name ?? 'Workspace',
      }}
    >
      <OrganizationNotices error={error} notice={notice} />

      {view === undefined ? (
        <div className="h-48 animate-pulse rounded-md bg-muted" />
      ) : !view || !workspace ? (
        <AdminPlaceholder>
          No workspace with that id here, or you are not a member of it. Membership is required to reach a workspace and
          no role widens that.
        </AdminPlaceholder>
      ) : (
        <div className="flex flex-col gap-10">
          {workspace.archived ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              This workspace is archived. It stops resolving, so nobody can act inside it and no grant made in it
              applies. Its rows are kept, so past access stays readable.
            </p>
          ) : null}

          <WorkspaceSettings
            workspace={workspace}
            organizationId={view.organizationId}
            busy={busy}
            api={api}
            onRun={run}
          />

          {workspace.archived ? null : (
            <FeatureGate allOf={[FEATURE.workspacesArchive]}>
              {/*
                Below everything and visually quiet: archiving is not part of
                editing a workspace, and a control that stops it resolving must
                not sit beside Save.
              */}
              <div className="border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setArchiving(true)}
                  disabled={busy}
                  className="text-sm text-destructive hover:underline disabled:opacity-60"
                >
                  Archive this workspace
                </button>
                <p className="mt-1 text-xs text-muted-foreground">
                  Nobody can act inside it afterwards. Nothing is deleted — there is no delete — and its members and
                  their roles stay exactly where they are.
                </p>
              </div>
            </FeatureGate>
          )}
        </div>
      )}

      <ConfirmDialog
        open={archiving}
        title={`Archive ${workspace?.name ?? ''}?`}
        confirmLabel="Archive"
        danger
        pending={busy}
        description={
          <>
            It stops resolving, so nobody can act inside it and no grant made in it applies. The rows stay, so past
            access remains readable. There is no delete.
          </>
        }
        onConfirm={() => {
          setArchiving(false);
          if (view && workspace) {
            void run('Workspace archived.', () => api.archiveWorkspace(view.organizationId, workspace.id));
          }
        }}
        onCancel={() => setArchiving(false)}
      />
    </TenantPage>
  );
}
