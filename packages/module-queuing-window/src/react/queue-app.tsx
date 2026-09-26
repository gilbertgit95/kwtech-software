'use client';

import type { AppProps } from '@kwtech/module-kit';
import { useState } from 'react';
import { QueueConsolePage } from './pages/queue-console-page.js';
import { QueueSettingsPage } from './pages/queue-settings-page.js';

/**
 * The queue as a SUB-APP on the workspace's Apps page (`queueWebModule`'s
 * `apps`): the console, with its settings opened in place.
 *
 * The same two pages as the full-page routes, handed callbacks instead of
 * links: inside the Apps page, a link to `/queue/settings` would leave the page
 * and close every other app running on it. Which screen is open is this
 * component's own state, so it survives the app being moved to another cell.
 */
export function QueueApp({ organizationId, workspaceId }: AppProps) {
  const [screen, setScreen] = useState<'console' | 'settings'>('console');
  const params = { organizationId, workspaceId };
  return screen === 'console' ? (
    <QueueConsolePage params={params} onOpenSettings={() => setScreen('settings')} />
  ) : (
    <QueueSettingsPage params={params} onBack={() => setScreen('console')} />
  );
}
