'use client';

import { useMemo } from 'react';
import { type AuthClient, createAuthClient } from './auth-client.js';
import { AuthError, AuthField, AuthShell, AuthSubmit } from './auth-shell.js';
import { useAuthForm } from './use-auth-form.js';

/**
 * /auth/signin
 *
 * Unguarded, and that is not an omission: PLAN §13 records `/auth/signin` as
 * the canonical example of a route that is not a feature. It carries no key, so
 * neither the navigation filter nor the middleware ever asks about it.
 */
export function SignInPage({
  client,
  onSignedIn,
  forgotPasswordHref = '/auth/forgot-password',
}: {
  client?: AuthClient;
  /** Where to go once it works. The module does not own the app's router. */
  onSignedIn?: () => void;
  forgotPasswordHref?: string;
}) {
  const api = useMemo(() => client ?? createAuthClient(), [client]);

  const { pending, error, onSubmit } = useAuthForm(async (form) => {
    await api.signIn({
      identifier: String(form.get('identifier') ?? ''),
      password: String(form.get('password') ?? ''),
    });
    onSignedIn?.();
  });

  return (
    <AuthShell
      title="Sign in"
      description="Enter your email or username and your password to continue."
      footer={
        <a href={forgotPasswordHref} className="underline underline-offset-4 hover:text-foreground">
          Forgot your password?
        </a>
      }
    >
      <form onSubmit={onSubmit} noValidate>
        <AuthError>{error}</AuthError>
        {/*
          type="text", not type="email": the field accepts a username too, and
          the browser's built-in email validation would reject one before the
          form was ever submitted.
        */}
        <AuthField label="Email or username" name="identifier" type="text" autoComplete="username" />
        <AuthField label="Password" name="password" type="password" autoComplete="current-password" />
        <AuthSubmit pending={pending}>Sign in</AuthSubmit>
      </form>
    </AuthShell>
  );
}
