'use client';

import { useHoldsFeature } from '@kwtech/module-kit/react';
import { QrCode } from '@kwtech/web-ui/react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { TOTP_DIGITS } from '../../domain/policy.js';
import { AUTH_FEATURE } from '../../features.js';
import type { MfaEmailEnrolment, MfaEnrolment, MfaFactorSummary } from '../../types.js';
import type { AuthClient } from '../auth-client.js';
import { AuthField } from '../auth-shell.js';
import { useAuthForm } from '../use-auth-form.js';
import { factorName, factorUsage, type SecurityLevel, summariseSecurity } from '../view/security-view.js';
import { SettingsIcon, type SettingsIconName } from './icons.js';
import { IconTile, SettingsButton, SettingsCard, SettingsResult, StatusBadge } from './settings-shell.js';

/**
 * The confirmed-and-unconfirmed factor list, loaded once and reloadable.
 *
 * Its own hook because two things read it: the Security page's summary at the
 * top, and the two-step card below it. One load for both is what keeps them from
 * disagreeing — a summary saying "off" above a card listing an authenticator.
 */
export function useMfaFactors(api: AuthClient) {
  const [factors, setFactors] = useState<MfaFactorSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setFactors(await api.listMfaFactors());
      setError(null);
    } catch (cause) {
      // Rendering "you have no second factor" because a fetch failed would be a
      // lie in the dangerous direction — it invites someone to enrol a second
      // one, or to believe they are unprotected when they are not. `factors`
      // stays as it was, which is null on the first load.
      setError(cause instanceof Error ? cause.message : 'Could not load your two-step verification.');
    }
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    api
      .listMfaFactors()
      .then((list) => {
        if (!cancelled) setFactors(list);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Could not load your two-step verification.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return { factors, error, reload };
}

/**
 * Which inline panel is open under the method list. One at a time, and not only
 * for tidiness: every panel has a field named `password`, and AuthField derives
 * its id from the name — two open at once would be two inputs with one id.
 */
type OpenPanel =
  | { kind: 'setup_totp' }
  | { kind: 'setup_email' }
  | { kind: 'remove'; factor: MfaFactorSummary }
  | { kind: 'regenerate' }
  | null;

export interface TwoFactorSettingsProps {
  api: AuthClient;
  /** From `useMfaFactors`: `null` while loading or when the first load failed. */
  factors: MfaFactorSummary[] | null;
  loadError: string | null;
  reload: () => Promise<void>;
  /**
   * Replaces the default QR code — `QrCode` from `@kwtech/web-ui` — with the
   * app's own drawing of the `otpauth://` URI.
   *
   * Drawing it in the browser adds no exposure: the page already holds the
   * secret, because it shows it as text for manual entry.
   */
  renderQr?: ((uri: string) => ReactNode) | undefined;
}

/**
 * Two-step verification, whole: its state, each method with its own action, and
 * the enrolment and recovery-code steps — as ONE card, so it sits inside the
 * Security page rather than on a page of its own.
 *
 * ## The states
 *
 *   none        no confirmed factor. Each method offers "Set up".
 *   enrolling   a secret has been issued and is on screen ONCE, or a code has
 *               been emailed. The card shows only that step.
 *   enrolled    a confirmed factor exists. Each offers "Remove", the kind not
 *               yet enrolled offers "Set up", and recovery codes can be replaced.
 *
 * Enrolment is component state rather than a route because it cannot be
 * navigated back to: the secret is encrypted the moment it is stored and no
 * endpoint can return it again. A URL that looked resumable and was not would be
 * worse than no URL at all.
 */
export function TwoFactorSettings({ api, factors, loadError, reload, renderQr }: TwoFactorSettingsProps) {
  const drawQr =
    renderQr ??
    ((uri: string) => <QrCode value={uri} label="QR code that adds this account to your authenticator app" />);

  /*
   * Two keys, never one. Withholding REMOVAL is how a policy makes 2FA
   * mandatory; withholding enrolment would stop someone protecting their own
   * account, which weakens security rather than enforcing it. Both endpoints
   * carry the same keys as registry bindings, so hiding a control and refusing
   * the request agree.
   */
  const canEnrol = useHoldsFeature(AUTH_FEATURE.accountTwoFactorEnrol);
  const canRemove = useHoldsFeature(AUTH_FEATURE.accountTwoFactorRemove);

  const [open, setOpen] = useState<OpenPanel>(null);
  const [enrolment, setEnrolment] = useState<MfaEnrolment | null>(null);
  const [emailEnrolment, setEmailEnrolment] = useState<MfaEmailEnrolment | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  const view = summariseSecurity(factors);
  const hasTotp = view.factors.some((factor) => factor.type === 'totp');
  const hasEmail = view.factors.some((factor) => factor.type === 'email');

  const enrol = useAuthForm(async (form) => {
    setEnrolment(
      await api.enrolMfa({ password: String(form.get('password') ?? ''), label: String(form.get('label') ?? '') }),
    );
    setOpen(null);
  });

  const enrolEmail = useAuthForm(async (form) => {
    setEmailEnrolment(await api.enrolEmailMfa({ password: String(form.get('password') ?? '') }));
    setOpen(null);
  });

  const confirm = useAuthForm(async (form) => {
    const pending = enrolment ?? emailEnrolment;
    if (!pending) throw new Error('Start again — that set-up has expired.');
    const result = await api.confirmMfa({ factorId: pending.factorId, code: String(form.get('code') ?? '') });
    setCodes(result.codes);
    // The secret must leave the page the instant it is no longer needed.
    setEnrolment(null);
    setEmailEnrolment(null);
    await reload();
  });

  const remove = useAuthForm(async (form) => {
    await api.removeMfaFactor({
      factorId: String(form.get('factorId') ?? ''),
      password: String(form.get('password') ?? ''),
    });
    setOpen(null);
    setCodes(null);
    await reload();
  });

  const regenerate = useAuthForm(async (form) => {
    const result = await api.regenerateRecoveryCodes({ password: String(form.get('password') ?? '') });
    setCodes(result.codes);
    setOpen(null);
  });

  // A second click on the same action closes its panel, like a disclosure.
  const toggle = (panel: Exclude<OpenPanel, null>) =>
    setOpen((current) => (current && samePanel(current, panel) ? null : panel));

  return (
    // The anchor the summary's "Turn on" links to, offset so a sticky app header
    // does not cover the card's title when the browser scrolls to it.
    <div id="two-factor" className="scroll-mt-24">
      <SettingsCard
        icon="shield-check"
        title="Two-step verification"
        badge={<TwoFactorBadge level={view.level} on={view.twoFactorOn} />}
        description={
          view.twoFactorOn
            ? 'After your password, you also enter a code — so a stolen password is not enough on its own.'
            : 'After your password, also enter a code from your phone or your email. Choose a method below.'
        }
      >
        {loadError ? <SettingsResult error={loadError} /> : null}

        {codes ? <RecoveryCodes codes={codes} onDone={() => setCodes(null)} /> : null}

        {enrolment ? (
          <form onSubmit={confirm.onSubmit} noValidate>
            <StepPanel step="Step 2 of 2" title="Scan the QR code, then enter the code">
              <div className="flex flex-col gap-5 sm:flex-row">
                <div className="shrink-0 self-center rounded-lg border border-border bg-background p-3 sm:self-start">
                  {drawQr(enrolment.uri)}
                </div>
                <div className="min-w-0 flex-1">
                  <ol className="mb-4 flex list-decimal flex-col gap-1 pl-5 text-sm text-muted-foreground">
                    <li>Open your authenticator app and add an account.</li>
                    <li>Scan the QR code with it.</li>
                    <li>Enter the {TOTP_DIGITS}-digit code it shows.</li>
                  </ol>
                  <p className="mb-1 text-xs text-muted-foreground">Can't scan it? Enter this key by hand:</p>
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
                      The reason this step exists at all — worth telling the
                      user, so that "why am I typing a code to set up typing
                      codes" has an answer.
                    */}
                    This proves the app is set up correctly. Without it, a mis-scanned code would lock you out.
                  </p>
                </div>
              </div>
              <PanelActions>
                <SettingsButton pending={confirm.pending}>Turn on</SettingsButton>
                <SettingsButton type="button" secondary onClick={() => setEnrolment(null)}>
                  Cancel
                </SettingsButton>
                <SettingsResult error={confirm.error} />
              </PanelActions>
            </StepPanel>
          </form>
        ) : null}

        {emailEnrolment ? (
          <form onSubmit={confirm.onSubmit} noValidate>
            <StepPanel step="Step 2 of 2" title="Check your email">
              <p className="mb-4 text-sm text-muted-foreground">
                We sent a {TOTP_DIGITS}-digit code to{' '}
                <span className="font-medium text-foreground">{emailEnrolment.sentTo}</span>. It works for 10 minutes.
              </p>
              <AuthField
                label={`${TOTP_DIGITS}-digit code`}
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
              />
              <p className="-mt-2 text-xs text-muted-foreground">
                This proves the code reaches you. Without it, a mistyped or unreachable address would lock you out.
              </p>
              <PanelActions>
                <SettingsButton pending={confirm.pending}>Turn on email codes</SettingsButton>
                <SettingsButton type="button" secondary onClick={() => setEmailEnrolment(null)}>
                  Cancel
                </SettingsButton>
                <SettingsResult error={confirm.error} />
              </PanelActions>
            </StepPanel>
          </form>
        ) : null}

        {/* ── the methods, when nothing is mid-enrolment ────────────────────── */}
        {factors !== null && enrolment === null && emailEnrolment === null ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {view.factors.map((factor) => (
              <MethodRow
                key={factor.id}
                icon={factor.type === 'email' ? 'mail' : 'smartphone'}
                active
                title={factorName(factor)}
                detail={factorUsage(factor)}
                badge={<StatusBadge tone="success">On</StatusBadge>}
                action={
                  canRemove ? (
                    <SettingsButton type="button" secondary onClick={() => toggle({ kind: 'remove', factor })}>
                      Remove
                    </SettingsButton>
                  ) : null
                }
              >
                {open?.kind === 'remove' && open.factor.id === factor.id ? (
                  <form onSubmit={remove.onSubmit} noValidate>
                    <InlinePanel danger>
                      <input type="hidden" name="factorId" value={factor.id} />
                      <p className="mb-3 text-sm text-foreground">
                        {view.factors.length === 1
                          ? 'This turns two-step verification off. Your password alone will protect your account.'
                          : 'Your other method stays on.'}
                      </p>
                      {/*
                        The password is required by the server, not just asked
                        for here. Removing the second factor is the first thing an
                        attacker on a stolen session would do.
                      */}
                      <PasswordField />
                      <PanelActions>
                        <SettingsButton pending={remove.pending} danger>
                          {view.factors.length === 1 ? 'Turn off two-step verification' : 'Remove'}
                        </SettingsButton>
                        <SettingsButton type="button" secondary onClick={() => setOpen(null)}>
                          Cancel
                        </SettingsButton>
                        <SettingsResult error={remove.error} />
                      </PanelActions>
                    </InlinePanel>
                  </form>
                ) : null}
              </MethodRow>
            ))}

            {canEnrol && !hasTotp ? (
              <MethodRow
                icon="smartphone"
                title="Authenticator app"
                detail="Codes from an app such as 1Password, Google Authenticator or Microsoft Authenticator."
                badge={<StatusBadge tone="success">Recommended</StatusBadge>}
                action={
                  <SettingsButton
                    type="button"
                    secondary={open?.kind === 'setup_totp'}
                    onClick={() => toggle({ kind: 'setup_totp' })}
                  >
                    Set up
                  </SettingsButton>
                }
              >
                {open?.kind === 'setup_totp' ? (
                  <form onSubmit={enrol.onSubmit} noValidate>
                    <InlinePanel>
                      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Step 1 of 2
                      </p>
                      <AuthField label="Name this device" name="label" defaultValue="My phone" />
                      <PasswordField />
                      <p className="-mt-2 text-xs text-muted-foreground">
                        Your password is required so that someone who has taken over your signed-in browser cannot add
                        an authenticator you don't control.
                      </p>
                      <PanelActions>
                        <SettingsButton pending={enrol.pending}>Continue</SettingsButton>
                        <SettingsButton type="button" secondary onClick={() => setOpen(null)}>
                          Cancel
                        </SettingsButton>
                        <SettingsResult error={enrol.error} />
                      </PanelActions>
                    </InlinePanel>
                  </form>
                ) : null}
              </MethodRow>
            ) : null}

            {/*
              Email codes, offered beside the authenticator rather than instead of
              it. Weaker — a code is only as safe as the mailbox — and said so,
              because someone choosing between the two deserves to know which is
              which.
            */}
            {canEnrol && !hasEmail ? (
              <MethodRow
                icon="mail"
                title="Email codes"
                detail="No app needed: we email you a code when you sign in. Only as safe as your mailbox."
                action={
                  // Quieter while the authenticator is still on offer beside it:
                  // two equal buttons would present the weaker method as an
                  // equal choice.
                  <SettingsButton
                    type="button"
                    secondary={open?.kind === 'setup_email' || !hasTotp}
                    onClick={() => toggle({ kind: 'setup_email' })}
                  >
                    Set up
                  </SettingsButton>
                }
              >
                {open?.kind === 'setup_email' ? (
                  <form onSubmit={enrolEmail.onSubmit} noValidate>
                    <InlinePanel>
                      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Step 1 of 2
                      </p>
                      <PasswordField />
                      <PanelActions>
                        <SettingsButton pending={enrolEmail.pending}>Send me a code</SettingsButton>
                        <SettingsButton type="button" secondary onClick={() => setOpen(null)}>
                          Cancel
                        </SettingsButton>
                        <SettingsResult error={enrolEmail.error} />
                      </PanelActions>
                    </InlinePanel>
                  </form>
                ) : null}
              </MethodRow>
            ) : null}

            {view.twoFactorOn ? (
              <MethodRow
                icon="life-buoy"
                title="Recovery codes"
                detail="Ten single-use codes for when you cannot get a code. A new set replaces the old one."
                action={
                  <SettingsButton type="button" secondary onClick={() => toggle({ kind: 'regenerate' })}>
                    Generate new codes
                  </SettingsButton>
                }
              >
                {open?.kind === 'regenerate' ? (
                  <form onSubmit={regenerate.onSubmit} noValidate>
                    <InlinePanel>
                      <PasswordField />
                      <PanelActions>
                        <SettingsButton pending={regenerate.pending}>Generate new codes</SettingsButton>
                        <SettingsButton type="button" secondary onClick={() => setOpen(null)}>
                          Cancel
                        </SettingsButton>
                        <SettingsResult error={regenerate.error} />
                      </PanelActions>
                    </InlinePanel>
                  </form>
                ) : null}
              </MethodRow>
            ) : null}
          </ul>
        ) : null}

        {/*
          Said, not left blank: without the enrol key and with nothing enrolled
          the list would be empty, which reads as broken rather than as policy.
        */}
        {factors !== null && !canEnrol && !view.twoFactorOn ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Setting up two-step verification is not available on your account. Ask an administrator if you need it.
          </p>
        ) : null}
        {view.twoFactorOn && !canRemove ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Turning off two-step verification is not available on your account.
          </p>
        ) : null}
      </SettingsCard>
    </div>
  );
}

