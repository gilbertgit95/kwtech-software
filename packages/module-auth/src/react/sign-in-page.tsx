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
  mfaHref = '/auth/verify',
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
  /**
   * Overrides the navigation entirely, for an app that wants its own.
   *
   * Called ONLY for a finished sign-in. A user who still owes a second factor
   * goes to the challenge instead — handing them to `onSignedIn` would tell the
   * app someone is signed in when the API has not agreed to that yet.
   */
  onSignedIn?: () => void;
  forgotPasswordHref?: string;
  /**
   * Where a half-admitted sign-in continues.
   *
   * `?next=` is carried across so the destination survives the extra step;
   * losing it would land every 2FA user on the home page regardless of what
   * they were trying to reach.
   */
  mfaHref?: string;
}) {
  const api = useMemo(() => client ?? createAuthClient(), [client]);

  const { pending, error, onSubmit } = useAuthForm(async (form) => {
    const result = await api.signIn({
      identifier: String(form.get('identifier') ?? ''),
      password: String(form.get('password') ?? ''),
    });

    // The password was right and a second factor is owed. The session cookie is
    // already set — to a token that may reach the challenge endpoint and
    // nothing else — so this navigation is the whole handover.
    if (result?.mfaRequired) {
      const next = redirectTo === '/' ? '' : `?next=${encodeURIComponent(redirectTo)}`;
      window.location.assign(`${mfaHref}${next}`);
      return;
    }

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
