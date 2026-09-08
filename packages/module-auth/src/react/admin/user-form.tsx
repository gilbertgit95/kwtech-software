'use client';

import { useHoldsFeature } from '@kwtech/module-kit/react';
import { type FormEvent, useEffect, useState } from 'react';
import {
  EMPTY_USER_DRAFT,
  hasUserDraftErrors,
  type UserDraft,
  type UserDraftErrors,
  validateUserDraft,
} from '../../domain/index.js';
import type { AdminUser, AssignableAppRole, UsersAdminClient } from './users-admin-client.js';

/**
 * The profile of an existing account: its name and its username.
 *
 * ## It no longer creates
 *
 * It was one form for two screens, `RoleForm`-style, until account creation
 * stopped existing: an account now comes into being when somebody accepts an
 * invitation and chooses their own password. So there is no address field — an
 * account's address is its identifier and is set once, by the invitation — and
 * no password field, because an administrator who could type one would hold
 * that person's credential. Credentials are changed by SENDING A RESET, from
 * the account's own page.
 *
 * ## The platform role is a SECOND write, behind a second key
 *
 * `roles:grant_app` in `module-permissions`, not one of this module's — the row
 * it writes is `perm_user_role`, which belongs over there. So the picker
 * appears only for somebody who may grant, the save sends it only when it
 * changed, and a refusal names that key rather than the profile one.
 *
 * ⚠ It is a separate mutation, so the two halves of one Save can disagree: the
 * name can be stored and the role refused. The form says which happened rather
 * than reporting one outcome for two writes — the alternative is a transaction
 * across two modules' tables, which is exactly what the boundary forbids.
 *
 * ## Validation is shared with the write path
 *
 * `validateUserDraft` is in `domain/`, so this form and the server apply the
 * same rules. A form validating on its own drifts, and the drift surfaces as a
 * save that passes every check on screen and is refused by the API.
 */
