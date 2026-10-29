'use client';

import { useHoldsFeature } from '@kwtech/module-kit/react';
import { SPACING_LABELS, SPACINGS, TEXT_SIZE_LABELS, TEXT_SIZES } from '@kwtech/web-ui';
import { cn } from '@kwtech/web-ui/react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { MAX_USERNAME_LENGTH, MIN_PASSWORD_LENGTH, MIN_USERNAME_LENGTH } from '../domain/policy.js';
import { AUTH_FEATURE } from '../features.js';
import { type AuthClient, createAuthClient } from '../react/auth-client.js';
import { AuthField } from '../react/auth-shell.js';
import { useDisplaySettings } from '../react/settings/use-display-settings.js';
import { useAuthForm } from '../react/use-auth-form.js';
import type { Viewer } from '../types.js';

/**
 * Account settings on the PHONE (issue #22): Profile, Password and Display,
 * opened from the phone layout's account sheet. A phone may never open the
 * full site, so without these somebody could not change their own password
 * from it.
 *
 * The same API, the same rules and the same keys as the full site's settings
 * pages — the profile write is still gated by `account:profile_write`, the
 * password change is still the guessable REST call with the current password
 * — laid out for a phone: one column, large fields (16px, see `AuthField`'s
 * `size`), full-width buttons. No page heading: the frame's panel names it.
 *
 * Display here is the PHONE's sizes (`layout: 'mobile'`), kept apart from the
 * full site's.
 */

/** Your display name and username; the email address, which cannot change here. */
export function ProfileMobilePanel({ viewer, client }: { viewer: Viewer; client?: AuthClient }) {
  const api = useMemo(() => client ?? createAuthClient(), [client]);
  const [current, setCurrent] = useState(viewer);
  useEffect(() => setCurrent(viewer), [viewer]);
  // Write is gated, not the fields: someone without the key still sees who they are.
  const canEdit = useHoldsFeature(AUTH_FEATURE.accountProfileWrite);

  const { pending, error, done, onSubmit } = useAuthForm(async (form) => {
    const displayName = String(form.get('displayName') ?? '');
    const username = String(form.get('username') ?? '');
    // Only what changed, so a username collision cannot refuse a name change nobody made.
    const input: { displayName?: string | null; username?: string } = {};
    if (displayName !== (current.displayName ?? '')) input.displayName = displayName;
    if (username !== (current.username ?? '')) input.username = username;
    if (Object.keys(input).length === 0) return;
    setCurrent(await api.updateProfile(input));
  });

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} noValidate>
        <Card>
          <AuthField
            label="Display name"
            name="displayName"
            autoComplete="name"
            required={false}
            defaultValue={current.displayName ?? ''}
            size="large"
          />
          <AuthField
            label="Username"
            name="username"
            autoComplete="username"
            required={false}
            minLength={MIN_USERNAME_LENGTH}
            defaultValue={current.username ?? ''}
            size="large"
          />
          <p className="-mt-2 text-xs text-muted-foreground">
            {MIN_USERNAME_LENGTH}–{MAX_USERNAME_LENGTH} characters: letters, numbers, dots, hyphens and underscores. You
            can sign in with it or with your email.
          </p>
        </Card>
        <div className="mt-4">
          {canEdit ? (
            <PrimaryButton pending={pending}>Save changes</PrimaryButton>
          ) : (
            <p className="text-sm text-muted-foreground">
              Your profile is managed for you, so it cannot be changed here.
            </p>
          )}
          <Result error={error} done={done ? 'Saved.' : null} />
        </div>
      </form>

      <Card>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email address</p>
        <p className="mt-1 break-all text-[0.9375rem] font-medium text-foreground">{current.email}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          To change it, ask an administrator: a new address has to be confirmed first, so a stolen session cannot
          redirect your password resets.
        </p>
      </Card>
    </div>
  );
}

