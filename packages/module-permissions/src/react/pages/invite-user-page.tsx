'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import {
  EMPTY_INVITATION_DRAFT,
  type InvitationDraft,
  type InvitationDraftErrors,
  validateInvitationDraft,
} from '../../domain/invitation.js';
import { FEATURE } from '../../feature-keys.js';
import {
  createPermissionsClient,
  type OrganizationView,
  type PermissionsClient,
  type RoleView,
} from '../permissions-client.js';
import { usePermissions } from '../use-permissions.js';
import { AdminPage } from './admin-page.js';

/**
 * /admin/invitations/new — the only way an account comes into being.
 *
 * ## Why inviting, rather than creating
 *
 * An administrator typing somebody else's password is the thing this replaces.
 * Nothing is written to `auth_user` here at all: this writes ONE
 * `PermInvitation` row, the person follows the link, and the account is created
 * by them, with a password only they know, at the moment they accept. Which is
 * also why the form asks for no display name — they type their own.
 *
 * It is the same flow the members screen already used, widened by two fields
 * rather than duplicated.
 *
 * ## Why the screen lives in module-permissions
 *
 * Every field is this module's: the invitation row, the roles, the
 * organizations. The account is `module-auth`'s and does not exist yet, and the
 * composition that creates one on acceptance is the app's, where it already
 * was. So nothing here crosses a boundary — the Users list in `module-auth`
 * links to this route by path, which is a string rather than an import.
 *
 * ## The app-level role is REQUIRED, and defaults to the least
 *
 * An invitation granting no app role produces somebody who signs in and cannot
 * edit their own profile — `account:profile_write` comes from an app-level role
 * and nothing else. So the field is required, and the list is ordered by how
 * much each role grants, least first, with the first preselected. A picker
 * whose default is the most powerful role is one somebody accepts by accident.
 *
 * Only roles the inviter could grant themselves are offered — the server
 * applies the same rule, and refuses anything carrying rights the inviter does
 * not hold. That is what stops "invite an address I own as super-admin" being a
 * way to grant yourself anything.
 *
 * ## The organization is OPTIONAL
 *
 * Somebody can belong to the platform and to no tenant — `loadContext` is
 * explicitly built for it. Choosing one adds a membership and reveals the
 * organization-role picker beside it, which is the members screen's field
 * appearing where it applies.
 */
