'use client';

import { useHoldsFeature } from '@kwtech/module-kit/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { TOTP_DIGITS } from '../../domain/policy.js';
import { AUTH_FEATURE } from '../../features.js';
import type { MfaEnrolment, MfaFactorSummary } from '../../types.js';
import { type AuthClient, createAuthClient } from '../auth-client.js';
import { AuthField } from '../auth-shell.js';
import { useAuthForm } from '../use-auth-form.js';
import { SettingsButton, SettingsCard, SettingsPage, SettingsResult } from './settings-shell.js';

/**
 * /settings/two-factor — enrol, confirm, and revoke a second factor.
 *
 * ## The three states this page has
 *
 *   none        no confirmed factor. Offer enrolment.
 *   enrolling   a secret has been issued and is on screen ONCE. Offer the code.
 *   enrolled    a confirmed factor exists. Offer removal and fresh codes.
 *
 * They are one component rather than three routes because the middle one cannot
 * be navigated back to: the secret is encrypted the moment it is stored and no
 * endpoint can return it again. A URL that looked resumable and was not would be
 * worse than no URL at all.
 *
 * ## What this page deliberately does not do
 *
 * It does not render a QR code. The module returns the `otpauth://` URI and
 * stops there — drawing it needs a rendering library, and a package that picked
 * one would decide it for every consuming app. `renderQr` is the seam: an app
 * passes a function, and until it does, the page shows the key to type by hand,
 * which every authenticator accepts.
 */