function samePanel(a: Exclude<OpenPanel, null>, b: Exclude<OpenPanel, null>): boolean {
  if (a.kind === 'remove' && b.kind === 'remove') return a.factor.id === b.factor.id;
  return a.kind === b.kind;
}

function TwoFactorBadge({ level, on }: { level: SecurityLevel; on: boolean }) {
  if (level === 'unknown') return <StatusBadge>Checking…</StatusBadge>;
  if (on) return <StatusBadge tone="success">On</StatusBadge>;
  return <StatusBadge tone="warning">Off</StatusBadge>;
}

/** One method: what it is, whether it is on, its action, and the panel that action opens. */
function MethodRow({
  icon,
  title,
  detail,
  badge,
  action,
  active,
  children,
}: {
  icon: SettingsIconName;
  title: string;
  detail: string;
  badge?: ReactNode;
  action?: ReactNode;
  active?: boolean;
  children?: ReactNode;
}) {
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
        <IconTile name={icon} tone={active ? 'success' : 'neutral'} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground">{title}</p>
            {badge ?? null}
          </div>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </li>
  );
}

function InlinePanel({ danger, children }: { danger?: boolean; children: ReactNode }) {
  return (
    <div
      className={`rounded-lg border p-4 ${danger ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-muted/30'}`}
    >
      {children}
    </div>
  );
}

