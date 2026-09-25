'use client';

import { useMemo } from 'react';
import { type AuthClient, createAuthClient } from '../auth-client.js';
import { SettingsPage } from './settings-shell.js';
import { TwoFactorSettings, useMfaFactors } from './two-factor-settings.js';

/**
 * Two-step verification on a page of its own, for an app that wants it apart
 * from Security.
 *
 * The descriptor no longer routes here: `/settings/two-factor` renders the
 * Security page, which now holds the same `TwoFactorSettings` card inline. It
 * used to be a separate screen reached from a "Manage" button, and the Security
 * page never said whether two-step was ON — the answer people most often came
 * for was one click away from where they looked. Kept exported, because an app
 * may import it directly.
 */
export function TwoFactorPage({
  client,
  renderQr,
  backTo = { href: '/settings/security', label: 'Security' },
}: {
  client?: AuthClient;
  /** See `TwoFactorSettingsProps.renderQr`. */
  renderQr?: (uri: string) => React.ReactNode;
  /**
   * Where the Back link points. Overridable because a consuming app may mount
   * these pages under a different prefix.
   */
  backTo?: { href: string; label: string };
}) {
  const api = useMemo(() => client ?? createAuthClient(), [client]);
  const { factors, error, reload } = useMfaFactors(api);
  return (
    <SettingsPage
      title="Two-step verification"
      description="After your password, a six-digit code from an authenticator app on your phone, or sent to your email."
      backTo={backTo}
    >
      <TwoFactorSettings api={api} factors={factors} loadError={error} reload={reload} renderQr={renderQr} />
    </SettingsPage>
  );
}
