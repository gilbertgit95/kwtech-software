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
  redirectTo = '/',
  forgotPasswordHref = '/auth/forgot-password',
}: {
  client?: AuthClient;
  /**
   * Where to go once it works.
   *
   * A FULL page navigation, not a client-side route change, and that is the
   * point: the session cookie is httpOnly, so only the server can read it. A
   * soft navigation would re-render the new page from a client cache that still
   * believes nobody is signed in — the sign-in appears to do nothing, which is
   * exactly the bug this default exists to prevent.
   */
  redirectTo?: string;
  /** Overrides the navigation entirely, for an app that wants its own. */
  onSignedIn?: () => void;
  forgotPasswordHref?: string;
}) {
  const api = useMemo(() => client ?? createAuthClient(), [client]);

  const { pending, error, onSubmit } = useAuthForm(async (form) => {
    await api.signIn({
      identifier: String(form.get('identifier') ?? ''),
      password: String(form.get('password') ?? ''),
    });
    if (onSignedIn) onSignedIn();
    else window.location.assign(redirectTo);
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
