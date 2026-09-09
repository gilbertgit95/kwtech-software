'use client';

import { ConfirmDialog } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { FEATURE } from '../../feature-keys.js';
import { FeatureGate } from '../feature-gate.js';
import {
  createPermissionsClient,
  type FoundUser,
  type InvitationView,
  type MemberView,
  type OrganizationDetailView,
  type PermissionsClient,
  type RoleView,
  type SubscriptionView,
} from '../permissions-client.js';
import { AdminPage, AdminPlaceholder } from './admin-page.js';
/*
 * The tables, the role picker and the workspaces grid used to be defined in
 * this file. They moved when the tenant screens started rendering the same
 * rows — see `organization-sections.tsx` for why, and for what deliberately did
 * NOT move with them.
 */
import { InvitationsSection, MembersSection, PlanSummary, WorkspacesSection } from './organization-sections.js';
import { personLabel } from './person.js';

/**
 * /admin/organizations/:organizationId — one tenant's people and workspaces.
 *
 * ## One page, four keys
 *
 * The page BODY takes `organizations:read` (app level — reading any tenant is a
 * platform right). The controls inside take `organizations:manage`,
 * `members:manage` and `workspaces:manage`. So somebody may be able to look at
 * a tenant and change nothing in it, which is the common case for support and
 * exactly what the split is for — and renaming a customer is separated from
 * reading one for the same reason, one level finer.
 *
 * ## People are INVITED, not added
 *
 * This screen has no "add member" control, and the difference is not cosmetic.
 * `addMember` takes a userId, so it can only ever reach somebody who already
 * has an account — which is nobody, the first time a company is asked to join.
 * Inviting takes an ADDRESS, mints a link, and creates the membership when it
 * is followed.
 *
 * `addMember` still exists and is still guarded; it is what `acceptInvitation`
 * ends up doing, and what a future import tool would use. It is simply not a
 * button, because a screen offering both would be offering a way to bypass the
 * one that sends the email.
 *
 * The invitations list below the members is deliberately part of the same
 * screen rather than a tab: "who is in this organization" and "who has been
 * asked" are one question in practice, and somebody hunting for a person who
 * cannot sign in needs to find the pending row without knowing to look.
 *
 * ## What this screen does NOT do
 *
 * WORKSPACE-level role grants. `assignWorkspaceRole` and `revokeWorkspaceRole`
 * are exposed and guarded, and reachable only through the API today. They need
 * a per-workspace member screen, which is the next piece rather than a corner
 * of this one — squeezing a second role picker into a row that already toggles
 * workspace membership is how a screen becomes unreadable.
 */

/**
 * Only organization-level roles may be granted to a membership, and disabled
 * ones are excluded because `requireRole` refuses to hand one out — offering it
 * would present a choice the write path rejects.
 */
function organizationRoles(roles: readonly RoleView[]): RoleView[] {
  return roles.filter((role) => role.level === 'organization' && !role.disabled);
}

