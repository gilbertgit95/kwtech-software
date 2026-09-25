'use client';

import { useEffect, useMemo, useState } from 'react';
import { MIN_PASSWORD_LENGTH } from '../../domain/policy.js';
import { type AuthClient, createAuthClient } from '../auth-client.js';
import { AuthField } from '../auth-shell.js';
import { useAuthForm } from '../use-auth-form.js';
import { type SecurityView, summariseSecurity } from '../view/security-view.js';
import { SettingsIcon, type SettingsIconName } from './icons.js';
import {
  IconTile,
  type IconTone,
  SettingsButton,
  SettingsCard,
  SettingsLinkButton,
  SettingsPage,
  SettingsResult,
} from './settings-shell.js';
import { TwoFactorSettings, useMfaFactors } from './two-factor-settings.js';

/**
 * /settings/security — the credential itself, the second step guarding it, and
 * the sessions holding it.
 *
 * It opens with a SUMMARY — how protected is this account — because that is the
 * question most people arrive with, and it used to be answered nowhere: the page
 * said "Manage two-step verification" without saying whether it was on.
 *
 * Changing the password and signing out everywhere share the page for the old
 * reason: they are the two things a person reaches for when they think an
 * account has been compromised, and hunting for them in separate places is
 * exactly the wrong experience at that moment.
 */
