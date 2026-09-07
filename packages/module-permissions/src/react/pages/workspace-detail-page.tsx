'use client';

import { ConfirmDialog } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { FEATURE } from '../../feature-keys.js';
import { FeatureGate } from '../feature-gate.js';
import {
  createPermissionsClient,
  type FoundUser,
  type OrganizationDetailView,
  type PermissionsClient,
  type RoleView,
  type WorkspaceDetailView,
  type WorkspaceMemberView,
} from '../permissions-client.js';
import { AdminPage, AdminPlaceholder } from './admin-page.js';
import { Person, personLabel } from './person.js';

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
                <FeatureGate allOf={[FEATURE.workspacesShare]}>
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
            <FeatureGate allOf={[FEATURE.workspacesManage]}>
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
          detail={detail}
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

/**
 * The workspace's own data — key and name.
 *
 * Both are editable, which a role's key and a plan's key are not. The
 * difference is what references them: a plan key is the primary key every
 * subscription points at, while a workspace is addressed by `id` everywhere and
 * its key exists for humans reading a URL.
 */
function WorkspaceSettings({
  workspace,
  organizationId,
  busy,
  api,
  onRun,
}: {
  workspace: WorkspaceDetailView;
  organizationId: string;
  busy: boolean;
  api: PermissionsClient;
  onRun: (label: string, action: () => Promise<{ changed: boolean; replaced?: boolean }>) => Promise<void>;
}) {
  const keyId = useId();
  const nameId = useId();
  const [key, setKey] = useState(workspace.key);
  const [name, setName] = useState(workspace.name);

  /*
   * Re-seeded when the workspace changes underneath — after a save, or when the
   * page loads a different one. Without this the fields keep whatever was typed
   * against the previous row.
   */
  useEffect(() => {
    setKey(workspace.key);
    setName(workspace.name);
  }, [workspace.key, workspace.name]);

  const dirty = key.trim() !== workspace.key || name.trim() !== workspace.name;

  return (
    <FeatureGate allOf={[FEATURE.workspacesManage]}>
      <section>
        <h2 className="text-lg font-medium">Workspace</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={keyId} className="mb-1 block text-sm font-medium">
              Key
            </label>
            <input
              id={keyId}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              disabled={workspace.archived}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Unique within this organization. Safe to change — nothing references a workspace by key.
            </p>
          </div>
          <div>
            <label htmlFor={nameId} className="mb-1 block text-sm font-medium">
              Name
            </label>
            <input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={workspace.archived}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
            />
          </div>
        </div>
        <button
          type="button"
          disabled={busy || workspace.archived || !dirty || !key.trim() || !name.trim()}
          onClick={() =>
            void onRun('Workspace saved.', () =>
              api.updateWorkspace(organizationId, workspace.id, key.trim(), name.trim()),
            )
          }
          className="mt-4 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          Save changes
        </button>
      </section>
    </FeatureGate>
  );
}

/**
 * Who is in one workspace, and what they hold THERE.
 *
 * ONE role each, the same rule the organization member row follows and enforced
 * the same way — by `@@unique([workspaceMemberId])`. So this is a select, not
 * chips: a control offering a second role would be offering something the
 * database refuses.
 *
 * "No role" is a real option. Membership is what lets somebody reach the
 * workspace; a role is what they may do once there, and somebody with none
 * still acts through whatever their organization role grants.
 */
