'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { RECOVERY_CODE_LENGTH, TOTP_DIGITS } from '../domain/policy.js';
import { type AuthClient, createAuthClient } from './auth-client.js';
import { AuthError, AuthShell, AuthSubmit } from './auth-shell.js';
import { CodeInput } from './code-input.js';
import { useAuthForm } from './use-auth-form.js';
import { cleanCode, groupRecoveryCode, resendSecondsLeft } from './view/code-entry.js';

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
 *
 * A six-digit code (authenticator or email) goes in six boxes and is sent the
 * moment the last digit arrives. A recovery code has its own field, one click
 * away. The switch is only presentation: both send the one `code` the server
 * has always taken, and the server still never says which kind it refused.
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
  const [mode, setMode] = useState<'code' | 'recovery'>('code');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const codeRef = useRef<HTMLInputElement | null>(null);

  const { pending, error, onSubmit } = useAuthForm(async (form) => {
    try {
      await api.verifyMfa({ code: String(form.get('code') ?? '') });
    } catch (cause) {
      /*
       * A wrong six-digit code is cleared and the boxes take focus, so the
       * next attempt is simply typing. Leaving the old digits would make the
       * person delete six characters first. A recovery code is KEPT: it is
       * sixteen characters, and the likely fault is one of them.
       */
      setCode('');
      codeRef.current?.focus();
      throw cause;
    }
    if (onVerified) onVerified();
    else window.location.assign(redirectTo);
  });

  /*
   * "Email me a code" is its own small state rather than a second useAuthForm:
   * it is a button, not a form, and its outcome is a note beside the boxes
   * rather than a replacement for them. The emailed code goes in the same
   * boxes, because the server tries it as an authenticator code and as an
   * emailed one.
   */
  const [emailing, setEmailing] = useState(false);
  const [emailNote, setEmailNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const wait = resendSecondsLeft(sentAt, now);

  // Ticks only while a countdown is showing. Without one, the page does not re-render every second.
  useEffect(() => {
    if (sentAt === null || wait === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [sentAt, wait]);

  async function emailMeACode() {
    if (emailing || wait > 0) return;
    setEmailing(true);
    setEmailNote(null);
    try {
      const result = await api.sendMfaEmailCode();
      if (result.sent) {
        setSentAt(Date.now());
        setNow(Date.now());
        setMode('code');
        setEmailNote({ ok: true, text: 'Check your email and enter the code above. It works for 10 minutes.' });
        codeRef.current?.focus();
      } else {
        setEmailNote({
          ok: false,
          text: "Email codes aren't turned on for your account. Use your authenticator app or a recovery code.",
        });
      }
    } catch (cause) {
      setEmailNote({ ok: false, text: cause instanceof Error ? cause.message : 'Could not send a code.' });
    } finally {
      setEmailing(false);
    }
  }

  const emailLabel = emailing
    ? 'Sending…'
    : wait > 0
      ? `Resend code in ${wait}s`
      : sentAt === null
        ? 'Email me a code'
        : 'Resend code';

  return (
    <AuthShell
      title="Two-step verification"
      description={
        mode === 'code'
          ? `Enter the ${TOTP_DIGITS}-digit code from your authenticator app, or have one emailed to you.`
          : 'Enter one of the recovery codes you saved when you turned on two-step verification.'
      }
      footer={
        <a href={signInHref} className="underline underline-offset-4 hover:text-foreground">
          Start over
        </a>
      }
    >
      <form onSubmit={onSubmit} noValidate>
        <AuthError>{error}</AuthError>

        {mode === 'code' ? (
          <>
            <CodeInput
              name="code"
              label="Verification code"
              value={code}
              onChange={setCode}
              inputRef={codeRef}
              submitOnComplete
              busy={pending}
              // Red until they start again. Once a digit is typed it is a new attempt.
              invalid={Boolean(error) && code.length === 0}
              autoFocus
            />
            <AuthSubmit pending={pending}>Verify</AuthSubmit>
          </>
        ) : (
          <>
            <div className="mb-4">
              <label htmlFor="auth-recovery-code" className="mb-1.5 block text-sm font-medium text-foreground">
                Recovery code
              </label>
              <input
                id="auth-recovery-code"
                name="code"
                // Shown grouped like the saved list; the server strips the hyphens.
                value={groupRecoveryCode(recovery)}
                onChange={(event) => setRecovery(cleanCode(event.target.value, 'recovery'))}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                // biome-ignore lint/a11y/noAutofocus: shown only because the person asked for this field
                autoFocus
                readOnly={pending}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2.5 text-center font-mono text-base tracking-widest text-foreground uppercase outline-none placeholder:text-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                {recovery.length} of {RECOVERY_CODE_LENGTH} characters. Each code works once.
              </p>
            </div>
            <AuthSubmit pending={pending}>Verify</AuthSubmit>
          </>
        )}
      </form>

      {mode === 'code' ? (
        <div className="mt-6 rounded-lg border border-border bg-muted/30 p-4">
          <p className="text-sm font-medium text-foreground">No authenticator app with you?</p>
          <p className="mt-0.5 text-sm text-muted-foreground">We can send a code to your email instead.</p>
          <button
            type="button"
            onClick={() => void emailMeACode()}
            disabled={emailing || wait > 0}
            className="mt-3 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground tabular-nums hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            {emailLabel}
          </button>
          {emailNote ? (
            <p
              role={emailNote.ok ? 'status' : 'alert'}
              className={`mt-2 text-sm ${emailNote.ok ? 'text-muted-foreground' : 'text-destructive'}`}
            >
              {emailNote.text}
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="mt-4 text-center text-sm text-muted-foreground">
        {mode === 'code' ? 'Lost your device? ' : 'Have your phone or email? '}
        <button
          type="button"
          onClick={() => setMode(mode === 'code' ? 'recovery' : 'code')}
          className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
        >
          {mode === 'code' ? 'Use a recovery code' : `Use a ${TOTP_DIGITS}-digit code`}
        </button>
      </p>
    </AuthShell>
  );
}
