'use client';

import { type FormEvent, useState } from 'react';
import {
  EMPTY_USER_DRAFT,
  hasUserDraftErrors,
  MIN_PASSWORD_LENGTH,
  type UserDraft,
  type UserDraftErrors,
  validateUserDraft,
} from '../../domain/index.js';
import type { AdminUser, UsersAdminClient } from './users-admin-client.js';

/**
 * One form for creating an account and for editing one.
 *
 * The same arrangement `RoleForm` uses in @kwtech/module-permissions, and for
 * the same reason: the two screens differ by three fields and a verb, and two
 * forms drift — the second one grows a rule the first does not have, and which
 * of them is right becomes a question nobody can answer from the code.
 *
 * ## What changes between the modes
 *
 *   creating   asks for the address and a password. The address is a field
 *              exactly once in an account's life.
 *   editing    shows the address, disabled, and asks for neither password nor
 *              confirmation. Credentials are changed by SENDING A RESET, from
 *              the account's own page — an administrator who could type a
 *              password here would hold that person's credential.
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
  onSaved,
  cancelHref,
  onCreated,
}: {
  client: UsersAdminClient;
  /** Absent when creating. Its presence is what puts the form in edit mode. */
  user?: AdminUser;
  /** Called after a successful edit, so the page can refresh what it holds. */
  onSaved?: (user: AdminUser) => void;
  /** Called after a successful create, with the account that now exists. */
  onCreated?: (user: AdminUser) => void;
  cancelHref: string;
}) {
  const editing = user !== undefined;

  const [draft, setDraft] = useState<UserDraft>({
    ...EMPTY_USER_DRAFT,
    email: user?.email ?? '',
    displayName: user?.displayName ?? '',
    username: user?.username ?? '',
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
    const found = validateUserDraft(draft, { creating: !editing });
    setErrors(found);
    if (hasUserDraftErrors(found)) return;

    setSaving(true);
    setFailure(null);
    try {
      if (editing) {
        /*
         * Only CHANGED fields are sent. The mutation reads an absent argument
         * as "leave it alone", so sending both every time would rewrite a
         * username somebody else edited between this page loading and the save.
         */
        const updated = await client.updateProfile(user.id, {
          ...(draft.displayName !== (user.displayName ?? '') ? { displayName: draft.displayName.trim() } : {}),
          ...(draft.username !== (user.username ?? '') ? { username: draft.username.trim() } : {}),
        });
        onSaved?.(updated);
        setSaved(true);
      } else {
        const created = await client.createUser({
          email: draft.email.trim(),
          password: draft.password,
          displayName: draft.displayName.trim() || null,
        });
        onCreated?.(created);
      }
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

      <Field
        label="Email address"
        value={draft.email}
        onChange={(value) => set('email', value)}
        error={errors.email}
        type="email"
        /*
         * DISABLED rather than hidden when editing. The address is what
         * identifies the account, so a form that omitted it would leave an
         * administrator editing a name with no way to confirm whose it is.
         */
        disabled={editing}
        hint={editing ? "An account's address cannot be changed here — it is what identifies it." : undefined}
      />

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

      {editing ? null : (
        <>
          <Field
            label="Temporary password"
            value={draft.password}
            onChange={(value) => set('password', value)}
            error={errors.password}
            type="password"
            autoComplete="new-password"
            hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          />
          <Field
            label="Confirm password"
            value={draft.confirm}
            onChange={(value) => set('confirm', value)}
            error={errors.confirm}
            type="password"
            autoComplete="new-password"
          />
          <p className="mt-3 text-xs text-muted-foreground">
            You will know this password. Send a reset from the account's page afterwards, or ask them to change it.
          </p>
        </>
      )}

      <div className="mt-5 flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Create account'}
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