export function InviteUserPage({
  client,
  listHref = '/admin/users',
}: {
  client?: PermissionsClient;
  /** Where Cancel goes, and where a sent invitation offers to return to. */
  listHref?: string;
}) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  const context = usePermissions();

  const [draft, setDraft] = useState<InvitationDraft>({ ...EMPTY_INVITATION_DRAFT, organizationId: '', appRoleId: '' });
  const [errors, setErrors] = useState<InvitationDraftErrors>({});
  const [roles, setRoles] = useState<RoleView[] | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationView[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; delivered: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    /*
     * Both, together. An app that has no organizations yet is a normal state —
     * the picker simply offers none — so a failure to read them must not stop
     * the roles arriving, which are what the form cannot work without.
     */
    Promise.all([api.listRoles(null), api.listOrganizations().catch(() => [])])
      .then(([roleList, organizationList]) => {
        if (cancelled) return;
        setRoles(roleList);
        setOrganizations(organizationList);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setFailure(cause instanceof Error ? cause.message : 'Could not load the roles.');
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  /**
   * What the inviter may actually hand out: app level, enabled, and carrying
   * nothing the inviter does not hold.
   *
   * Filtered rather than shown-and-refused, so the form cannot offer a choice
   * the server will reject — the same rule `RoleForm` applies when composing a
   * role, and the same reason the validator is shared.
   */
  const held = useMemo(() => new Set(context?.effective ?? []), [context]);
  const appRoles = useMemo(
    () =>
      (roles ?? [])
        .filter((role) => role.level === 'app' && !role.disabled)
        .filter((role) => role.features.every((feature) => held.has(feature)))
        // LEAST PRIVILEGED FIRST, and the key breaks ties so the order is total
        // and does not shuffle between renders.
        .sort((a, b) => a.features.length - b.features.length || a.key.localeCompare(b.key)),
    [roles, held],
  );

  const organizationRoles = useMemo(
    () => (roles ?? []).filter((role) => role.level === 'organization' && !role.disabled),
    [roles],
  );

  // Preselected once the list is known, and never afterwards: re-running it
  // would fight somebody who deliberately chose a different role.
  useEffect(() => {
    setDraft((current) => (current.appRoleId ? current : { ...current, appRoleId: appRoles[0]?.id ?? '' }));
  }, [appRoles]);

  const set = <K extends keyof InvitationDraft>(field: K, value: InvitationDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setSent(null);
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = validateInvitationDraft(draft, {
      requireAppRole: true,
      appRoleIds: appRoles.map((role) => role.id),
      roleIds: organizationRoles.map((role) => role.id),
    });
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    setFailure(null);
    try {
      const result = await api.inviteUser({
        email: draft.email.trim(),
        appRoleId: draft.appRoleId ?? '',
        organizationId: draft.organizationId || null,
        roleId: draft.roleId || null,
      });
      /*
       * `delivered` is reported rather than assumed. The row exists either way
       * — the module writes it before it sends — so a mail outage must not read
       * as a failed invitation, and the person who pressed the button is the
       * one who needs to know the email did not go out.
       */
      setSent({ email: draft.email.trim(), delivered: result.delivered });
      setDraft({ ...EMPTY_INVITATION_DRAFT, organizationId: '', appRoleId: draft.appRoleId ?? '' });
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'That invitation could not be sent.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminPage
      title="Invite a user"
      description="Sends a link. The account is created when they accept, with a password only they know."
      feature={FEATURE.rolesGrantApp}
      layout="prose"
      backTo={{ href: listHref, label: 'Users' }}
    >
      {failure ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {failure}
        </p>
      ) : null}

      {sent ? (
        <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
          {sent.delivered ? (
            <>
              Invitation sent to <strong>{sent.email}</strong>. It expires in seven days and can be used once.
            </>
          ) : (
            <>
              The invitation for <strong>{sent.email}</strong> was created, but the email could not be sent. It is valid
              — resend it or revoke it from the organization's page.
            </>
          )}
        </p>
      ) : null}

      <form onSubmit={(event) => void submit(event)} className="rounded-md border border-border p-4" noValidate>
        <Field id="invite-email" label="Email address" error={errors.email}>
          <input
            id="invite-email"
            type="email"
            value={draft.email}
            onChange={(event) => set('email', event.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-foreground"
          />
        </Field>

        <Field
          id="invite-app-role"
          label="Platform role"
          error={errors.appRoleId}
          hint="What they may do across the platform. Listed least first; only roles you hold yourself are offered."
        >
          <select
            id="invite-app-role"
            value={draft.appRoleId ?? ''}
            onChange={(event) => set('appRoleId', event.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-foreground"
          >
            {/*
              No empty option. The field is required, and an invitation granting
              no app role produces somebody who cannot even edit their own
              profile — see the header.
            */}
            {appRoles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.label} — {role.features.length} right{role.features.length === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </Field>

        <Field
          id="invite-organization"
          label="Organization (optional)"
          hint="Leave empty to invite them to the platform only. They can be added to one later."
        >
          <select
            id="invite-organization"
            value={draft.organizationId ?? ''}
            onChange={(event) => {
              set('organizationId', event.target.value);
              // The organization role belongs to the organization that was just
              // abandoned. Keeping it would send a role from another tenant.
              if (!event.target.value) set('roleId', '');
            }}
            className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-foreground"
          >
            <option value="">No organization</option>
            {(organizations ?? []).map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
        </Field>

        {/* Revealed by the choice above, because a role in no organization is a
            contradiction the validator also refuses. */}
        {draft.organizationId ? (
          <Field id="invite-org-role" label="Role in that organization (optional)" error={errors.roleId}>
            <select
              id="invite-org-role"
              value={draft.roleId}
              onChange={(event) => set('roleId', event.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-foreground"
            >
              <option value="">No role</option>
              {organizationRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <div className="mt-5 flex items-center gap-2">
          <button
            type="submit"
            disabled={saving || appRoles.length === 0}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {saving ? 'Sending…' : 'Send invitation'}
          </button>
          <a href={listHref} className="rounded-md border border-border px-3 py-2 text-sm">
            Cancel
          </a>
        </div>

        {roles !== null && appRoles.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {/*
              Says WHY rather than leaving a disabled button unexplained. The
              cause is almost always the escalation filter: somebody holding
              `roles:grant_app` but few features can grant nothing.
            */}
            There is no app-level role you can grant. A role can only be handed out by somebody who holds everything it
            carries.
          </p>
        ) : null}
      </form>
    </AdminPage>
  );
}

/**
 * `htmlFor` and an `id` rather than a label WRAPPING its control.
 *
 * Wrapping is the shorter spelling and works, but this component takes its
 * control as `children`, so nothing — a linter included — can see that the two
 * belong together. Naming the association explicitly is what makes the pair
 * checkable, and it is also what a screen reader announces.
 */
function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 block text-sm first:mt-0">
      <label htmlFor={id} className="text-muted-foreground">
        {label}
      </label>
      {children}
      {/* The error REPLACES the hint: two lines of small grey text under one
          field is where a message goes unread. */}
      {error ? (
        <span className="mt-1 block text-xs text-destructive">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}