function WorkspaceMembers({
  workspace,
  organizationId,
  people,
  roles,
  busy,
  api,
  onRun,
}: {
  workspace: WorkspaceDetailView;
  organizationId: string;
  people: Map<string, FoundUser>;
  roles: readonly RoleView[];
  busy: boolean;
  api: PermissionsClient;
  onRun: (label: string, action: () => Promise<{ changed: boolean; replaced?: boolean }>) => Promise<void>;
}) {
  if (workspace.members.length === 0) {
    return (
      <p className="border-t border-border px-4 py-4 text-sm text-muted-foreground">
        Nobody is in this workspace. Members of the organization can be added — and until they are, they cannot reach
        it.
      </p>
    );
  }

  return (
    <div className="border-t border-border px-4 py-2">
      {workspace.members.map((member) => (
        <div
          key={member.workspaceMemberId}
          className="flex flex-wrap items-center gap-3 border-b border-border/50 py-2 last:border-b-0"
        >
          <span className="min-w-48 flex-1">
            <Person user={people.get(member.userId)} userId={member.userId} />
          </span>

          <span className="flex-1">
            <WorkspaceMemberRole
              member={member}
              workspaceId={workspace.id}
              organizationId={organizationId}
              roles={roles}
              busy={busy}
              api={api}
              onRun={onRun}
            />
          </span>

          <FeatureGate allOf={[FEATURE.workspacesShare]}>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void onRun('Removed from the workspace.', () =>
                  api.unshareWorkspace(organizationId, workspace.id, member.userId),
                )
              }
              className="text-xs text-destructive hover:underline disabled:opacity-60"
            >
              Remove
            </button>
          </FeatureGate>
        </div>
      ))}
    </div>
  );
}

/**
 * A workspace member's role — ONE, chosen from a list.
 *
 * The twin of `MemberRoles` one level up, and deliberately the same control for
 * the same rule: a member holds at most one role at each level, so both are a
 * select rather than one being chips.
 */
function WorkspaceMemberRole({
  member,
  workspaceId,
  organizationId,
  roles,
  busy,
  api,
  onRun,
}: {
  member: WorkspaceMemberView;
  workspaceId: string;
  organizationId: string;
  roles: readonly RoleView[];
  busy: boolean;
  api: PermissionsClient;
  onRun: (label: string, action: () => Promise<{ changed: boolean; replaced?: boolean }>) => Promise<void>;
}) {
  // The first, and there can only be one — read defensively so a row written
  // before the constraint existed renders rather than crashing the list.
  const current = member.roles[0];

  return (
    <FeatureGate
      allOf={[FEATURE.workspacesShare]}
      fallback={
        <span className="text-xs">
          {current ? current.label : <span className="text-muted-foreground">no workspace role</span>}
        </span>
      }
    >
      <select
        value={current?.id ?? ''}
        disabled={busy}
        onChange={(event) => {
          const next = event.target.value;
          if (next === (current?.id ?? '')) return;

          if (!next) {
            if (current) {
              void onRun(`Removed ${current.label}.`, () =>
                api.revokeWorkspaceRole(organizationId, workspaceId, member.userId, current.id),
              );
            }
            return;
          }

          const role = roles.find((candidate) => candidate.id === next);
          if (!role) return;
          // ONE call even when it displaces: assignWorkspaceRole replaces inside
          // its own transaction, so there is no window where they hold nothing.
          void onRun(`${role.label} assigned.`, () =>
            api.assignWorkspaceRole(organizationId, workspaceId, member.userId, role.id),
          );
        }}
        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
      >
        <option value="">No workspace role</option>
        {roles.map((role) => (
          <option key={role.id} value={role.id}>
            {role.label}
          </option>
        ))}
      </select>
    </FeatureGate>
  );
}

/**
 * Adding somebody to a workspace: WHO, and optionally what they do there.
 *
 * ## The candidate list is organization members who are not already in
 *
 * Both halves matter. Only organization members, because a workspace membership
 * hangs off an organization membership — the schema makes anyone else
 * impossible to express rather than merely refusing them. And not-already-in,
 * because offering somebody who is already a member is offering a no-op: the
 * write would return `changed: false` and the reader would wonder what happened.
 *
 * ## The role is OPTIONAL
 *
 * Being in a workspace and holding a role in it are different things: membership
 * is what lets somebody reach it at all, and a role is what they may do once
 * there. Somebody added with no role can see the workspace and act through
 * whatever their ORGANIZATION role grants, which is the common case.
 *
 * ## Two writes, in order, and the order is forced
 *
 * `assignWorkspaceRole` refuses somebody who is not in the workspace — the grant
 * hangs off the membership row, so there is nowhere to put it. Share first,
 * then grant. If the grant fails the share stands, which is the right way round:
 * they are in the workspace with no role, rather than neither.
 */
