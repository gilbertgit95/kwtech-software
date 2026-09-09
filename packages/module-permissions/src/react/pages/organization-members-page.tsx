'use client';

import { ConfirmDialog } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FEATURE } from '../../feature-keys.js';
import type { InvitationView, MemberView, PermissionsClient, RoleView } from '../permissions-client.js';
import { createPermissionsClient } from '../permissions-client.js';
import { organizationHref } from '../tenant-nav.js';
import { AdminPlaceholder } from './admin-page.js';
import { OrganizationNotices } from './organization-notices.js';
import { InvitationsSection, MembersSection } from './organization-sections.js';
import { personLabel } from './person.js';
import { TenantPage } from './tenant-page.js';
import { useMyOrganization } from './use-my-organization.js';

/**
 * `/organizations/:organizationId/members` — who is here, and who was asked.
 *
 * ## The same tables as the admin screen, a different door
 *
 * `MembersSection` and `InvitationsSection` are shared with
 * `/admin/organizations/:id`, because a member list is a member list whoever is
 * reading it. What differs is entirely upstream of the markup: this page is
 * gated on `members:manage`, an ORGANIZATION-level key, and the request behind
 * every control resolves inside this tenant — so a customer's own administrator
 * works it, where the admin screen resolves at app level and answers only to
 * platform staff.
 *
 * ## Why members and invitations are one page
 *
 * "Who is in this organization" and "who has been asked" are one question in
 * practice. Somebody hunting for a colleague who cannot sign in has to find the
 * pending row without knowing to look for it — a tab would hide exactly the
 * answer they came for.
 *
 * ## The roles offered are narrowed server-side
 *
 * `listMyOrganizationRoles` filters app-level roles out. Every role in this
 * system is a shared preset in the null scope (§12.27), so an unfiltered list
 * would offer a customer's administrator `super-admin` in the same dropdown as
 * `member`. `assignRole` would refuse it — a granter cannot hand out what they
 * do not hold — but offering a choice that will be refused teaches people to
 * distrust the screen.
 */
export function OrganizationMembersPage({
  organizationId,
  client,
}: {
  organizationId: string | undefined;
  client?: PermissionsClient;
}) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  const { detail, people, error, notice, busy, run } = useMyOrganization(api, organizationId);
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [removing, setRemoving] = useState<MemberView | null>(null);
  const [revoking, setRevoking] = useState<InvitationView | null>(null);

  const loadRoles = useCallback(async () => {
    if (!organizationId) return;
    try {
      setRoles(await api.listMyOrganizationRoles(organizationId, 'organization'));
    } catch {
      /*
       * FAILS SOFT to an empty list, for the same reason the name lookup does:
       * `roles:read` is a different key from the one that opened this page, so
       * a member who may see the roster and not the role catalogue is a
       * legitimate configuration. They get a picker with only "No role" in it,
       * which is honest — and `MemberRoles` falls back to the label text for
       * anyone without `members:manage` anyway.
       */
      setRoles([]);
    }
  }, [api, organizationId]);

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  /*
   * Disabled roles are dropped HERE rather than in the query, and the asymmetry
   * is deliberate: `requireRole` refuses to hand out a disabled role, so
   * offering one would present a choice the write path rejects — but the list
   * still has to contain it, or a member already holding a since-disabled role
   * would render with an empty select instead of the role they hold.
   */
  const grantable = useMemo(() => roles.filter((role) => !role.disabled), [roles]);

  return (
    <TenantPage
      organizationName={detail?.name}
      organizationId={detail?.id}
      title="Members"
      feature={FEATURE.membersRead}
      backTo={{ href: organizationHref(organizationId ?? ''), label: detail?.name ?? 'Organization' }}
    >
      <OrganizationNotices error={error} notice={notice} />

      {detail === undefined ? (
        <div className="h-64 animate-pulse rounded-md bg-muted" />
      ) : !detail ? (
        <AdminPlaceholder>No organization with that id, or you are not a member of it.</AdminPlaceholder>
      ) : (
        <div className="flex flex-col gap-10">
          <MembersSection
            detail={detail}
            people={people}
            roles={grantable}
            busy={busy}
            api={api}
            onRun={run}
            onRemove={setRemoving}
          />
          <InvitationsSection detail={detail} people={people} busy={busy} onRevoke={setRevoking} />
        </div>
      )}

      {/*
        Both confirmations live HERE rather than inside the sections, which is
        why the sections raise them instead of running them. A section owning
        its own write would need its own error and notice handling, and the
        screen would then have two places reporting what happened.
      */}
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing ? personLabel(people.get(removing.userId), removing.userId) : ''}?`}
        confirmLabel="Remove"
        danger
        pending={busy}
        description={
          <>
            Their role grants and workspace memberships go with them. Nothing else about their account changes — they
            keep it, and they can be invited back.
          </>
        }
        onConfirm={() => {
          const member = removing;
          setRemoving(null);
          if (member && detail) {
            void run('Member removed.', () => api.removeMember(detail.id, member.userId));
          }
        }}
        onCancel={() => setRemoving(null)}
      />

      <ConfirmDialog
        open={revoking !== null}
        title={`Revoke the invitation to ${revoking?.email ?? ''}?`}
        confirmLabel="Revoke"
        danger
        pending={busy}
        description={
          <>
            The link stops working immediately. The row stays in the list, so it remains visible that they were asked —
            and a new invitation can be sent to the same address afterwards.
          </>
        }
        onConfirm={() => {
          const invitation = revoking;
          setRevoking(null);
          if (invitation && detail) {
            void run('Invitation revoked.', () => api.revokeInvitation(detail.id, invitation.id));
          }
        }}
        onCancel={() => setRevoking(null)}
      />
    </TenantPage>
  );
}
