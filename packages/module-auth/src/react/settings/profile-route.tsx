'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Viewer } from '../../types.js';
import { type AuthClient, createAuthClient } from '../auth-client.js';
import { ProfilePage } from './profile-page.js';
import { SettingsCard, SettingsPage } from './settings-shell.js';

/**
 * Fetches the viewer, then renders the form.
 *
 * Exists because a `ModuleRoute` component is handed `params` and `searchParams`
 * and nothing else — it cannot be given the viewer the app shell already holds.
 * An app that would rather not pay the extra round trip imports `ProfilePage`
 * directly and passes its own viewer; this is the zero-configuration path, not
 * the only one.
 *
 * The fetch is one GraphQL query through the app's own origin, so it costs the
 * same as the shell's and reuses the same session cookie.
 */
export function ProfileRouteInner({ client }: { client?: AuthClient }) {
  const api = useMemo(() => client ?? createAuthClient(), [client]);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .graphql<{ viewer: Viewer | null }>('query Viewer { viewer { id email username displayName } }')
      .then((data) => {
        if (!cancelled) setViewer(data.viewer);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load your profile.');
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (error) {
    return (
      <SettingsPage title="Profile">
        <SettingsCard title="Could not load your profile">
          <p className="text-sm text-destructive">{error}</p>
        </SettingsCard>
      </SettingsPage>
    );
  }

  // A skeleton rather than a spinner: the page's shape is known, so reserving it
  // stops the layout jumping when the data lands.
  if (!viewer) {
    return (
      <SettingsPage title="Profile" description="How you appear in this application.">
        <SettingsCard title="Your details">
          <div className="h-24 animate-pulse rounded-md bg-muted" />
        </SettingsCard>
      </SettingsPage>
    );
  }

  return <ProfilePage viewer={viewer} client={api} />;
}