function AddWorkspaceMemberDialog({
  workspace,
  detail,
  people,
  roles,
  busy,
  api,
  onRun,
  onClose,
}: {
  workspace: WorkspaceDetailView | null;
  detail: OrganizationDetailView;
  people: Map<string, FoundUser>;
  roles: readonly RoleView[];
  busy: boolean;
  api: PermissionsClient;
  onRun: (label: string, action: () => Promise<{ changed: boolean; replaced?: boolean }>) => Promise<void>;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [roleId, setRoleId] = useState('');

  /** Organization members not already in this workspace. See the note above. */
  const candidates = useMemo(() => {
    if (!workspace) return [];
    const already = new Set(workspace.members.map((member) => member.userId));
    const needle = search.trim().toLowerCase();

    return detail.members
      .filter((member) => !already.has(member.userId))
      .map((member) => ({ member, user: people.get(member.userId) }))
      .filter(({ member, user }) => {
        if (!needle) return true;
        // Searches everything shown, plus the id — which is what a row falls
        // back to when there is no account behind it.
        return [user?.displayName, user?.username, user?.email, member.userId]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLowerCase().includes(needle));
      });
  }, [workspace, detail.members, people, search]);

  const close = () => {
    setSearch('');
    setChosen(null);
    setRoleId('');
    onClose();
  };

  const chosenMember = candidates.find(({ member }) => member.userId === chosen);
  const role = roles.find((candidate) => candidate.id === roleId);

  return (
    <ConfirmDialog
      open={workspace !== null}
      title={`Add someone to ${workspace?.name ?? ''}`}
      confirmLabel={chosenMember ? `Add ${personLabel(chosenMember.user, chosenMember.member.userId)}` : 'Add'}
      // Not destructive: this grants access rather than taking it away.
      danger={false}
      pending={busy}
      description={
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Only people already in this organization can be added, and only those not already in the workspace.
          </p>

          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search members…"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />

          <div className="max-h-56 overflow-y-auto rounded-md border border-border">
            {candidates.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                {detail.members.length === 0
                  ? 'This organization has no members yet.'
                  : search.trim()
                    ? 'Nobody matches that.'
                    : 'Everybody in this organization is already in this workspace.'}
              </p>
            ) : (
              candidates.map(({ member, user }) => (
                <button
                  key={member.membershipId}
                  type="button"
                  onClick={() => setChosen(member.userId)}
                  className={`flex w-full items-center gap-2 border-b border-border/50 px-3 py-2 text-left text-sm last:border-b-0 ${
                    chosen === member.userId ? 'bg-[var(--status-info)] text-[var(--status-info-foreground)]' : ''
                  }`}
                >
                  <Person user={user} userId={member.userId} />
                </button>
              ))
            )}
          </div>

          <label className="text-sm">
            <span className="mb-1 block font-medium">Workspace role</span>
            <select
              value={roleId}
              onChange={(event) => setRoleId(event.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">No role</option>
              {roles.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-muted-foreground">
              Optional. Being IN a workspace and holding a role in it are different things — somebody with no workspace
              role still acts through whatever their organization role grants.
            </span>
          </label>
        </div>
      }
      onConfirm={() => {
        if (!workspace || !chosenMember) return;
        const { userId } = chosenMember.member;
        const label = personLabel(chosenMember.user, userId);
        close();

        void onRun(role ? `Added ${label} as ${role.label}.` : `Added ${label}.`, async () => {
          const shared = await api.shareWorkspace(detail.id, workspace.id, userId);
          /*
           * The role AFTER the share, and only if one was chosen.
           * `assignWorkspaceRole` refuses somebody who is not in the workspace —
           * the grant hangs off the membership row, so there is nowhere to put
           * it before they are in.
           */
          if (role) await api.assignWorkspaceRole(detail.id, workspace.id, userId, role.id);
          return shared;
        });
      }}
      onCancel={close}
    />
  );
}