export function OrganizationDetailPage({
  organizationId,
  client,
  listHref = '/admin/organizations',
  workspaceHref = (id: string, workspaceId: string) => `/admin/organizations/${id}/workspaces/${workspaceId}`,
}: {
  organizationId: string | undefined;
  client?: PermissionsClient;
  listHref?: string;
  /**
   * Where a workspace opens.
   *
   * Under `/admin`, mirroring the screen it descends from. The bare
   * `/organizations/:orgId/workspaces/:workspaceId` is deliberately NOT used:
   * that is the convention `scope.ts` parses, and a route there resolves at
   * WORKSPACE level — the tenant-facing area, which now exists. These
   * are platform-staff screens and resolve at app level.
   */
  workspaceHref?: (organizationId: string, workspaceId: string) => string;
}) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  const [detail, setDetail] = useState<OrganizationDetailView | null | undefined>(undefined);
  const [roles, setRoles] = useState<RoleView[]>([]);
  /**
   * userId → the person, joined from the app's user lookup.
   *
   * The permissions module holds a `userId` and nothing else — it does not own
   * identity (§12.12) — so a members grid would otherwise be a column of cuids.
   * The join happens HERE, on the client, because the module's resolver cannot
   * reach `auth_user` and the app's query is the only thing that can.
   *
   * Empty when the lookup is unavailable, and the rows then fall back to the
   * id. See `findUsersByIds`: it is the one call in the client that fails soft.
   */
  const [people, setPeople] = useState<Map<string, FoundUser>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<MemberView | null>(null);
  const [archiving, setArchiving] = useState<{ id: string; name: string } | null>(null);
  const [revoking, setRevoking] = useState<InvitationView | null>(null);
  /*
   * What this tenant is entitled BY. Undefined while unknown — including when
   * the read is refused, which is a legitimate state: subscriptions are guarded
   * by `subscriptions:read`, a different key from the one that opens this page.
   */
  const [subscriptions, setSubscriptions] = useState<SubscriptionView[] | undefined>(undefined);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      /*
       * The subscriptions read FAILS SOFT, unlike the other two: a reader who
       * may open this organization but not read what it bought should get the
       * page without the plan, rather than an error about a key they were never
       * meant to hold.
       */
      const [found, roleList, subscriptionList] = await Promise.all([
        api.getOrganization(organizationId),
        api.listRoles(),
        api.listSubscriptions(organizationId).catch(() => undefined),
      ]);
      setDetail(found);
      setRoles(roleList);
      setSubscriptions(subscriptionList);
      setError(null);

      /*
       * AFTER the detail, not alongside it: the ids to look up come out of it.
       * One batch call rather than one per row — a members grid that fetched a
       * name per member would issue a request per person, which is the join
       * this batches away.
       */
      if (found) {
        /*
         * Members AND the people named on invitations. An invitation says who
         * sent it, and an accepted one says who took it up — both are ids, and
         * both are shown. `findUsersByIds` dedupes, so the overlap between an
         * inviter and a member costs nothing.
         */
        const ids = [
          ...found.members.map((member) => member.userId),
          ...found.invitations.map((invitation) => invitation.invitedByUserId),
          ...found.invitations.flatMap((invitation) =>
            invitation.acceptedByUserId ? [invitation.acceptedByUserId] : [],
          ),
        ];
        const users = await api.findUsersByIds(ids);
        setPeople(new Map(users.map((user) => [user.id, user])));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the organization.');
    }
  }, [api, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Every write goes through here: run it, report what it did, re-read.
   *
   * Re-reading rather than patching state locally, because a write can change
   * more than it returns — adding a member changes a seat count, archiving a
   * workspace changes who is in it — and a screen that patched one field would
   * drift from the row it is showing.
   *
   * `changed: false` is reported as its own outcome. It is a SUCCESS: the role
   * was already held, the person was already out of that workspace. Saying
   * "already done" beats claiming an action that did not happen.
   */
  const run = useCallback(
    async (label: string, action: () => Promise<{ changed: boolean; replaced?: boolean; message?: string }>) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await action();
        setNotice(
          // An action may say for itself what happened, for the cases the two
          // outcomes below cannot express — an invitation that was written but
          // not delivered is neither "done" nor "already the case".
          result.message ??
            (result.changed
              ? // A replacement is worth saying out loud: granting a role silently
                // removed another, and somebody who did not know the rule would
                // otherwise discover it as a missing permission later.
                result.replaced
                ? `${label} Their previous role was removed — a member holds one.`
                : label
              : `${label} — already the case, nothing changed.`),
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

  if (!organizationId) {
    return (
      <AdminPage
        title="Organization"
        feature={FEATURE.organizationsRead}
        backTo={{ href: listHref, label: 'Organizations' }}
      >
        <AdminPlaceholder>No organization id in the URL.</AdminPlaceholder>
      </AdminPage>
    );
  }

  return (
    <AdminPage
      title={detail ? detail.name : 'Organization'}
      description={detail ? `Key: ${detail.key}` : undefined}
      feature={FEATURE.organizationsRead}
      backTo={{ href: listHref, label: 'Organizations' }}
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

      {detail ? <PlanSummary subscriptions={subscriptions} /> : null}

      {detail === undefined ? (
        <div className="h-64 animate-pulse rounded-md bg-muted" />
      ) : detail === null ? (
        <AdminPlaceholder>No organization with that id. It may have been removed.</AdminPlaceholder>
      ) : (
        <div className="flex flex-col gap-10">
          <OrganizationSettings detail={detail} busy={busy} api={api} onRun={run} />
          <MembersSection
            detail={detail}
            people={people}
            roles={organizationRoles(roles)}
            busy={busy}
            api={api}
            onRun={run}
            onRemove={setRemoving}
          />
          <InvitationsSection detail={detail} people={people} busy={busy} onRevoke={setRevoking} />
          <WorkspacesSection detail={detail} busy={busy} api={api} onRun={run} workspaceHref={workspaceHref} />
        </div>
      )}

      <ConfirmDialog
        open={removing !== null}
        /*
         * NAMES the person. A destructive confirmation whose only identifier is
         * "this member" is one you cannot check before agreeing to it — and the
         * whole reason the grid resolves names is that a column of cuids cannot
         * be safely acted on.
         */
        title={`Remove ${removing ? personLabel(people.get(removing.userId), removing.userId) : 'this member'}?`}
        confirmLabel="Remove"
        danger
        pending={busy}
        description={
          <>
            Their role grants and workspace memberships go with them, by cascade. Nothing else is deleted, and they can
            be added again — but the roles they held are not remembered.
          </>
        }
        onConfirm={() => {
          const member = removing;
          setRemoving(null);
          if (member) void run('Member removed.', () => api.removeMember(detail?.id ?? '', member.userId));
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
            The link stops working immediately, even if it has already been opened. The invitation stays in this list,
            marked revoked — the record of somebody having been asked is worth keeping. They can be invited again.
          </>
        }
        onConfirm={() => {
          const invitation = revoking;
          setRevoking(null);
          if (invitation) {
            void run('Invitation revoked.', () => api.revokeInvitation(detail?.id ?? '', invitation.id));
          }
        }}
        onCancel={() => setRevoking(null)}
      />

      <ConfirmDialog
        open={archiving !== null}
        title={`Archive ${archiving?.name ?? ''}?`}
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
          const workspace = archiving;
          setArchiving(null);
          if (workspace) void run('Workspace archived.', () => api.archiveWorkspace(detail?.id ?? '', workspace.id));
        }}
        onCancel={() => setArchiving(null)}
      />
    </AdminPage>
  );
}

/**
 * The organization's own data — name and key.
 *
 * ## Why a name is editable
 *
 * Because it is a LABEL, not an identity. It is typed once, by somebody who may
 * mistype it, and then the company rebrands or gets acquired. An organization
 * that could never be renamed would make the first spelling permanent for
 * everyone who reads it — and this screen already renames workspaces, which are
 * the smaller version of the same thing.
 *
 * ## And the key with it
 *
 * Editable here, unlike a role's key or a plan's, and the difference is what
 * references them: a plan key is the primary key every subscription points at,
 * while an organization is addressed by `id` everywhere in this codebase. Its
 * key exists for humans.
 *
 * ## A separate key from reading
 *
 * `organizations:manage`, not `organizations:read`. Support staff look at
 * tenants constantly and rename one almost never, so one key for both would
 * hand every support engineer the ability to rename a customer. Somebody
 * holding only the read key sees this section's values in the page heading and
 * no form at all.
 */
function OrganizationSettings({
  detail,
  busy,
  api,
  onRun,
}: {
  detail: OrganizationDetailView;
  busy: boolean;
  api: PermissionsClient;
  onRun: (label: string, action: () => Promise<{ changed: boolean; replaced?: boolean }>) => Promise<void>;
}) {
  const keyId = useId();
  const nameId = useId();
  const descriptionId = useId();
  const [key, setKey] = useState(detail.key);
  const [name, setName] = useState(detail.name);
  const [description, setDescription] = useState(detail.description ?? '');

  /*
   * Re-seeded when the row changes underneath — after a save, or when a
   * different organization loads. Without it the fields keep whatever was typed
   * against the previous one.
   */
  useEffect(() => {
    setKey(detail.key);
    setName(detail.name);
    setDescription(detail.description ?? '');
  }, [detail.key, detail.name, detail.description]);

  const dirty =
    key.trim() !== detail.key || name.trim() !== detail.name || description.trim() !== (detail.description ?? '');

  return (
    <FeatureGate allOf={[FEATURE.organizationsManage]}>
      <section>
        <h2 className="text-lg font-medium">Organization</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={nameId} className="mb-1 block text-sm font-medium">
              Name
            </label>
            <input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              What this tenant is called, everywhere it is shown. Change it freely.
            </p>
          </div>
          <div>
            <label htmlFor={keyId} className="mb-1 block text-sm font-medium">
              Key
            </label>
            <input
              id={keyId}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {/*
                Honest about both halves: safe to change, and unique across the
                platform — so the one way this save fails is a key another
                tenant already holds, and that is worth knowing before typing it
                rather than after.
              */}
              Unique across the platform. Safe to change — nothing is addressed by an organization&rsquo;s key.
            </p>
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
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            The tenant's own words. New organizations start with their name here, so a value you have not seen edited is
            a placeholder rather than something somebody wrote. Left empty, it falls back to the name again.
          </p>
        </div>

        <button
          type="button"
          disabled={busy || !dirty || !key.trim() || !name.trim()}
          onClick={() =>
            void onRun('Organization saved.', () =>
              api.updateOrganization(detail.id, key.trim(), name.trim(), description.trim() || null),
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