export function UserForm({
  client,
  user,
  currentAppRoleId,
  onSaved,
  cancelHref,
}: {
  client: UsersAdminClient;
  /** The account being edited. Required — this form no longer creates one. */
  user: AdminUser;
  /** The app-level role this account holds today, so the picker opens on it. */
  currentAppRoleId?: string | null;
  /** Called after a successful edit, so the page can refresh what it holds. */
  onSaved?: (user: AdminUser) => void;
  cancelHref: string;
}) {
  /*
   * The key that governs `perm_user_role`, asked through module-kit — the
   * contract that lets a module ask about permissions without importing the
   * module that resolves them.
   */
  const mayGrantAppRole = useHoldsFeature('roles:grant_app');

  const [appRoles, setAppRoles] = useState<AssignableAppRole[] | null>(null);
  const [appRoleId, setAppRoleId] = useState(currentAppRoleId ?? '');

  useEffect(() => {
    if (!mayGrantAppRole) return;
    let cancelled = false;
    client.listAssignableAppRoles().then((found) => {
      if (cancelled) return;
      /*
       * LEAST PRIVILEGED FIRST, by how much each grants. That ordering is also
       * the default for a new account: the top of the list is the smallest
       * amount of access that is still an answer, and a picker whose first
       * option is the most powerful role is one somebody accepts by accident.
       * Ties break by key so the order is total and does not shuffle between
       * renders.
       */
      const sorted = [...found].sort((a, b) => a.features.length - b.features.length || a.key.localeCompare(b.key));
      setAppRoles(sorted);
      // Only when nothing is chosen yet — never overwrite what this account holds.
      /*
       * Never overwrite what this account holds, and never guess: an EDIT opens
       * on the current role, including "none". The least-privileged default
       * belongs on the invite screen, where there is no existing answer.
       */
      setAppRoleId((current) => current);
    });
    return () => {
      cancelled = true;
    };
  }, [client, mayGrantAppRole]);

  const [draft, setDraft] = useState<UserDraft>({
    ...EMPTY_USER_DRAFT,
    displayName: user.displayName ?? '',
    username: user.username ?? '',
  });
  const [errors, setErrors] = useState<UserDraftErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /*
   * Cleared on the next edit rather than on a timer — the same call RoleForm
   * makes. A confirmation that disappears by itself is one somebody can miss,
   * and it stops being true the moment the draft changes again.
   */
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof UserDraft>(field: K, value: UserDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setSaved(false);
    // The error for the field being edited goes NOW, not at the next submit:
    // leaving it under a field somebody is fixing reads as "still wrong".
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = validateUserDraft(draft);
    setErrors(found);
    if (hasUserDraftErrors(found)) return;

    setSaving(true);
    setFailure(null);
    try {
      /*
       * Only CHANGED fields are sent. The mutation reads an absent argument as
       * "leave it alone", so sending both every time would rewrite a username
       * somebody else edited between this page loading and the save.
       */
      const updated = await client.updateProfile(user.id, {
        ...(draft.displayName !== (user.displayName ?? '') ? { displayName: draft.displayName.trim() } : {}),
        ...(draft.username !== (user.username ?? '') ? { username: draft.username.trim() } : {}),
      });

      /*
       * The role goes SECOND, and only when it changed. Second because the
       * profile write is the one this form is named for, and a role change that
       * failed should not also lose a rename that would have worked.
       */
      if (mayGrantAppRole && appRoleId !== (currentAppRoleId ?? '')) {
        await client.setAppRole(user.id, appRoleId);
      }
      onSaved?.(updated);
      setSaved(true);
    } catch (cause) {
      /*
       * Passed through rather than replaced. The API says whether the address
       * is taken, whether the username clashes and whether the password is too
       * weak — all things the person at this form can act on, and all better
       * said in the API's own words than in a generic failure.
       */
      setFailure(cause instanceof Error ? cause.message : 'That could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="rounded-md border border-border p-4" noValidate>
      {failure ? (
        <p
          role="alert"
          className="mb-3 rounded-md bg-[var(--status-danger)] px-3 py-2 text-sm text-[var(--status-danger-foreground)]"
        >
          {failure}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="mb-3 rounded-md bg-muted px-3 py-2 text-sm text-foreground">
          Saved.
        </p>
      ) : null}

      {/*
        SHOWN, not editable. An administrator editing a name needs to see whose
        it is, and the address is the identifier the invitation set — changing
        it would silently re-point invitations, member lookups and resets.
      */}
      <div className="text-sm">
        <span className="text-muted-foreground">Email address</span>
        <p className="mt-1 text-foreground">{user.email}</p>
      </div>

      <Field
        label="Display name"
        value={draft.displayName}
        onChange={(value) => set('displayName', value)}
        error={errors.displayName}
        hint="Optional. The name shown around the app."
      />

      <Field
        label="Username"
        value={draft.username}
        onChange={(value) => set('username', value)}
        error={errors.username}
        autoComplete="off"
        hint="Optional. Lower-cased, and usable in place of the address when signing in."
      />

      {mayGrantAppRole ? (
        <label className="mt-4 block text-sm">
          <span className="text-muted-foreground">Platform role</span>
          <select
            value={appRoleId}
            onChange={(event) => {
              setAppRoleId(event.target.value);
              setSaved(false);
            }}
            className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-foreground"
          >
            {/*
              An explicit "no role" option, and it is not the default. Most
              accounts legitimately hold none — they belong to an organization
              instead — so it has to be reachable, but the least-privileged real
              role is what a new account should land on.
            */}
            <option value="">No platform role</option>
            {appRoles?.map((role) => (
              <option key={role.id} value={role.id}>
                {role.label} — {role.features.length} right{role.features.length === 1 ? '' : 's'}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted-foreground">
            What this person may do across the platform, outside any organization. Listed least first; you can only
            grant a role whose rights you hold yourself.
          </span>
        </label>
      ) : null}

      <div className="mt-5 flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <a href={cancelHref} className="rounded-md border border-border px-3 py-2 text-sm">
          Cancel
        </a>
      </div>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  error,
  hint,
  type = 'text',
  autoComplete,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  hint?: string | undefined;
  type?: string;
  autoComplete?: string;
  disabled?: boolean;
}) {
  return (
    <label className="mt-4 block text-sm first:mt-0">
      <span className="text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        autoComplete={autoComplete}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-foreground disabled:opacity-60"
      />
      {/* The error REPLACES the hint rather than joining it: two lines of small
          grey text under one field is where a message goes unread. */}
      {error ? (
        <span className="mt-1 block text-xs text-[var(--status-danger-foreground)]">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}
