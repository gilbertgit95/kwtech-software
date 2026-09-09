'use client';

import { ConfirmDialog } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FEATURE } from '../../feature-keys.js';
import { FeatureGate } from '../feature-gate.js';
import {
  createPermissionsClient,
  type FoundUser,
  type OrganizationDetailView,
  type PermissionsClient,
  type RoleView,
  type WorkspaceDetailView,
} from '../permissions-client.js';
import { AdminPage, AdminPlaceholder } from './admin-page.js';
/*
 * The settings form, the member table, the role picker and the add dialog used
 * to be defined here. They moved when the tenant workspace screen started
 * rendering the same rows — see `workspace-sections.tsx`.
 */
import { AddWorkspaceMemberDialog, WorkspaceMembers, WorkspaceSettings } from './workspace-sections.js';

/**
 * /admin/organizations/:organizationId/workspaces/:workspaceId — one workspace.
 *
 * ## Why a page rather than a row that expands
 *
 * The organization screen used to expand each workspace inline. That put three
 * different jobs — renaming, adding people, granting roles — inside a row of a
 * list whose job is comparing workspaces. A list is for finding the one you
 * want; this is for working on it.
 *
 * ## Why it is under /admin
 *
 * The path mirrors the organization screen it descends from. The BARE
 * `/organizations/:orgId/workspaces/:workspaceId` is deliberately not used: it
 * is the scope convention `scope.ts` parses, and a route there resolves at
 * WORKSPACE level — which is the tenant-facing area that PLAN §12.13 still
 * defers. These are platform-staff screens and resolve at app level, and
 * putting them on the tenant path would quietly change what the guard reads.
 *
 * ## One query, not two
 *
 * It loads `permissionOrganizationDetail` and picks its workspace out. That
 * looks wasteful and is not: the add-member picker needs every ORGANIZATION
 * member — only they can be added — so the page needs both lists whatever it
 * does. One query means the two cannot disagree about who is in what.
 */
export function WorkspaceDetailPage({
  organizationId,
  workspaceId,
  client,
  organizationHref = (id: string) => `/admin/organizations/${id}`,
}: {
  organizationId: string | undefined;
  workspaceId: string | undefined;
  client?: PermissionsClient;
  organizationHref?: (organizationId: string) => string;
}) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  const [detail, setDetail] = useState<OrganizationDetailView | null | undefined>(undefined);
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [people, setPeople] = useState<Map<string, FoundUser>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<WorkspaceDetailView | null>(null);
  const [archiving, setArchiving] = useState(false);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [found, roleList] = await Promise.all([api.getOrganization(organizationId), api.listRoles()]);
      setDetail(found);
      setRoles(roleList);
      setError(null);
      if (found) {
        const users = await api.findUsersByIds(found.members.map((member) => member.userId));
        setPeople(new Map(users.map((user) => [user.id, user])));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the workspace.');
    }
  }, [api, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Run, report what it did, re-read. See the same helper on the organization page. */
  const run = useCallback(
    async (label: string, action: () => Promise<{ changed: boolean; replaced?: boolean }>) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await action();
        setNotice(
          result.changed
            ? result.replaced
              ? `${label} Their previous role was removed — a member holds one.`
              : label
            : `${label} — already the case, nothing changed.`,
        );
        await load();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That did not work.');
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const workspace = detail?.workspaces.find((candidate) => candidate.id === workspaceId);
  const workspaceRoles = useMemo(() => roles.filter((role) => role.level === 'workspace' && !role.disabled), [roles]);
  const back = { href: organizationHref(organizationId ?? ''), label: detail?.name ?? 'Organization' };

  return (
    <AdminPage
      title={workspace ? workspace.name : 'Workspace'}
      description={workspace ? `Key: ${workspace.key}` : undefined}
      feature={FEATURE.organizationsRead}
      backTo={back}
    >
      {error ? (
        <p role="alert" className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="mb-4 rounded-md bg-[var(--status-success)] px-3 py-2 text-sm text-[var(--status-success-foreground)]"
        >
          {notice}
        </p>
      ) : null}

      {detail === undefined ? (
        <div className="h-64 animate-pulse rounded-md bg-muted" />
      ) : !detail || !workspace ? (
        <AdminPlaceholder>No workspace with that id in this organization.</AdminPlaceholder>
      ) : (
        <div className="flex flex-col gap-10">
          {workspace.archived ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              This workspace is archived. It stops resolving, so nobody can act inside it and no grant made in it
              applies. Its rows are kept, so past access stays readable.
            </p>
          ) : null}

          <WorkspaceSettings workspace={workspace} organizationId={detail.id} busy={busy} api={api} onRun={run} />

          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-medium">Members ({workspace.members.length})</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Only people already in this organization can be added — a workspace membership hangs off an
                  organization one. Membership is required to reach the workspace at all; a role says what they may do
                  once there.
                </p>
              </div>
              {workspace.archived ? null : (
                <FeatureGate allOf={[FEATURE.workspaceMembersAdd]}>
                  <button
                    type="button"
                    onClick={() => setAdding(workspace)}
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
                organizationId={detail.id}
                people={people}
                roles={workspaceRoles}
                busy={busy}
                api={api}
                onRun={run}
              />
            </div>
          </section>

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

      {/*
        Only mounted with an organization in hand: the picker's candidates ARE
        its members, so there is nothing to render before it loads. The dialog
        itself stays closed until `adding` is set.
      */}
      {detail ? (
        <AddWorkspaceMemberDialog
          workspace={adding}
          organizationId={detail.id}
          organizationMembers={detail.members}
          people={people}
          roles={workspaceRoles}
          busy={busy}
          api={api}
          onRun={run}
          onClose={() => setAdding(null)}
        />
      ) : null}

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
          if (detail && workspace) {
            void run('Workspace archived.', () => api.archiveWorkspace(detail.id, workspace.id));
          }
        }}
        onCancel={() => setArchiving(false)}
      />
    </AdminPage>
  );
}
