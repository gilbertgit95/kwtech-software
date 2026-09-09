'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FoundUser, MyWorkspaceView, PermissionsClient, RoleView } from '../permissions-client.js';

/**
 * Loading one workspace, and running a write against it.
 *
 * The workspace-level twin of `useMyOrganization`, extracted for the same
 * reason and at the same moment: a second screen started needing it. Overview
 * and Settings both load the whole workspace — one to show who is in it, the
 * other to edit its name — and two copies of this loader would eventually
 * disagree about the part that is easy to get wrong, which is what
 * `changed: false` means.
 *
 * ## `changed: false` is a SUCCESS
 *
 * Re-granting a role somebody holds, or removing them from a workspace they are
 * not in, leaves the world in the state that was asked for. Reporting it as a
 * failure trains people to retry something that already worked; reporting it as
 * an unqualified success hides that nothing happened. It is said plainly.
 *
 * ## Two reads FAIL SOFT
 *
 * The role catalogue and the name lookup are each guarded by a key different
 * from the one that opened the page, so a reader who may be IN the workspace
 * and may not read either is a legitimate configuration. They get raw ids and a
 * picker with only "No role", which is honest — where a page that refused to
 * render would report a correct refusal as a fault.
 */
export interface MyWorkspaceState {
  /** `undefined` while loading, `null` for "no such workspace, or not yours". */
  view: MyWorkspaceView | null | undefined;
  /** The workspace itself, or undefined. A convenience — `view.workspace`. */
  workspace: MyWorkspaceView['workspace'] | undefined;
  /** WORKSPACE-level roles that may be granted. Disabled ones are dropped. */
  grantable: RoleView[];
  /** userId → account, sparse: an id can outlive the account behind it (§12.12). */
  people: Map<string, FoundUser>;
  error: string | null;
  notice: string | null;
  busy: boolean;
  reload: () => Promise<void>;
  run: (label: string, action: () => Promise<{ changed: boolean; replaced?: boolean }>) => Promise<void>;
}

export function useMyWorkspace(
  api: PermissionsClient,
  organizationId: string | undefined,
  workspaceId: string | undefined,
): MyWorkspaceState {
  const [view, setView] = useState<MyWorkspaceView | null | undefined>(undefined);
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [people, setPeople] = useState<Map<string, FoundUser>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!organizationId || !workspaceId) {
      // Not an error to report — it is a route that cannot resolve, and the
      // page renders its own "no such workspace" for it.
      setView(null);
      return;
    }
    try {
      const found = await api.getMyWorkspace(organizationId, workspaceId);
      setView(found);
      setError(null);
      if (!found) return;

      await Promise.all([
        api
          .listMyOrganizationRoles(organizationId, 'workspace')
          .then(setRoles)
          .catch(() => setRoles([])),
        api
          .findUsersByIds(found.organizationMembers.map((member) => member.userId))
          .then((users) => setPeople(new Map(users.map((user) => [user.id, user]))))
          .catch(() => setPeople(new Map())),
      ]);
    } catch (cause) {
      setView(null);
      setError(cause instanceof Error ? cause.message : 'Could not load this workspace.');
    }
  }, [api, organizationId, workspaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

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
        await reload();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That did not work.');
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  /*
   * Disabled roles are dropped from what may be GRANTED, not from what is read:
   * `requireRole` refuses to hand out a disabled role, so offering one would
   * present a choice the write path rejects — while a member already holding a
   * since-disabled role must still render with the role they hold.
   */
  const grantable = useMemo(() => roles.filter((role) => !role.disabled), [roles]);

  return { view, workspace: view?.workspace, grantable, people, error, notice, busy, reload, run };
}
