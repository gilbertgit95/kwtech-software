'use client';

import { useMemo } from 'react';
import { MIN_PASSWORD_LENGTH } from '../domain/policy.js';
import { type AuthClient, createAuthClient } from './auth-client.js';
import { AuthError, AuthField, AuthShell, AuthSubmit } from './auth-shell.js';
import { useAuthForm } from './use-auth-form.js';

/**
 * /auth/reset-password?token=…
 *
 * The token arrives in the query string and is submitted as a hidden field. The
 * app reads it from the URL and passes it in, rather than this component
 * reaching for `useSearchParams` — a package component that assumed Next's
 * router would not render anywhere else, and this one is also the easiest page
 * to test in isolation.
 *
 * `minLength` mirrors domain/policy.ts so the browser catches a short password
 * before a round trip. The SERVER is still the authority: this is a courtesy,
 * and `checkPassword` runs again on the way in.
 */
export function ResetPasswordPage({
  token,
  client,
  signInHref = '/auth/signin',
  forgotPasswordHref = '/auth/forgot-password',
}: {
  token: string | null;
  client?: AuthClient;
  signInHref?: string;
  forgotPasswordHref?: string;
}) {
  const api = useMemo(() => client ?? createAuthClient(), [client]);

  const { pending, error, done, onSubmit } = useAuthForm(async (form) => {
    const password = String(form.get('password') ?? '');
    if (password !== String(form.get('confirm') ?? '')) {
      // Checked here and nowhere else: whether two boxes match is a property of
      // this form, not of the account, so the server has no opinion on it.
      throw new Error('Those passwords do not match.');
    }
    await api.resetPassword({ token: String(form.get('token') ?? ''), password });
  });

  // A link with no token is a broken link, not a form to fill in. Rendering the
  // form anyway would fail at submit with a message about the token, which
  // reads as the user's mistake.
  if (!token) {
    return (
      <AuthShell
        title="That link is not valid"
        description="Reset links expire after an hour and can only be used once. Ask for a new one."
        footer={
          <a href={forgotPasswordHref} className="underline underline-offset-4 hover:text-foreground">
            Request a new link
          </a>
        }
      >
        {null}
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell
        title="Password changed"
        description="You've been signed out everywhere else. Sign in with your new password."
        footer={
          <a href={signInHref} className="underline underline-offset-4 hover:text-foreground">
            Go to sign in
          </a>
        }
      >
        {null}
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" description={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
      <form onSubmit={onSubmit} noValidate>
        <AuthError>{error}</AuthError>
        <input type="hidden" name="token" value={token} />
        <AuthField
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
        />
        <AuthField label="Confirm new password" name="confirm" type="password" autoComplete="new-password" />
        <AuthSubmit pending={pending}>Change password</AuthSubmit>
      </form>
    </AuthShell>
  );
}
