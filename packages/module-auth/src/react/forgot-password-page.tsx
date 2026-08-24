'use client';

import { useMemo } from 'react';
import { type AuthClient, createAuthClient } from './auth-client.js';
import { AuthError, AuthField, AuthShell, AuthSubmit } from './auth-shell.js';
import { useAuthForm } from './use-auth-form.js';

/**
 * /auth/forgot-password
 *
 * The copy here is load-bearing. "If that address has an account, we've sent a
 * link" is shown whether or not the account exists, because the server answers
 * identically either way — a page that said "no account with that email" would
 * be an account-enumeration oracle that needs no password guessing at all, and
 * it is the version most often shipped because it reads as helpful.
 */
export function ForgotPasswordPage({
  client,
  signInHref = '/auth/signin',
}: {
  client?: AuthClient;
  signInHref?: string;
}) {
  const api = useMemo(() => client ?? createAuthClient(), [client]);

  const { pending, error, done, onSubmit } = useAuthForm(async (form) => {
    await api.requestPasswordReset({ email: String(form.get('email') ?? '') });
  });

  if (done) {
    return (
      <AuthShell
        title="Check your email"
        description="If that address has an account, a reset link is on its way. The link expires in an hour."
        footer={
          <a href={signInHref} className="underline underline-offset-4 hover:text-foreground">
            Back to sign in
          </a>
        }
      >
        {null}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      description="We'll email you a link to choose a new one."
      footer={
        <a href={signInHref} className="underline underline-offset-4 hover:text-foreground">
          Back to sign in
        </a>
      }
    >
      <form onSubmit={onSubmit} noValidate>
        <AuthError>{error}</AuthError>
        <AuthField label="Email" name="email" type="email" autoComplete="username" />
        <AuthSubmit pending={pending}>Send reset link</AuthSubmit>
      </form>
    </AuthShell>
  );
}
