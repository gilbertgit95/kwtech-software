'use client';

import { useEffect, useMemo, useState } from 'react';
import { MIN_PASSWORD_LENGTH } from '../../domain/policy.js';
import { type AuthClient, createAuthClient } from '../auth-client.js';
import { AuthField } from '../auth-shell.js';
import { useAuthForm } from '../use-auth-form.js';
import { SettingsButton, SettingsCard, SettingsPage, SettingsResult } from './settings-shell.js';

/**
 * /settings/security — the credential itself, and the sessions holding it.
 *
 * Both actions here sign somebody out, which is the reason they share a page:
 * they are the two things a person reaches for when they think an account has
 * been compromised, and hunting for them in separate places is exactly the wrong
 * experience at that moment.
 */
export function SecurityPage({
  client,
  signInHref = '/auth/signin',
  twoFactorHref = '/settings/two-factor',
}: {
  client?: AuthClient;
  signInHref?: string;
  twoFactorHref?: string;
}) {
  const api = useMemo(() => client ?? createAuthClient(), [client]);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  /*
   * The revocation window, ASKED FOR rather than assumed.
   *
   * It is AUTH_ACCESS_TOKEN_TTL, which a deployment sets. Writing "fifteen
   * minutes" into the copy was the obvious alternative and becomes a lie the
   * first time somebody changes the variable — on the one screen where being
   * precise about it matters most.
   */
  const [windowSeconds, setWindowSeconds] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .graphql<{ session: { accessTokenTtl: number } | null }>('query Session { session { accessTokenTtl } }')
      .then((data) => {
        if (!cancelled) setWindowSeconds(data.session?.accessTokenTtl ?? null);
      })
      // Left null on failure. The prompt then says "a few minutes", which is
      // vague and true, rather than a number that might be wrong.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api]);

  const windowText = describeWindow(windowSeconds);

  const password = useAuthForm(async (form) => {
    const newPassword = String(form.get('newPassword') ?? '');
    if (newPassword !== String(form.get('confirm') ?? '')) {
      // Checked here and nowhere else: whether two boxes match is a property of
      // this form, not of the account, so the server has no opinion on it.
      throw new Error('Those passwords do not match.');
    }
    await api.changePassword({ currentPassword: String(form.get('currentPassword') ?? ''), newPassword });
  });

  const signOutAll = useAuthForm(async () => {
    await api.signOutEverywhere();
    // A full navigation, not a client-side route change: the session cookie is
    // httpOnly, so only the server can see that it is now worthless. A soft
    // navigation would re-render from a cache that still believes otherwise.
    window.location.assign(signInHref);
  });

  return (
    <SettingsPage title="Security" description="Your password, and where you are signed in.">
      <form onSubmit={password.onSubmit} noValidate>
        <SettingsCard
          title="Change password"
          description="You will stay signed in here. Every other device is signed out."
          footer={
            <>
              <SettingsButton pending={password.pending}>Change password</SettingsButton>
              <SettingsResult error={password.error} done={password.done}>
                Password changed. Other devices have been signed out.
              </SettingsResult>
            </>
          }
        >
          {/*
            A hidden username field, and it is not decoration: password managers
            key a saved credential to a username, and a change form without one
            either saves nothing or saves it against the wrong entry. It is
            hidden rather than absent because the value is already known.
          */}
          <input type="hidden" name="username" autoComplete="username" />
          <AuthField label="Current password" name="currentPassword" type="password" autoComplete="current-password" />
          <AuthField
            label="New password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
          />
          <AuthField label="Confirm new password" name="confirm" type="password" autoComplete="new-password" />
          <p className="-mt-2 text-xs text-muted-foreground">At least {MIN_PASSWORD_LENGTH} characters.</p>
        </SettingsCard>
      </form>

      <SettingsCard
        title="Two-step verification"
        description="An authenticator app, as a second step after your password."
        footer={
          <a
            href={twoFactorHref}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            Manage two-step verification
          </a>
        }
      />

      <SettingsCard
        title="Sign out everywhere"
        danger
        description="Ends every session, on every device — including this one. Use this if you think someone else has access."
        footer={
          confirmingSignOut ? null : (
            // Two steps, because this one is not undoable and the button sits on
            // a page people visit to read as much as to act.
            <SettingsButton type="button" danger onClick={() => setConfirmingSignOut(true)}>
              Sign out everywhere
            </SettingsButton>
          )
        }
      >
        {confirmingSignOut ? (
          /*
           * THE PROMPT.
           *
           * Inline rather than a browser `confirm()`: a native dialog cannot say
           * three things, cannot be styled, and is suppressed outright by some
           * browsers after the first one. It also renders BEFORE the action, not
           * after — the point is to set an expectation, so that a device still
           * working in two minutes reads as "as described" rather than "the
           * button did nothing".
           *
           * `role="alertdialog"` so a screen reader announces it as a decision
           * rather than as more page text.
           */
          <form onSubmit={signOutAll.onSubmit}>
            <div
              role="alertdialog"
              aria-labelledby="signout-all-title"
              className="rounded-md border border-destructive/40 bg-destructive/5 p-4"
            >
              <p id="signout-all-title" className="text-sm font-medium text-foreground">
                Sign out of every device?
              </p>
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                <li>
                  Every session ends, <span className="font-medium text-foreground">including this one</span> — you will
                  need to sign in again here.
                </li>
                <li>
                  A device that is already open may keep working for up to{' '}
                  <span className="font-medium text-foreground">{windowText}</span> before it notices.
                </li>
                <li>
                  If you think someone has your password,{' '}
                  <span className="font-medium text-foreground">change it as well</span> — signing out does not stop
                  someone who can sign back in.
                </li>
              </ul>

              <div className="mt-4 flex items-center gap-3">
                <SettingsButton pending={signOutAll.pending} danger>
                  Yes, sign out everywhere
                </SettingsButton>
                <SettingsButton type="button" onClick={() => setConfirmingSignOut(false)}>
                  Cancel
                </SettingsButton>
                <SettingsResult error={signOutAll.error} />
              </div>
            </div>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            {/*
              Stated up front, not hidden behind the click. Revocation bites at
              the next renewal, because access tokens are verified from their
              signature with no database read — the trade that keeps
              authentication off the hot path.
            */}
            Sessions end immediately, but a device that is already open may stay usable for up to {windowText} before it
            notices.
          </p>
        )}
      </SettingsCard>
    </SettingsPage>
  );
}

/**
 * The revocation window as a person would say it.
 *
 * Vague-but-true when the server did not answer, rather than a number that might
 * be wrong: on this screen a confident wrong figure is worse than an imprecise
 * right one.
 */
function describeWindow(seconds: number | null): string {
  if (!seconds || seconds <= 0) return 'a few minutes';
  if (seconds < 90) return `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? 'a minute' : `${minutes} minutes`;
}
