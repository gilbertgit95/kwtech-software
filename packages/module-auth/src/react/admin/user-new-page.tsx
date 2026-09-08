'use client';

import { type FormEvent, useMemo, useState } from 'react';
import { MIN_PASSWORD_LENGTH } from '../../domain/policy.js';
import { AUTH_FEATURE } from '../../features.js';
import { AdminShell } from './admin-shell.js';
import { createUsersAdminClient, type UsersAdminClient } from './users-admin-client.js';

/**
 * Creating an account without an invitation.
 *
 * ## Why this exists when sign-up deliberately does not
 *
 * There is no public registration page, and PLAN §12 open decision 36 says that
 * has to stay a product decision rather than something arrived at by leaving an
 * endpoint exposed. This is the third way an account can come into being — after
 * the seed and an invitation — and it is defensible where an open form is not:
 * it is guarded by `users:create`, app level and privileged, and every use of it
 * has an administrator behind it.
 *
 * ## The password is temporary, and the page says so
 *
 * Whoever types it here knows it. There is no "must change at first sign-in"
 * flag in the schema, and adding a checkbox that nothing enforces would be
 * worse than saying plainly what the situation is: send them a reset, or tell
 * them to change it.
 *
 * The alternative — create the account and immediately email a reset instead of
 * asking for a password — is the better flow and needs the account to exist in
 * a passwordless state, which `createAccount` does not support: it writes the
 * user and the credential in one transaction precisely so no account can exist
 * that cannot sign in.
 */
export function UserNewPage({
  client,
  backHref = '/admin/users',
  detailHref = (userId: string) => `/admin/users/${encodeURIComponent(userId)}`,
}: {
  client?: UsersAdminClient;
  backHref?: string;
  detailHref?: (userId: string) => string;
}) {
  const api = useMemo(() => client ?? createUsersAdminClient(), [client]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const confirm = String(form.get('confirm') ?? '');
    const displayName = String(form.get('displayName') ?? '').trim();

    // Checked here because it is not a rule about the password — it is a check
    // that the typist typed what they meant, and the server has no second field
    // to compare it with.
    if (password !== confirm) {
      setError('Those two passwords are not the same.');
      return;
    }

    setPending(true);
    setError(null);
    try {
      const created = await api.createUser({ email, password, displayName: displayName || null });
      window.location.assign(detailHref(created.id));
    } catch (cause) {
      // The API says whether the address is taken and whether the password is
      // too weak; both are things the person at this form can act on, so the
      // message is passed through rather than replaced with a generic one.
      setError(cause instanceof Error ? cause.message : 'Could not create that account.');
      setPending(false);
    }
  };

  return (
    <AdminShell
      title="New user"
      description="Creates an account directly, without an invitation."
      feature={AUTH_FEATURE.usersCreate}
      layout="prose"
      backTo={{ href: backHref, label: 'Users' }}
    >
      <form onSubmit={(event) => void submit(event)} className="rounded-md border border-border p-4" noValidate>
        {error ? (
          <p className="mb-3 rounded-md bg-[var(--status-danger)] px-3 py-2 text-sm text-[var(--status-danger-foreground)]">
            {error}
          </p>
        ) : null}

        <Field label="Email address" name="email" type="email" autoComplete="off" required />
        <Field label="Display name" name="displayName" autoComplete="off" required={false} />
        <Field
          label="Temporary password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
        <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" required />

        <p className="mt-3 text-xs text-muted-foreground">
          You will know this password. Send a reset from the account's page afterwards, or ask them to change it.
        </p>

        <button
          type="submit"
          disabled={pending}
          className="mt-4 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create account'}
        </button>
      </form>
    </AdminShell>
  );
}

function Field({
  label,
  name,
  type = 'text',
  autoComplete,
  minLength,
  required = true,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
}) {
  return (
    <label className="mt-3 block text-sm first:mt-0">
      <span className="text-muted-foreground">{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        minLength={minLength}
        required={required}
        className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-foreground"
      />
    </label>
  );
}
