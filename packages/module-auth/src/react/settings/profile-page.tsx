'use client';

import { useHoldsFeature } from '@kwtech/module-kit/react';
import { useEffect, useMemo, useState } from 'react';
import { MAX_USERNAME_LENGTH, MIN_USERNAME_LENGTH } from '../../domain/policy.js';
import { AUTH_FEATURE } from '../../features.js';
import type { Viewer } from '../../types.js';
import { type AuthClient, createAuthClient } from '../auth-client.js';
import { AuthField } from '../auth-shell.js';
import { useAuthForm } from '../use-auth-form.js';
import { SettingsButton, SettingsCard, SettingsPage, SettingsResult } from './settings-shell.js';

/**
 * /settings/profile — the human-facing fields of your own account.
 *
 * NO PASSWORD PROMPT, unlike the security and two-factor pages. Renaming
 * yourself is not a change to how the account is secured, and asking for a
 * password here would train people to type it into any form that asks — which
 * is the habit phishing depends on.
 *
 * Takes `viewer` as a prop rather than fetching it. The app shell already has
 * it, so fetching again would mean a second round trip and a flash of empty
 * inputs; a page that cannot render without a network call is also a page that
 * cannot be tested without one.
 */
export function ProfilePage({ viewer, client }: { viewer: Viewer; client?: AuthClient }) {
  const api = useMemo(() => client ?? createAuthClient(), [client]);
  const [current, setCurrent] = useState(viewer);

  // The prop wins when the server re-renders with a newer viewer — otherwise a
  // full page reload after saving would show the pre-save values again.
  useEffect(() => setCurrent(viewer), [viewer]);

  const canEdit = useHoldsFeature(AUTH_FEATURE.accountProfileWrite);

  const { pending, error, done, onSubmit } = useAuthForm(async (form) => {
    const displayName = String(form.get('displayName') ?? '');
    const username = String(form.get('username') ?? '');

    // Only what actually changed. Sending every field would make "I edited my
    // name" also re-submit a username, and a username collision would then
    // reject a change the person did not make.
    const input: { displayName?: string | null; username?: string } = {};
    if (displayName !== (current.displayName ?? '')) input.displayName = displayName;
    if (username !== (current.username ?? '')) input.username = username;

    if (Object.keys(input).length === 0) return;
    setCurrent(await api.updateProfile(input));
  });

  return (
    <SettingsPage title="Profile" description="How you appear in this application.">
      <form onSubmit={onSubmit} noValidate>
        <SettingsCard
          title="Your details"
          description="Your display name is shown in the header and in the account menu."
          footer={
            <>
              {/*
                WRITE is gated, not the page or the fields. Someone without the
                key still sees who they are — hiding that would make the app look
                broken rather than the permission look absent — and the note
                below says why the button is gone, so it reads as a policy rather
                than a bug.

                Not the security boundary: `Mutation.updateProfile` carries the
                same key as a registry binding, so the control and the mutation
                cannot disagree.
              */}
              {canEdit ? (
                <SettingsButton pending={pending}>Save changes</SettingsButton>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Your profile is managed for you, so it cannot be changed here.
                </p>
              )}
              <SettingsResult error={error} done={done} />
            </>
          }
        >
          <AuthField
            label="Display name"
            name="displayName"
            autoComplete="name"
            required={false}
            defaultValue={current.displayName ?? ''}
          />
          <AuthField
            label="Username"
            name="username"
            autoComplete="username"
            required={false}
            minLength={MIN_USERNAME_LENGTH}
            defaultValue={current.username ?? ''}
          />
          <p className="-mt-2 text-xs text-muted-foreground">
            {MIN_USERNAME_LENGTH}–{MAX_USERNAME_LENGTH} characters. Letters, numbers, dots, hyphens and underscores — no
            “@”. You can sign in with either your username or your email.
          </p>
        </SettingsCard>
      </form>

      <SettingsCard title="Email address" description="Changing this is not available yet.">
        <p className="text-sm text-muted-foreground">
          {/*
            Stated plainly rather than shown as a disabled input. A greyed-out
            field invites people to keep clicking it; a sentence explains why.

            The reason it is missing is real: the address a password reset is
            delivered to cannot change before the NEW address is proved, or
            anyone holding a session could change it, request a reset and take
            the account. That needs a confirmation flow, not a field.
          */}
          <span className="font-medium text-foreground">{current.email}</span> — to change it, ask an administrator. A
          self-service change has to confirm the new address before it takes effect, so that a stolen session cannot be
          used to redirect your password resets.
        </p>
      </SettingsCard>
    </SettingsPage>
  );
}