function StepPanel({ step, title, children }: { step: string; title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 sm:p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{step}</p>
      <h3 className="mb-4 mt-1 text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </div>
  );
}

function PanelActions({ children }: { children: ReactNode }) {
  return <div className="mt-4 flex flex-wrap items-center gap-3">{children}</div>;
}

function PasswordField() {
  return <AuthField label="Confirm your password" name="password" type="password" autoComplete="current-password" />;
}

/**
 * The codes, shown ONCE. Copy and download are here because "write these down"
 * with no way to take them off the screen is how people end up with a
 * screenshot in their camera roll — or nothing at all.
 */
function RecoveryCodes({ codes, onDone }: { codes: readonly string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // The clipboard is refused on an insecure origin or without focus; the
      // codes are still on screen and downloadable, so the button just stays
      // as it was rather than claiming a copy that did not happen.
      setCopied(false);
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([`${text}\n`], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section
      aria-labelledby="recovery-codes-title"
      className="mb-4 rounded-lg border border-status-warning/40 bg-status-warning/5 p-4 sm:p-5"
    >
      <h3 id="recovery-codes-title" className="text-sm font-semibold text-foreground">
        Save your recovery codes
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {/*
          Said explicitly because it is not recoverable. The stored values are
          hashes, so there is no endpoint that could show these again — only one
          that replaces the set.
        */}
        Each code works once, for when you cannot get a code. This is the only time they are shown — keep them somewhere
        you can reach without your phone.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-md border border-border bg-background p-4 font-mono text-sm text-foreground">
        {codes.map((code) => (
          <span key={code}>{code}</span>
        ))}
      </div>
      <PanelActions>
        <SettingsButton type="button" onClick={onDone}>
          I've saved them
        </SettingsButton>
        <SettingsButton type="button" secondary onClick={() => void copy()}>
          <SettingsIcon name={copied ? 'check' : 'copy'} />
          {copied ? 'Copied' : 'Copy'}
        </SettingsButton>
        <SettingsButton type="button" secondary onClick={download}>
          <SettingsIcon name="download" />
          Download
        </SettingsButton>
      </PanelActions>
    </section>
  );
}
