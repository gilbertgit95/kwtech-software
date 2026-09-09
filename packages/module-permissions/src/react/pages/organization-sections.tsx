'use client';

import { DataGrid, type DataGridColumn, useIconSet } from '@kwtech/web-ui/react';
import { useCallback, useMemo, useState } from 'react';
import { INVITATION_TTL_MS } from '../../domain/invitation.js';
import { FEATURE } from '../../feature-keys.js';
import { FeatureGate } from '../feature-gate.js';
import type {
  FoundUser,
  InvitationView,
  MemberView,
  OrganizationDetailView,
  PermissionsClient,
  RoleView,
  SubscriptionView,
} from '../permissions-client.js';
import { Person, personLabel } from './person.js';

/**
 * The sections an organization screen is made of, shared by BOTH audiences.
 *
 * ## Why they were extracted
 *
 * `/admin/organizations/:id` is the platform's view of any tenant;
 * `/organizations/:id/members` and its neighbours are a tenant's view of
 * itself. They render the same rows, because they are the same facts: a member
 * list is a member list whoever is reading it. What differs is the KEY that
 * opens the page and the LEVEL the request resolves at, and both of those are
 * settled by the route and the guard before any of this renders.
 *
 * So the alternative was a second copy of a members table, an invitations
 * table, a role picker and a workspaces grid. This repo has already made that
 * call once, at a smaller scale: `Person` and `personLabel` moved here when two
 * screens started rendering membership rows, because two copies of the fallback
 * chain would eventually disagree about what to show for an id with no account.
 * These are the same argument at four times the size — and the thing they would
 * disagree about is what a role picker offers, which is not cosmetic.
 *
 * ## What is NOT shared
 *
 * The pages themselves: their chrome, which keys gate them, which writes they
 * offer, and how they are laid out. The tenant area splits across several
 * screens where the admin area is one long one, because a customer arrives
 * looking for one thing and a support engineer arrives looking at everything.
 *
 * ## The FeatureGates inside stay
 *
 * Every control here is already wrapped in the key that guards its write, so
 * these components need no notion of which audience is reading them — an
 * organization-level `members:manage` and an app-level grant both resolve to
 * the same answer at the gate. That is what makes them shareable at all.
 */

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
export function PlanSummary({ subscriptions }: { subscriptions: SubscriptionView[] | undefined }) {
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

export function MembersSection({
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

      <FeatureGate allOf={[FEATURE.membersInvite]}>
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
                  <FeatureGate allOf={[FEATURE.membersRemove]}>
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
export const INVITE_VALID_FOR = `${Math.round(INVITATION_TTL_MS / (24 * 60 * 60 * 1000))} days`;

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
export function when(value: string | null): string {
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
export function InvitationsSection({
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
                      <FeatureGate allOf={[FEATURE.membersInvite]}>
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
export function MemberRoles({
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
      allOf={[FEATURE.membersAssignRole]}
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
export function WorkspacesSection({
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

      <FeatureGate allOf={[FEATURE.workspacesCreate]}>
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
          {/*
            Description is deliberately NOT on this inline row. It is a
            three-line answer and this is a one-line form for getting a
            workspace to exist; a textarea wedged between two inputs would turn
            the quick path into a wizard. It starts as the name and is edited on
            the workspace's own Settings screen, which is where somebody is once
            they care what it says.
          */}
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