/** Changing your password. Signs out every other device; this one stays signed in. */
export function PasswordMobilePanel({ client }: { client?: AuthClient }) {
  const api = useMemo(() => client ?? createAuthClient(), [client]);
  const [formKey, setFormKey] = useState(0);

  const { pending, error, done, onSubmit } = useAuthForm(async (form) => {
    const newPassword = String(form.get('newPassword') ?? '');
    // Whether two boxes match is a property of this form, not of the account.
    if (newPassword !== String(form.get('confirm') ?? '')) throw new Error('Those passwords do not match.');
    await api.changePassword({ currentPassword: String(form.get('currentPassword') ?? ''), newPassword });
    // Cleared after a change: three filled password boxes left on a phone's screen are three too many.
    setFormKey((key) => key + 1);
  });

  return (
    <form key={formKey} onSubmit={onSubmit} noValidate className="space-y-4">
      <Card>
        {/* For password managers: they key a saved credential to a username. */}
        <input type="hidden" name="username" autoComplete="username" />
        <AuthField
          label="Current password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          size="large"
        />
        <AuthField
          label="New password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          size="large"
        />
        <AuthField
          label="Confirm new password"
          name="confirm"
          type="password"
          autoComplete="new-password"
          size="large"
        />
        <p className="-mt-2 text-xs text-muted-foreground">
          At least {MIN_PASSWORD_LENGTH} characters. Your other devices will be signed out; this one stays signed in.
        </p>
      </Card>
      <PrimaryButton pending={pending}>Change password</PrimaryButton>
      <Result error={error} done={done ? 'Password changed. Other devices have been signed out.' : null} />
    </form>
  );
}

/** The PHONE's text size and spacing — the full site keeps its own. */
export function DisplayMobilePanel({ client }: { client?: AuthClient }) {
  const { shown, saving, error, status, isDefault, choose } = useDisplaySettings('mobile', {
    client,
    savedMessage: 'Saved. Every phone you sign in on uses these sizes.',
  });

  return (
    <div className="space-y-4">
      <p className="px-1 text-sm text-muted-foreground">
        For this app on phones. The full site on a computer or tablet keeps sizes of its own.
      </p>
      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {shown ? (
        <>
          <Card>
            <ChoiceGroup
              label="Text size"
              hint="Everything grows with the text: buttons, lists and the space between them."
              options={TEXT_SIZES.map((size, index) => ({
                value: size,
                label: TEXT_SIZE_LABELS[size],
                glyph: <span style={{ fontSize: `${0.8 + index * 0.18}rem` }}>A</span>,
              }))}
              value={shown.textSize}
              disabled={saving}
              onChange={(textSize) => void choose({ textSize })}
            />
          </Card>
          <Card>
            <ChoiceGroup
              label="Spacing"
              hint="The room around things, with the text left as it is."
              options={SPACINGS.map((spacing) => ({ value: spacing, label: SPACING_LABELS[spacing] }))}
              value={shown.spacing}
              disabled={saving}
              onChange={(spacing) => void choose({ spacing })}
            />
          </Card>
          <button
            type="button"
            disabled={saving || isDefault}
            onClick={() => void choose({ textSize: 'normal', spacing: 'comfortable' })}
            className="min-h-11 w-full rounded-full bg-muted text-sm font-medium text-foreground active:bg-accent disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Reset to normal
          </button>
          <p role="status" className="min-h-5 text-center text-sm text-muted-foreground">
            {saving ? 'Saving…' : status}
          </p>
        </>
      ) : error ? null : (
        <div className="h-40 animate-pulse rounded-3xl bg-muted" />
      )}
    </div>
  );
}

function ChoiceGroup<T extends string>({
  label,
  hint,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  options: readonly { value: T; label: string; glyph?: ReactNode }[];
  value: T;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="m-0 border-0 p-0" disabled={disabled}>
      <legend className="text-[0.9375rem] font-semibold text-foreground">{label}</legend>
      <p className="mt-0.5 mb-3 text-sm text-muted-foreground">{hint}</p>
      <div className="grid grid-cols-3 gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex min-h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border px-2 py-2 text-sm transition-colors',
              'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
              option.value === value
                ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                : 'border-border bg-card text-foreground active:bg-accent',
            )}
          >
            <input
              type="radio"
              name={label}
              className="sr-only"
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            {option.glyph ? (
              <span aria-hidden="true" className="flex h-7 items-end font-semibold leading-none">
                {option.glyph}
              </span>
            ) : null}
            <span className="font-medium">{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-3xl border border-border/70 bg-card p-4 shadow-sm">{children}</div>;
}

function PrimaryButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-12 w-full rounded-full bg-primary text-[0.9375rem] font-medium text-primary-foreground shadow-sm transition-transform active:scale-[0.99] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {pending ? 'Saving…' : children}
    </button>
  );
}

function Result({ error, done }: { error: string | null; done: string | null }) {
  if (error) {
    return (
      <p role="alert" className="mt-3 rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
        {error}
      </p>
    );
  }
  return done ? (
    <p role="status" className="mt-3 rounded-xl bg-status-success px-3 py-2.5 text-sm text-status-success-foreground">
      {done}
    </p>
  ) : null;
}