export function SecurityPage({
  client,
  signInHref = '/auth/signin',
  renderQr,
  /*
   * The app's home, because this page has no parent inside the module: Profile
   * and Security are PEERS reached from the account menu, not children of one
   * another. Naming the home is the honest answer to "how do I leave" — the
   * alternative, a bare browser-history Back, lands somewhere different for
   * every reader and cannot be labelled.
   */
  backTo = { href: '/', label: 'Dashboard' },
}: {
  client?: AuthClient;
  signInHref?: string;
  /** Replaces the default QR code in two-step set-up. See `TwoFactorSettingsProps.renderQr`. */
  renderQr?: (uri: string) => React.ReactNode;
  /**
   * Where the Back link points. Overridable because a consuming app may mount
   * these pages under a different prefix.
   */
  backTo?: { href: string; label: string };
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

  // One load for the summary and the two-step card, so they cannot disagree.
  const mfa = useMfaFactors(api);
  const view = summariseSecurity(mfa.factors);

  /*
   * The password form is folded away until asked for. Three empty password
   * boxes are the loudest thing on a page most people open to CHECK something,
   * and they pushed the answer — is two-step on? — below the fold.
   */
  const [changingPassword, setChangingPassword] = useState(false);

  const password = useAuthForm(async (form) => {
    const newPassword = String(form.get('newPassword') ?? '');
    if (newPassword !== String(form.get('confirm') ?? '')) {
      // Checked here and nowhere else: whether two boxes match is a property of
      // this form, not of the account, so the server has no opinion on it.
      throw new Error('Those passwords do not match.');
    }
    await api.changePassword({ currentPassword: String(form.get('currentPassword') ?? ''), newPassword });
    setChangingPassword(false);
  });

  const signOutAll = useAuthForm(async () => {
    await api.signOutEverywhere();
    // A full navigation, not a client-side route change: the session cookie is
    // httpOnly, so only the server can see that it is now worthless. A soft
    // navigation would re-render from a cache that still believes otherwise.
    window.location.assign(signInHref);
  });

  return (
    <SettingsPage
      title="Security"
      description="How you sign in, the extra step that protects it, and where you are signed in."
      backTo={backTo}
    >
      <SecurityOverview view={view} error={mfa.error} />

      {/*
        Inline, not behind a "Manage" link to a page of its own: whether
        two-step is on, and turning it on, are the reasons most people open
        this page.
      */}
      <TwoFactorSettings
        api={api}
        factors={mfa.factors}
        loadError={mfa.error}
        reload={mfa.reload}
        renderQr={renderQr}
      />

      <SettingsCard
        icon="key"
        title="Password"
        description="Used every time you sign in. Changing it signs out every other device."
        footer={
          changingPassword ? null : (
            <>
              <SettingsButton type="button" secondary onClick={() => setChangingPassword(true)}>
                Change password
              </SettingsButton>
              <SettingsResult done={password.done}>
                Password changed. Other devices have been signed out.
              </SettingsResult>
            </>
          )
        }
      >
        {changingPassword ? (
          <form onSubmit={password.onSubmit} noValidate className="rounded-lg border border-border bg-muted/30 p-4">
            {/*
              A hidden username field, and it is not decoration: password managers
              key a saved credential to a username, and a change form without one
              either saves nothing or saves it against the wrong entry. It is
              hidden rather than absent because the value is already known.
            */}
            <input type="hidden" name="username" autoComplete="username" />
            <AuthField
              label="Current password"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
            />
            <AuthField
              label="New password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
            />
            <AuthField label="Confirm new password" name="confirm" type="password" autoComplete="new-password" />
            <p className="-mt-2 text-xs text-muted-foreground">
              At least {MIN_PASSWORD_LENGTH} characters. You will stay signed in here.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <SettingsButton pending={password.pending}>Change password</SettingsButton>
              <SettingsButton type="button" secondary onClick={() => setChangingPassword(false)}>
                Cancel
              </SettingsButton>
              <SettingsResult error={password.error} />
            </div>
          </form>
        ) : null}
      </SettingsCard>

      <SettingsCard
        icon="log-out"
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
              className="rounded-lg border border-destructive/40 bg-destructive/5 p-4"
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

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <SettingsButton pending={signOutAll.pending} danger>
                  Yes, sign out everywhere
                </SettingsButton>
                <SettingsButton type="button" secondary onClick={() => setConfirmingSignOut(false)}>
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
 * The answer at the top of the page: how protected is this account, and the one
 * thing to do about it if the answer is "not very".
 *
 * A summary rather than another card, because it is the question most visitors
 * came with — and the cards below are where they act on it.
 */
function SecurityOverview({ view, error }: { view: SecurityView; error: string | null }) {
  const tone = OVERVIEW_TONE[view.level];
  return (
    <section
      aria-labelledby="security-overview-title"
      aria-live="polite"
      className={`rounded-xl border p-5 shadow-sm sm:p-6 ${tone.frame}`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <IconTile name={tone.icon} tone={tone.tile} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 id="security-overview-title" className="text-lg font-semibold text-foreground">
            {error ? 'We could not check your two-step verification' : view.headline}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{error ?? view.detail}</p>

          <ul className="mt-4 flex flex-wrap gap-2">
            {view.checks.map((check) => (
              <li key={check.key}>
                <CheckChip label={check.label} met={check.met} />
              </li>
            ))}
          </ul>

          {view.level === 'basic' ? (
            <div className="mt-5">
              {/* An in-page anchor: the card that does it is just below. */}
              <SettingsLinkButton href="#two-factor">
                Turn on two-step verification
                <SettingsIcon name="chevron-right" />
              </SettingsLinkButton>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

const OVERVIEW_TONE: Record<SecurityView['level'], { frame: string; icon: SettingsIconName; tile: IconTone }> = {
  unknown: { frame: 'border-border bg-card', icon: 'shield', tile: 'neutral' },
  basic: { frame: 'border-status-warning/40 bg-status-warning/5', icon: 'shield-alert', tile: 'warning' },
  good: { frame: 'border-status-success/30 bg-status-success/5', icon: 'shield-check', tile: 'success' },
  strong: { frame: 'border-status-success/40 bg-status-success/5', icon: 'shield-check', tile: 'success' },
};

/**
 * One layer of protection, ticked or not. The word "on"/"off" is in the
 * accessible name, so the state is not carried by the icon's colour alone.
 */
function CheckChip({ label, met }: { label: string; met: boolean | null }) {
  if (met === null) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
        {label}
        <span className="sr-only">: checking</span>
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
        met
          ? 'border-status-success/30 bg-background text-foreground'
          : 'border-status-warning/40 bg-background text-foreground'
      }`}
    >
      <span className={met ? 'text-status-success' : 'text-status-warning'}>
        <SettingsIcon name={met ? 'check' : 'x'} className="size-3.5" />
      </span>
      {label}
      <span className="sr-only">{met ? ': on' : ': off'}</span>
    </span>
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
