'use client';

import { useEffect, useMemo, useState } from 'react';
import { type AuthClient, createAuthClient } from './auth-client.js';
import { AuthError, AuthField, AuthShell, AuthSubmit } from './auth-shell.js';
import { useAuthForm } from './use-auth-form.js';

/**
 * What `?error=` on the sign-in page means, in words.
 *
 * Set by the Google callback in `@kwtech/module-auth/next`, which cannot render
 * anything and so redirects here. A code in the URL rather than the sentence
 * itself, so a link someone crafts cannot put arbitrary text on this page.
 *
 * One sentence for every Google failure, like the password path: "no account
 * for that Google account" would tell anyone which addresses have accounts.
 */
const SIGN_IN_ERRORS: Record<string, string> = {
  google:
    "Google sign-in didn't work. It works for accounts that already exist here — if you don't have one, ask for an invitation.",
  google_unavailable: "Google sign-in isn't available right now. Sign in with your password instead.",
};

/** The message for a `?error=` code, or null for none — an unknown code shows nothing rather than guessing. */
export function signInErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return SIGN_IN_ERRORS[code] ?? null;
}

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
  googleHref = '/api/auth/google',
  errorCode,
}: {
  client?: AuthClient;
  /**
   * Where "Continue with Google" goes: the route handler that starts the
   * redirect. A plain link, not a fetch — the browser has to leave for Google.
   */
  googleHref?: string;
  /** `?error=` from the URL, set when a Google sign-in came back refused. */
  errorCode?: string;
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

  /*
   * Asked of the API rather than configured here, so the button and the
   * credentials behind it cannot disagree: the API holds the Google client, and
   * a web app told separately that Google is on would draw a button that fails.
   * Hidden until the answer arrives, and hidden if the question fails — a
   * missing button is a smaller problem than a broken one.
   */
  const [google, setGoogle] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api
      .signInProviders()
      .then((providers) => {
        if (!cancelled) setGoogle(providers.google === true);
      })
      .catch(() => {
        if (!cancelled) setGoogle(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

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
      {google ? (
        <>
          <a
            href={`${googleHref}${redirectTo === '/' ? '' : `?next=${encodeURIComponent(redirectTo)}`}`}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-input px-3 py-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <GoogleMark />
            Continue with Google
          </a>
          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      ) : null}
      <form onSubmit={onSubmit} noValidate>
        {/* A failed submit replaces the arrival error: the newer answer is the one that matters. */}
        <AuthError>{error ?? signInErrorMessage(errorCode)}</AuthError>
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

/**
 * Google's "G", in its own colours.
 *
 * The one place raw colours appear in this module, and deliberately: Google's
 * brand guidelines require the mark unaltered, and a theme-tinted G reads as a
 * counterfeit button — which is precisely what a phishing page would draw.
 */
function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-4">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}
