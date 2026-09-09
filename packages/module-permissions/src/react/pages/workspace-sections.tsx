'use client';

import { ConfirmDialog } from '@kwtech/web-ui/react';
import { useEffect, useId, useMemo, useState } from 'react';
import { FEATURE } from '../../feature-keys.js';
import { FeatureGate } from '../feature-gate.js';
import type {
  FoundUser,
  MemberView,
  PermissionsClient,
  RoleView,
  WorkspaceDetailView,
  WorkspaceMemberView,
} from '../permissions-client.js';
import { Person, personLabel } from './person.js';

/**
 * The sections ONE workspace screen is made of, shared by both audiences.
 *
 * The same argument as `organization-sections.tsx`: `/admin/organizations/:id/
 * workspaces/:wsId` and `/organizations/:id/workspaces/:wsId` render the same
 * rows, and what differs is the key that opens the page and — here especially —
 * the LEVEL the request resolves at. The tenant path resolves at WORKSPACE
 * level, so the guard checks `canAccessWorkspace` before answering; the admin
 * path resolves at app level and does not.
 *
 * ## The dialog takes a member LIST, not an organization
 *
 * It used to take the whole `OrganizationDetailView` and read two fields off
 * it. The tenant screen loads a workspace-scoped query that carries the
 * organization's members without carrying the organization, so the narrower
 * props are also the honest ones: this needs the pool it may add from, and
 * nothing else about the tenant.
 */

/**
 * The workspace's own data — key and name.
 *
 * Both are editable, which a role's key and a plan's key are not. The
 * difference is what references them: a plan key is the primary key every
 * subscription points at, while a workspace is addressed by `id` everywhere and
 * its key exists for humans reading a URL.
 */
export function WorkspaceSettings({
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
  const descriptionId = useId();
  const [key, setKey] = useState(workspace.key);
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description ?? '');

  /*
   * Re-seeded when the workspace changes underneath — after a save, or when the
   * page loads a different one. Without this the fields keep whatever was typed
   * against the previous row.
   */
  useEffect(() => {
    setKey(workspace.key);
    setName(workspace.name);
    setDescription(workspace.description ?? '');
  }, [workspace.key, workspace.name, workspace.description]);

  const dirty =
    key.trim() !== workspace.key ||
    name.trim() !== workspace.name ||
    description.trim() !== (workspace.description ?? '');

  return (
    <FeatureGate allOf={[FEATURE.workspacesUpdate]}>
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

        <div className="mt-4">
          <label htmlFor={descriptionId} className="mb-1 block text-sm font-medium">
            Description
          </label>
          <textarea
            id={descriptionId}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={workspace.archived}
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {/*
              The same wording as the organization's, and for the same reason:
              the value found here on a first visit is the NAME, copied in so the
              field would not read as blank. It is a placeholder, not something
              anybody wrote.
            */}
            What this workspace is for. New workspaces start with their name here; replace it with something that tells
            people what belongs in it. Left empty, it falls back to the name again.
          </p>
        </div>

        <button
          type="button"
          disabled={busy || workspace.archived || !dirty || !key.trim() || !name.trim()}
          onClick={() =>
            void onRun('Workspace saved.', () =>
              api.updateWorkspace(organizationId, workspace.id, key.trim(), name.trim(), description.trim() || null),
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
export function WorkspaceMembers({
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

          <FeatureGate allOf={[FEATURE.workspaceMembersAdd]}>
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
export function WorkspaceMemberRole({
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
      allOf={[FEATURE.workspaceAssignRole]}
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
export function AddWorkspaceMemberDialog({
  workspace,
  organizationId,
  organizationMembers,
  people,
  roles,
  busy,
  api,
  onRun,
  onClose,
}: {
  workspace: WorkspaceDetailView | null;
  /** The tenant the workspace belongs to — needed only to address the writes. */
  organizationId: string;
  /**
   * The pool this may add from: everybody in the ORGANIZATION. A workspace
   * member is an organization member first, so this list minus the workspace's
   * own members is exactly the set of candidates.
   */
  organizationMembers: readonly MemberView[];
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

    return organizationMembers
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
  }, [workspace, organizationMembers, people, search]);

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
                {organizationMembers.length === 0
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
          const shared = await api.shareWorkspace(organizationId, workspace.id, userId);
          /*
           * The role AFTER the share, and only if one was chosen.
           * `assignWorkspaceRole` refuses somebody who is not in the workspace —
           * the grant hangs off the membership row, so there is nowhere to put
           * it before they are in.
           */
          if (role) await api.assignWorkspaceRole(organizationId, workspace.id, userId, role.id);
          return shared;
        });
      }}
      onCancel={close}
    />
  );
}
