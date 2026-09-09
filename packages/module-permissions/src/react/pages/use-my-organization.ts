'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FoundUser, OrganizationDetailView, PermissionsClient } from '../permissions-client.js';

/**
 * Loading one tenant organization, and running a write against it.
 *
 * Extracted because four screens in this area do exactly this — read the
 * organization, join the member ids to accounts, then run writes that report
 * what they did and re-read. Four copies of that would eventually disagree
 * about the one part that is easy to get wrong: what `changed: false` means.
 *
 * ## `changed: false` is a SUCCESS
 *
 * Re-granting a role somebody holds, or removing them from a workspace they are
 * not in, leaves the world in the state that was asked for. Reporting it as a
 * failure trains people to retry something that already worked; reporting it as
 * an unqualified success hides that nothing happened. It is said plainly
 * instead.
 *
 * ## Names are joined here, and may be missing
 *
 * `perm_membership.userId` has no foreign key to `auth_user` (§12.12), so an id
 * can outlive the account behind it and `findUsersByIds` legitimately returns
 * fewer rows than it was asked for. The map is sparse on purpose and `Person`
 * renders the raw id for a miss — that is a real thing to be able to see and
 * act on, not a failure to hide.
 *
 * The lookup FAILS SOFT: it is guarded by `members:manage` and lives in the
 * app, not in this module, so a reader who may open the organization but not
 * manage its people gets a members list of ids rather than a page that refuses
 * to render.
 */
export interface MyOrganizationState {
  /** `undefined` while loading, `null` for "no such organization". */
  detail: OrganizationDetailView | null | undefined;
  /** userId → account, sparse. See above. */
  people: Map<string, FoundUser>;
  error: string | null;
  notice: string | null;
  busy: boolean;
  reload: () => Promise<void>;
  /** Clears whatever the last write said, for a screen opening a fresh dialog. */
  clearNotice: () => void;
  run: (label: string, action: () => Promise<{ changed: boolean; replaced?: boolean }>) => Promise<void>;
}

export function useMyOrganization(api: PermissionsClient, organizationId: string | undefined): MyOrganizationState {
  const [detail, setDetail] = useState<OrganizationDetailView | null | undefined>(undefined);
  const [people, setPeople] = useState<Map<string, FoundUser>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!organizationId) {
      // No id in the URL is not an error to report — it is a route that cannot
      // resolve, and the page renders its own "no such organization" for it.
      setDetail(null);
      return;
    }
    try {
      const found = await api.getMyOrganization(organizationId);
      setDetail(found);
      setError(null);
      if (!found) return;

      try {
        const users = await api.findUsersByIds(found.members.map((member) => member.userId));
        setPeople(new Map(users.map((user) => [user.id, user])));
      } catch {
        /*
         * Swallowed, deliberately, and it is the only swallow here. The lookup
         * is guarded by `members:manage` — a different key from the one that
         * opened this page — so a member who may see the organization and not
         * administer it will be refused, every time, as designed. Surfacing
         * that as a page error would report a correct refusal as a fault.
         */
        setPeople(new Map());
      }
    } catch (cause) {
      setDetail(null);
      setError(cause instanceof Error ? cause.message : 'Could not load this organization.');
    }
  }, [api, organizationId]);

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

  return { detail, people, error, notice, busy, reload, clearNotice: () => setNotice(null), run };
}
