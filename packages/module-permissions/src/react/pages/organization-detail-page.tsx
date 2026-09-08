'use client';

import { ConfirmDialog, DataGrid, type DataGridColumn, useIconSet } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { INVITATION_TTL_MS } from '../../domain/invitation.js';
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
import { Person, personLabel } from './person.js';

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
   * WORKSPACE level — the tenant-facing area PLAN §12.13 still defers. These
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
  const [key, setKey] = useState(detail.key);
  const [name, setName] = useState(detail.name);

  /*
   * Re-seeded when the row changes underneath — after a save, or when a
   * different organization loads. Without it the fields keep whatever was typed
   * against the previous one.
   */
  useEffect(() => {
    setKey(detail.key);
    setName(detail.name);
  }, [detail.key, detail.name]);

  const dirty = key.trim() !== detail.key || name.trim() !== detail.name;

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
        <button
          type="button"
          disabled={busy || !dirty || !key.trim() || !name.trim()}
          onClick={() =>
            void onRun('Organization saved.', () => api.updateOrganization(detail.id, key.trim(), name.trim()))
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
 * What this organization is entitled BY.
 *
 * ## Why it is worth a line at the top
 *
 * Entitlement is the half of access that the member list cannot show. An
 * organization with no active plan is entitled to NOTHING at organization
 * level, however many people are in it and whatever roles they hold — so
 * "why can this member not do that" has an answer here that is invisible
 * everywhere else on the page.
 *
 * ## Three states, said three ways
 *
 * A live plan, no plan, and "not readable here" — the last because
 * `subscriptions:read` is a different key from the one that opens this page,
 * and the loader turns a refusal into `undefined`. Saying "No plan" for a
 * reader who simply may not look would be a claim about the tenant rather than
 * about the reader.
 *
 * ## Only the ORGANIZATION-WIDE one is the answer
 *
 * A workspace subscription ADDS to what the organization bought; it is not what
 * the organization is on. Counting one here would report a tenant as subscribed
 * on the strength of a plan covering a single workspace — so workspace plans
 * are mentioned separately, and only when there are any.
 */
function PlanSummary({ subscriptions }: { subscriptions: SubscriptionView[] | undefined }) {
  /*
   * Called before the early return, because hooks must not sit behind a
   * condition — and the set is cheap to read whether or not there is a plan to
   * draw with it.
   */
  const iconSet = useIconSet();
  const iconsByName = useMemo(() => new Map((iconSet ?? []).map((option) => [option.name, option.Icon])), [iconSet]);

  if (subscriptions === undefined) return null;

  const organizationWide = subscriptions.find(
    (subscription) =>
      subscription.workspaceId === null && subscription.status === 'active' && !subscription.planArchived,
  );
  const workspacePlans = subscriptions.filter(
    (subscription) =>
      subscription.workspaceId !== null && subscription.status === 'active' && !subscription.planArchived,
  );

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-4 py-3 text-sm">
      <div>
        <span className="text-muted-foreground">Plan: </span>
        {organizationWide ? (
          <span className="inline-flex items-center gap-1.5 align-middle font-medium text-foreground">
            {/*
              `aria-hidden`: the label beside it already says which plan this
              is, so announcing the icon's name would read the same fact twice.
            */}
            {(() => {
              const Icon = organizationWide.planIcon ? iconsByName.get(organizationWide.planIcon) : undefined;
              return Icon ? <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : null;
            })()}
            {organizationWide.planLabel}
          </span>
        ) : (
          /*
           * Stated as a CONSEQUENCE rather than as an absence. "No plan" alone
           * reads as a field nobody filled in; the sentence says what it costs.
           */
          <span className="text-foreground">
            None — this organization is entitled to nothing at organization level.
          </span>
        )}
        {workspacePlans.length > 0 ? (
          <span className="text-muted-foreground">
            {' '}
            · plus {workspacePlans.length} workspace plan{workspacePlans.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>
      {organizationWide?.currentPeriodEnd ? (
        <span className="text-muted-foreground">Renews {when(organizationWide.currentPeriodEnd)}</span>
      ) : null}
    </div>
  );
}

function MembersSection({
  detail,
  people,
  roles,
  busy,
  api,
  onRun,
  onRemove,
}: {
  detail: OrganizationDetailView;
  people: Map<string, FoundUser>;
  roles: readonly RoleView[];
  busy: boolean;
  api: PermissionsClient;
  onRun: (label: string, action: () => Promise<{ changed: boolean; replaced?: boolean }>) => Promise<void>;
  onRemove: (member: MemberView) => void;
}) {
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  /**
   * Whether the typed address is somebody already in this organization.
   *
   * ## Why this check appeared
   *
   * It used to say, here, that inviting a person who is already in "wastes an
   * email and nothing else". That stopped being true: `acceptInvitation`
   * REPLACES the organization role, so inviting an existing member with a role
   * selected changes theirs the moment they follow the link — the same shape as
   * the bug that demoted an owner, arriving by a different door.
   *
   * ## Local, and free
   *
   * The member list and the addresses behind it are already on this page:
   * `people` is the `findUsersByIds` join the roster renders. So this costs no
   * request, which is also why it can run on every keystroke.
   *
   * ⚠ ADVISORY. The write path cannot enforce it — resolving an address to a
   * userId means reading `auth_user`, which this module may not (§12.12) — so
   * this stops the mistake at the screen where it is made, and nowhere else.
   */
  const memberEmails = useMemo(() => {
    const byUserId = new Map<string, MemberView>(detail.members.map((member) => [member.userId, member]));
    const entries: [string, MemberView][] = [];
    for (const [userId, person] of people) {
      const member = byUserId.get(userId);
      if (member) entries.push([person.email.trim().toLowerCase(), member]);
    }
    return new Map(entries);
  }, [detail.members, people]);

  /*
   * Compared the way addresses are stored — see `normaliseInviteEmail`.
   * Comparing raw strings would miss the one person whose mail client
   * capitalises, which is precisely the person this is trying to protect.
   */
  const alreadyMember = memberEmails.get(email.trim().toLowerCase()) ?? null;

  /** A live invitation to the same address, which the server refuses anyway. */
  const alreadyInvited = useMemo(
    () =>
      detail.invitations.some(
        (invitation) =>
          invitation.state === 'pending' && invitation.email.trim().toLowerCase() === email.trim().toLowerCase(),
      ),
    [detail.invitations, email],
  );

  /**
   * One call. The server mints the link and mails it.
   *
   * Whether the address has an ACCOUNT still changes nothing here — the
   * invitation is addressed to the mailbox either way. Whether it belongs to a
   * MEMBER does, and is checked above.
   */
  const invite = useCallback(async () => {
    const address = email.trim();
    if (!address) return;
    // Belt as well as braces: the button is disabled, and a form can still be
    // submitted with the keyboard.
    if (alreadyMember || alreadyInvited) return;

    setInviting(true);
    setInviteError(null);
    try {
      await onRun('Invitation sent.', async () => {
        const result = await api.inviteMember(detail.id, address, roleId || null);
        return {
          changed: true,
          message: result.delivered
            ? `Invitation sent to ${address}. The link expires in ${INVITE_VALID_FOR}.`
            : // The row exists and is live. Saying "sent" would be a lie somebody
              // discovers a week later, when nobody ever arrived.
              `Invitation created for ${address}, but the email could not be sent. Check the mail configuration, or revoke it below and try again.`,
        };
      });
      setEmail('');
      setRoleId('');
    } catch (cause) {
      setInviteError(cause instanceof Error ? cause.message : 'Could not send that invitation.');
    } finally {
      setInviting(false);
    }
  }, [api, detail.id, email, onRun, roleId, alreadyMember, alreadyInvited]);

  return (
    <section>
      <h2 className="text-lg font-medium">Members ({detail.members.length})</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Who belongs to this organization and what they hold. A role here applies across every workspace; workspace-level
        roles hang off workspace membership.
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {/*
          Said once, at the top, rather than beside every dropdown. The rule is
          not guessable from a select that simply has no second slot, and the
          answer — define a role carrying both — is the part somebody needs.
        */}
        Each member holds <strong>one</strong> organization role. To combine the rights of two, create a role that
        carries both — the role editor can clone an existing one as a starting point.
      </p>

      <FeatureGate allOf={[FEATURE.membersManage]}>
        <div className="mt-4 flex flex-wrap items-start gap-2">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            /*
              Enter sends it. The field is one of two controls and the second
              has a default — an invite form that can only be submitted with the
              mouse is one people stop using.
            */
            onKeyDown={(event) => {
              if (event.key === 'Enter' && email.trim() && !busy && !inviting) void invite();
            }}
            placeholder="someone@example.com"
            aria-label="Email address to invite"
            className="min-w-64 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <select
            value={roleId}
            onChange={(event) => setRoleId(event.target.value)}
            aria-label="Organization role on joining"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {/*
              The role is chosen NOW rather than after they arrive, so somebody
              accepting an invitation can do something the moment they land. It
              is applied on acceptance, and checked at both ends — an invitation
              naming a role that cannot be granted is refused here, not in front
              of the person who just signed up.
            */}
            <option value="">No role</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void invite()}
            disabled={busy || inviting || !email.trim() || alreadyMember !== null || alreadyInvited}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {inviting ? 'Sending…' : 'Invite member'}
          </button>
        </div>
        {alreadyMember ? (
          /*
           * A REFUSAL, not a warning. Accepting REPLACES the organization role,
           * so inviting somebody already in — with a role selected — changes
           * theirs rather than adding them.
           */
          <p role="alert" className="mt-2 text-sm text-destructive">
            {email.trim()} is already a member{alreadyMember.roles[0] ? ` (${alreadyMember.roles[0].label})` : ''}.
            Change their role in the list below instead — inviting them again would replace it.
          </p>
        ) : alreadyInvited ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {email.trim()} already has an invitation waiting. Revoke it below to send another.
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            They do not need an account yet — the link takes them to sign up, and joins them here when they finish.
          </p>
        )}
        {inviteError ? <p className="mt-2 text-sm text-destructive">{inviteError}</p> : null}
      </FeatureGate>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="py-2 pr-4 font-medium">Person</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Roles</th>
              <th className="py-2 pr-4 font-medium">Workspaces</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {detail.members.map((member) => (
              <tr key={member.membershipId} className="border-t border-border align-top">
                <td className="py-3 pr-4">
                  <Person user={people.get(member.userId)} userId={member.userId} />
                </td>
                <td className="py-3 pr-4">
                  {member.status === 'active' ? (
                    <span className="text-xs text-muted-foreground">Active</span>
                  ) : (
                    <span className="rounded-full bg-[var(--status-warning)] px-2 py-0.5 text-xs font-medium text-[var(--status-warning-foreground)]">
                      {member.status}
                    </span>
                  )}
                </td>
                <td className="py-3 pr-4">
                  <MemberRoles
                    member={member}
                    roles={roles}
                    organizationId={detail.id}
                    busy={busy}
                    api={api}
                    onRun={onRun}
                  />
                </td>
                <td className="py-3 pr-4">
                  {/*
                    READ ONLY here. Adding somebody to a workspace is done from
                    the WORKSPACE, where the choice of role belongs and where you
                    can see who is already in it — two places to do one thing is
                    two places for them to behave differently.
                  */}
                  <span className="text-xs text-muted-foreground">
                    {member.workspaceIds.length === 0
                      ? 'none'
                      : detail.workspaces
                          .filter((workspace) => member.workspaceIds.includes(workspace.id))
                          .map((workspace) => workspace.name)
                          .join(', ')}
                  </span>
                </td>
                <td className="py-3 text-right">
                  <FeatureGate allOf={[FEATURE.membersManage]}>
                    <button
                      type="button"
                      onClick={() => onRemove(member)}
                      disabled={busy}
                      className="text-xs text-destructive hover:underline disabled:opacity-60"
                    >
                      Remove
                    </button>
                  </FeatureGate>
                </td>
              </tr>
            ))}
            {detail.members.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                  Nobody is in this organization yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * How long an invitation lasts, as a phrase rather than a number.
 *
 * Derived from the constant the server actually uses, so the sentence on the
 * screen cannot drift from the expiry in the row — the classic way a UI ends up
 * promising 48 hours while the database grants seven days.
 */
const INVITE_VALID_FOR = `${Math.round(INVITATION_TTL_MS / (24 * 60 * 60 * 1000))} days`;

/** How each state reads, and how it looks. One place, so the two never disagree. */
const INVITATION_STATES: Record<string, { label: string; className: string }> = {
  pending: {
    label: 'Waiting',
    className: 'bg-[var(--status-warning)] text-[var(--status-warning-foreground)]',
  },
  accepted: {
    label: 'Joined',
    className: 'bg-[var(--status-success)] text-[var(--status-success-foreground)]',
  },
  // Three dead ends, drawn the same and worded differently: one was withdrawn,
  // one was refused by the person invited, and one simply ran out. Only the
  // last is straightforwardly worth re-sending — and telling them apart is the
  // whole reason `declined` is its own status rather than another `revoked`.
  expired: { label: 'Expired', className: 'bg-muted text-muted-foreground' },
  revoked: { label: 'Revoked', className: 'bg-muted text-muted-foreground' },
  declined: { label: 'Declined', className: 'bg-muted text-muted-foreground' },
};

/** A local date, or an em dash. Never "Invalid Date" in front of somebody. */
function when(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

/**
 * Who has been ASKED to join, and what became of the asking.
 *
 * ## Why the dead ones stay
 *
 * Expired, revoked and accepted rows are all shown. The table is the record of
 * who was invited and by whom — "how did this person get in", and "who nearly
 * did" — and a list that quietly dropped everything settled would answer both
 * questions wrongly rather than not at all. There is no delete anywhere in this
 * module for the same reason.
 *
 * ## `state`, not `status`
 *
 * The badge reads a DERIVED state. An invitation that ran out still has
 * `status: 'pending'` in its column, because expiry is computed from a
 * timestamp rather than written by a job that may not have run — see
 * `invitationState`. Reading the column here would show "Waiting" beside a link
 * the server refuses, which is exactly the disagreement that makes somebody
 * distrust the whole screen.
 */
function InvitationsSection({
  detail,
  people,
  busy,
  onRevoke,
}: {
  detail: OrganizationDetailView;
  people: Map<string, FoundUser>;
  busy: boolean;
  /*
   * Revoking is RAISED, not done here — the confirmation and the reload live in
   * the page, beside the other two destructive actions. A section that ran its
   * own write would need its own error and notice handling, and the screen
   * would then have two places reporting what happened.
   */
  onRevoke: (invitation: InvitationView) => void;
}) {
  const live = detail.invitations.filter((invitation) => invitation.state === 'pending').length;

  return (
    <section>
      <h2 className="text-lg font-medium">Invitations ({live} waiting)</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Everyone who has been asked to join, including the invitations that were taken up or withdrawn. A link is good
        for {INVITE_VALID_FOR} and can be used once.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="py-2 pr-4 font-medium">Address</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Role on joining</th>
              <th className="py-2 pr-4 font-medium">Invited by</th>
              <th className="py-2 pr-4 font-medium">Sent</th>
              <th className="py-2 pr-4 font-medium">Expires</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {detail.invitations.map((invitation) => {
              const state = INVITATION_STATES[invitation.state] ?? {
                label: invitation.state,
                className: 'bg-muted text-muted-foreground',
              };
              return (
                <tr key={invitation.id} className="border-t border-border align-top">
                  <td className="py-3 pr-4">
                    <span className="block">{invitation.email}</span>
                    {invitation.acceptedByUserId ? (
                      /*
                        Shown only when it happened, and worth showing every
                        time: an address is a mailbox, so whoever reads it can
                        follow the link. The server records who actually
                        accepted rather than preventing it, which is only useful
                        if somebody can see it.
                      */
                      <span className="block text-xs text-muted-foreground">
                        Accepted by {personLabel(people.get(invitation.acceptedByUserId), invitation.acceptedByUserId)}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-3 pr-4">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${state.className}`}>
                      {state.label}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-xs text-muted-foreground">{invitation.role?.label ?? 'None'}</td>
                  <td className="py-3 pr-4">
                    <Person user={people.get(invitation.invitedByUserId)} userId={invitation.invitedByUserId} />
                  </td>
                  <td className="py-3 pr-4 text-xs text-muted-foreground">{when(invitation.createdAt)}</td>
                  <td className="py-3 pr-4 text-xs text-muted-foreground">
                    {invitation.state === 'accepted' ? when(invitation.acceptedAt) : when(invitation.expiresAt)}
                  </td>
                  <td className="py-3 text-right">
                    {/*
                      Revoke on the LIVE ones only. An expired invitation is
                      already dead, and offering to withdraw it would suggest it
                      was not.
                    */}
                    {invitation.state === 'pending' ? (
                      <FeatureGate allOf={[FEATURE.membersManage]}>
                        <button
                          type="button"
                          onClick={() => onRevoke(invitation)}
                          disabled={busy}
                          className="text-xs text-destructive hover:underline disabled:opacity-60"
                        >
                          Revoke
                        </button>
                      </FeatureGate>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {detail.invitations.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                  Nobody has been invited yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * A member's organization role — ONE, chosen from a list.
 *
 * A select rather than the chips-plus-add this used to be, because the model
 * changed underneath it: `@@unique([membershipId])` means a member holds at
 * most one organization-level role. A control that let you add a second would
 * be offering something the database refuses.
 *
 * Wanting the rights of two roles is a reason to define a THIRD carrying both —
 * which the role editor's clone makes cheap — and the hint below says so, since
 * that is not obvious from a dropdown that simply lacks a second slot.
 *
 * "None" is a real option, not a placeholder: a member with no role holds
 * nothing, which is the state everybody starts in and a legitimate place to put
 * somebody back.
 */
function MemberRoles({
  member,
  roles,
  organizationId,
  busy,
  api,
  onRun,
}: {
  member: MemberView;
  roles: readonly RoleView[];
  organizationId: string;
  busy: boolean;
  api: PermissionsClient;
  onRun: (label: string, action: () => Promise<{ changed: boolean; replaced?: boolean }>) => Promise<void>;
}) {
  /*
   * The FIRST, and there can only be one — but read defensively rather than
   * asserting it. A row written before the constraint existed, or by a path
   * that predates it, should render as something rather than crash the grid.
   */
  const current = member.roles[0];

  return (
    <FeatureGate
      allOf={[FEATURE.membersManage]}
      fallback={
        <span className="text-xs">{current ? current.label : <span className="text-muted-foreground">none</span>}</span>
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
              void onRun(`Removed ${current.label}.`, () => api.revokeRole(organizationId, member.userId, current.id));
            }
            return;
          }

          const role = roles.find((candidate) => candidate.id === next);
          if (!role) return;
          /*
           * ONE call, even when it displaces. `assignRole` replaces inside its
           * own transaction — revoking first from here would leave a window
           * where the person holds nothing, and would fail halfway to leave
           * them there.
           */
          void onRun(`${role.label} assigned.`, () => api.assignRole(organizationId, member.userId, role.id));
        }}
        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
      >
        <option value="">No role</option>
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
 * The organization's workspaces, as a grid.
 *
 * A LIST, and only a list. Editing a workspace, adding people to it and
 * granting roles in it all live on the workspace's own page — this used to
 * expand each row inline, which put three different jobs inside a row whose
 * purpose is comparing workspaces against each other. Double-click opens one.
 *
 * Archived workspaces are shown, sorted last. The archive path filters them and
 * a list must do the opposite: hide them and the switch reads as a delete.
 */
function WorkspacesSection({
  detail,
  busy,
  api,
  onRun,
  workspaceHref,
}: {
  detail: OrganizationDetailView;
  busy: boolean;
  api: PermissionsClient;
  onRun: (label: string, action: () => Promise<{ changed: boolean; replaced?: boolean }>) => Promise<void>;
  workspaceHref: (organizationId: string, workspaceId: string) => string;
}) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');

  const rows = useMemo(
    () =>
      detail.workspaces.map((workspace) => ({
        ...workspace,
        status: workspace.archived ? 'Archived' : 'Live',
        /*
         * How many of its members hold a workspace role, as opposed to being in
         * it with none. The distinction is the model's: membership is what lets
         * somebody REACH a workspace, a role is what they may DO there — and a
         * workspace where nobody holds a role is a normal, working state.
         */
        roleCount: workspace.members.filter((member) => member.roles.length > 0).length,
      })),
    [detail.workspaces],
  );

  const columns = useMemo<DataGridColumn<(typeof rows)[number]>[]>(
    () => [
      { field: 'name', headerName: 'Workspace', flex: 3 },
      { field: 'key', headerName: 'Key', flex: 2 },
      { field: 'memberCount', headerName: 'Members', width: 120 },
      { field: 'roleCount', headerName: 'With a role', width: 130 },
      {
        field: 'status',
        headerName: 'Status',
        width: 120,
        // The one column that is not plain text: an archived workspace stops
        // resolving, and a reader scanning the list needs that before anything
        // else. A word in the same colour as its neighbours is what the eye skips.
        cellRenderer: (params: { data?: (typeof rows)[number] }) =>
          params.data?.archived ? (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
              Archived
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Live</span>
          ),
      },
    ],
    [],
  );

  return (
    <section>
      <h2 className="text-lg font-medium">Workspaces ({detail.workspaces.length})</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Workspace membership is <strong>required</strong> to reach one — no organization role widens it, and only people
        already in this organization can be added.
      </p>

      <FeatureGate allOf={[FEATURE.workspacesManage]}>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="key"
            className="w-32 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name"
            className="min-w-48 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy || !key.trim() || !name.trim()}
            onClick={() =>
              void onRun(`Created ${name.trim()}.`, async () => {
                const result = await api.createWorkspace(detail.id, key.trim(), name.trim());
                setKey('');
                setName('');
                return result;
              })
            }
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            New workspace
          </button>
        </div>
      </FeatureGate>

      <p className="mt-3 text-xs text-muted-foreground">Double-click a workspace to manage it.</p>

      <div className="mt-2 h-80">
        <DataGrid
          rows={rows}
          columns={columns}
          height="fill"
          searchPlaceholder="Search workspaces…"
          getRowId={(workspace) => workspace.id}
          /*
           * An ARCHIVED workspace opens too. Its page explains that it no
           * longer resolves and offers nothing that would change it — better
           * feedback than a double-click that appears broken.
           */
          onRowActivate={(workspace) => window.location.assign(workspaceHref(detail.id, workspace.id))}
        />
      </div>
    </section>
  );
}