export function TwoFactorPage({
  client,
  renderQr,
  /*
   * A REAL parent, unlike the two pages beside it: this screen is unlisted in
   * the navigation and reached only from Security, so "back" has one true
   * answer and naming it costs the reader nothing to verify.
   */
  backTo = { href: '/settings/security', label: 'Security' },
}: {
  client?: AuthClient;
  /**
   * Turns an `otpauth://` URI into something to look at. Given one, the page
   * shows it above the manual key.
   *
   * Render it SERVER-side to a data URI where you can — a client-side QR library
   * means the secret is in the browser's JavaScript heap for as long as the tab
   * is open.
   */
  renderQr?: (uri: string) => React.ReactNode;
  /**
   * Where the Back link points. Overridable because a consuming app may mount
   * these pages under a different prefix — the same reason `SecurityPage`
   * takes `twoFactorHref` rather than hard-coding it.
   */
  backTo?: { href: string; label: string };
}) {
  const api = useMemo(() => client ?? createAuthClient(), [client]);

  /*
   * Two keys, never one. Withholding REMOVAL is how a policy makes 2FA
   * mandatory; withholding enrolment would stop someone protecting their own
   * account, which weakens security rather than enforcing it.
   */
  const canEnrol = useHoldsFeature(AUTH_FEATURE.accountTwoFactorEnrol);
  const canRemove = useHoldsFeature(AUTH_FEATURE.accountTwoFactorRemove);

  const [factors, setFactors] = useState<MfaFactorSummary[] | null>(null);
  const [enrolment, setEnrolment] = useState<MfaEnrolment | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setFactors(await api.listMfaFactors());
    } catch (error) {
      // Rendering "you have no second factor" because a fetch failed would be a
      // lie in the dangerous direction — it invites someone to enrol a second
      // one, or to believe they are unprotected when they are not.
      setLoadError(error instanceof Error ? error.message : 'Could not load your second factors.');
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const confirmed = (factors ?? []).filter((factor) => factor.confirmedAt !== null);

  const enrol = useAuthForm(async (form) => {
    setEnrolment(
      await api.enrolMfa({
        password: String(form.get('password') ?? ''),
        label: String(form.get('label') ?? ''),
      }),
    );
  });

  const confirm = useAuthForm(async (form) => {
    if (!enrolment) throw new Error('Start again — that enrolment has expired.');
    const result = await api.confirmMfa({ factorId: enrolment.factorId, code: String(form.get('code') ?? '') });
    setCodes(result.codes);
    // The secret must leave the page the instant it is no longer needed.
    setEnrolment(null);
    await reload();
  });

  const remove = useAuthForm(async (form) => {
    await api.removeMfaFactor({
      factorId: String(form.get('factorId') ?? ''),
      password: String(form.get('password') ?? ''),
    });
    setCodes(null);
    await reload();
  });

  const regenerate = useAuthForm(async (form) => {
    const result = await api.regenerateRecoveryCodes({ password: String(form.get('password') ?? '') });
    setCodes(result.codes);
  });

  return (
    <SettingsPage
      title="Two-step verification"
      description="After your password, a six-digit code from an authenticator app on your phone."
      backTo={backTo}
    >
      {loadError ? <SettingsResult error={loadError} /> : null}

      {/* ── the codes, shown once ─────────────────────────────────────────── */}
      {codes ? (
        <SettingsCard
          title="Save your recovery codes"
          description="Each code works once. Keep them somewhere you can reach without your phone."
          footer={
            <SettingsButton type="button" onClick={() => setCodes(null)}>
              I've saved them
            </SettingsButton>
          }
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border border-border bg-muted/40 p-4 font-mono text-sm text-foreground">
            {codes.map((code) => (
              <span key={code}>{code}</span>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {/*
              Said explicitly because it is not recoverable. The stored values are
              hashes, so there is no endpoint that could show these again — only
              one that replaces the set.
            */}
            This is the only time these are shown. Generating a new set replaces them.
          </p>
        </SettingsCard>
      ) : null}

      {/* ── mid-enrolment ─────────────────────────────────────────────────── */}
      {enrolment ? (
        <form onSubmit={confirm.onSubmit} noValidate>
          <SettingsCard
            title="Scan this, then enter the code"
            description="Open your authenticator app, add an account, and enter the code it shows."
            footer={
              <>
                <SettingsButton pending={confirm.pending}>Turn on two-step verification</SettingsButton>
                <SettingsButton type="button" onClick={() => setEnrolment(null)}>
                  Cancel
                </SettingsButton>
                <SettingsResult error={confirm.error} />
              </>
            }
          >
            {renderQr ? <div className="mb-4">{renderQr(enrolment.uri)}</div> : null}
            <p className="mb-1 text-sm text-muted-foreground">
              {renderQr ? "Can't scan it? Enter this key by hand:" : 'Enter this key in your authenticator app:'}
            </p>
            <p className="mb-4 break-all rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm text-foreground">
              {enrolment.secret}
            </p>
            <AuthField
              label={`${TOTP_DIGITS}-digit code`}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
            />
            <p className="-mt-2 text-xs text-muted-foreground">
              {/*
                The reason this step exists at all — worth telling the user, so
                that "why am I typing a code to set up typing codes" has an
                answer.
              */}
              This proves the app is set up correctly. Without it, a mis-scanned code would lock you out with a factor
              you could never satisfy.
            </p>
          </SettingsCard>
        </form>
      ) : null}

      {/* ── enrolled ──────────────────────────────────────────────────────── */}
      {!enrolment && confirmed.length > 0 ? (
        <>
          <SettingsCard title="Your authenticators" description="Two-step verification is on for your account.">
            <ul className="flex flex-col gap-2">
              {confirmed.map((factor) => (
                <li key={factor.id} className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="font-medium text-foreground">{factor.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {factor.lastUsedAt
                      ? `last used ${new Date(factor.lastUsedAt).toLocaleDateString()}`
                      : 'not used yet'}
                  </span>
                </li>
              ))}
            </ul>
          </SettingsCard>

          <form onSubmit={regenerate.onSubmit} noValidate>
            <SettingsCard
              title="Recovery codes"
              description="Ten single-use codes for when you don't have your phone. Generating a new set invalidates the old one."
              footer={
                <>
                  <SettingsButton pending={regenerate.pending}>Generate new codes</SettingsButton>
                  <SettingsResult error={regenerate.error} />
                </>
              }
            >
              <AuthField
                label="Confirm your password"
                name="password"
                type="password"
                autoComplete="current-password"
              />
            </SettingsCard>
          </form>

          {/*
            The whole card, not just its button. Its only action is removal, so
            without the key it is furniture — and a section headed "Turn off
            two-step verification" that cannot turn anything off reads as broken
            rather than as policy.

            This is the direction that matters: a policy requiring 2FA withholds
            REMOVAL. Withholding enrolment would stop someone protecting their
            own account, which is why they are separate keys.
          */}
          {canRemove ? (
            <form onSubmit={remove.onSubmit} noValidate>
              <SettingsCard
                title="Turn off two-step verification"
                danger
                description="Your account will be protected by your password alone."
                footer={
                  <>
                    <SettingsButton pending={remove.pending} danger>
                      Remove
                    </SettingsButton>
                    <SettingsResult error={remove.error} />
                  </>
                }
              >
                {/*
                The password is required by the server, not just asked for here.
                Removing the second factor is the first thing an attacker on a
                stolen session would do.
              */}
                <input type="hidden" name="factorId" value={confirmed[0]?.id ?? ''} />
                <AuthField
                  label="Confirm your password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                />
              </SettingsCard>
            </form>
          ) : null}
        </>
      ) : null}

      {/* ── not enrolled ──────────────────────────────────────────────────── */}
      {/*
        `canEnrol` gates the setup card. Someone without it sees the page and
        whatever they already have, but cannot add a factor — which is the
        unusual direction and should be rare: the ordinary restrictive policy
        withholds REMOVAL instead. Both endpoints behind this carry the same key
        as registry bindings, so hiding the card and refusing the request agree.
      */}
      {canEnrol && !enrolment && factors !== null && confirmed.length === 0 ? (
        <form onSubmit={enrol.onSubmit} noValidate>
          <SettingsCard
            title="Set up two-step verification"
            description="You'll need an authenticator app — 1Password, Google Authenticator, Microsoft Authenticator, or any other."
            footer={
              <>
                <SettingsButton pending={enrol.pending}>Continue</SettingsButton>
                <SettingsResult error={enrol.error} />
              </>
            }
          >
            <AuthField label="Name this device" name="label" defaultValue="My phone" />
            <AuthField label="Confirm your password" name="password" type="password" autoComplete="current-password" />
            <p className="-mt-2 text-xs text-muted-foreground">
              Your password is required so that someone who has taken over your signed-in browser cannot add an
              authenticator you don't control.
            </p>
          </SettingsCard>
        </form>
      ) : null}
    </SettingsPage>
  );
}
