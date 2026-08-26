'use client';

import { useMemo } from 'react';
import { TOTP_DIGITS } from '../domain/policy.js';
import { type AuthClient, createAuthClient } from './auth-client.js';
import { AuthError, AuthField, AuthShell, AuthSubmit } from './auth-shell.js';
import { useAuthForm } from './use-auth-form.js';

/**
 * /auth/verify — the second step of a sign-in.
 *
 * The page holds NOTHING. No user id, no token, no "pending sign-in" object in
 * storage: the half-admitted session is already in an httpOnly cookie, and the
 * route handler attaches it. That is what stops this page from being a way to
 * present a code against an account of the caller's choosing.
 *
 * Arriving here without that cookie is not an error state worth designing for —
 * the API answers 401 and the copy sends the user back to sign in, which is the
 * same thing an expired challenge does.
 */
export function MfaChallengePage({
  client,
  redirectTo = '/',
  onVerified,
  signInHref = '/auth/signin',
}: {
  client?: AuthClient;
  /** A FULL page navigation, for the reason SignInPage documents. */
  redirectTo?: string;
  onVerified?: () => void;
  signInHref?: string;
}) {
  const api = useMemo(() => client ?? createAuthClient(), [client]);

  const { pending, error, onSubmit } = useAuthForm(async (form) => {
    await api.verifyMfa({ code: String(form.get('code') ?? '') });
    if (onVerified) onVerified();
    else window.location.assign(redirectTo);
  });

  return (
    <AuthShell
      title="Two-step verification"
      description={`Enter the ${TOTP_DIGITS}-digit code from your authenticator app.`}
      footer={
        <a href={signInHref} className="underline underline-offset-4 hover:text-foreground">
          Start over
        </a>
      }
    >
      <form onSubmit={onSubmit} noValidate>
        <AuthError>{error}</AuthError>
        {/*
          One field for both a TOTP code and a recovery code, matching the
          server. Two fields would make the user decide which credential they
          are holding, and would tell anyone probing the form which of the two
          they got wrong.

          NOT type="number": it strips leading zeros, which a six-digit code has
          one in ten of the time, and renders spinner arrows on a value nobody
          increments. `inputMode` gets the numeric keypad on a phone without any
          of that — and `autoComplete="one-time-code"` is what lets iOS and
          Android offer the code from the notification.
        */}
        <AuthField label="Verification code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" />
        <AuthSubmit pending={pending}>Verify</AuthSubmit>
      </form>
      <p className="mt-4 text-sm text-muted-foreground">
        Lost your device? Enter one of your recovery codes instead — each one works once.
      </p>
    </AuthShell>
  );
}
