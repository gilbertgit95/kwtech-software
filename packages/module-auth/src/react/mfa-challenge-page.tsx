'use client';

import { useMemo, useState } from 'react';
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

  /*
   * "Email me a code" is its own small state rather than a second useAuthForm:
   * it is a button, not a form, and its outcome is a note beside the field
   * rather than a replacement for it. The code still goes in the one field
   * above — the server tries it as an authenticator code and as an emailed one.
   */
  const [emailing, setEmailing] = useState(false);
  const [emailNote, setEmailNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function emailMeACode() {
    if (emailing) return;
    setEmailing(true);
    setEmailNote(null);
    try {
      const result = await api.sendMfaEmailCode();
      setEmailNote(
        result.sent
          ? { ok: true, text: 'We sent a code to your email. Enter it above — it works for 10 minutes.' }
          : {
              ok: false,
              text: "Email codes aren't turned on for your account. Use your authenticator app or a recovery code.",
            },
      );
    } catch (cause) {
      setEmailNote({ ok: false, text: cause instanceof Error ? cause.message : 'Could not send a code.' });
    } finally {
      setEmailing(false);
    }
  }

  return (
    <AuthShell
      title="Two-step verification"
      description={`Enter the ${TOTP_DIGITS}-digit code from your authenticator app, or have one emailed to you.`}
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
      <button
        type="button"
        onClick={() => void emailMeACode()}
        disabled={emailing}
        className="mt-3 w-full rounded-md border border-input px-3 py-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        {emailing ? 'Sending…' : 'Email me a code'}
      </button>
      {emailNote ? (
        <p
          role={emailNote.ok ? 'status' : 'alert'}
          className={`mt-2 text-sm ${emailNote.ok ? 'text-muted-foreground' : 'text-destructive'}`}
        >
          {emailNote.text}
        </p>
      ) : null}
      <p className="mt-4 text-sm text-muted-foreground">
        Lost your device? Enter one of your recovery codes instead — each one works once.
      </p>
    </AuthShell>
  );
}
