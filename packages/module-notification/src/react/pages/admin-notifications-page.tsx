'use client';

import { useHoldsFeature } from '@kwtech/module-kit/react';
import { cn } from '@kwtech/web-ui/react';
import { useMemo, useState } from 'react';
import { NOTIFICATION_FEATURE } from '../../feature-keys.js';
import { ComposePanel } from '../components/admin/compose-panel.js';
import { SentPanel } from '../components/admin/sent-panel.js';
import { NotificationIcon } from '../components/notification-icons.js';
import { createNotificationClient, type NotificationClient } from '../notification-client.js';

type Tab = 'compose' | 'sent';

const TABS: ReadonlyArray<{ tab: Tab; label: string; icon: 'compose' | 'history' }> = [
  { tab: 'compose', label: 'Compose', icon: 'compose' },
  { tab: 'sent', label: 'Sent', icon: 'history' },
];

/**
 * `/admin/notifications` — telling chosen people something, AS THE PLATFORM,
 * and following what was sent.
 *
 * ⚠ The recipient reads "Platform", never who pressed send; that is recorded on
 * the send for the Sent list. Anything personal belongs in chat, and the
 * preview says so.
 */
export function AdminNotificationsPage({ client: given }: { client?: NotificationClient } = {}) {
  const client = useMemo(() => given ?? createNotificationClient(), [given]);
  const canRecall = useHoldsFeature(NOTIFICATION_FEATURE.manage);
  const [tab, setTab] = useState<Tab>('compose');
  const [sentVersion, setSentVersion] = useState(0);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <NotificationIcon name="bell" className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
            <p className="text-sm text-muted-foreground">
              Send a notification to chosen people as the platform, and follow what was sent.
            </p>
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Notifications"
          className="inline-flex rounded-lg border border-border bg-muted/40 p-1"
        >
          {TABS.map((option) => (
            <button
              key={option.tab}
              type="button"
              role="tab"
              id={`notifications-tab-${option.tab}`}
              aria-selected={tab === option.tab}
              aria-controls={`notifications-panel-${option.tab}`}
              onClick={() => setTab(option.tab)}
              className={cn(
                'inline-flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                tab === option.tab
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <NotificationIcon name={option.icon} className="size-4" />
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {/*
        Both panels stay mounted and the other one is `hidden`, so a half-written
        message survives a look at the Sent list.
      */}
      <div
        role="tabpanel"
        id="notifications-panel-compose"
        aria-labelledby="notifications-tab-compose"
        hidden={tab !== 'compose'}
      >
        <ComposePanel
          client={client}
          onSent={() => setSentVersion((version) => version + 1)}
          onViewSent={() => setTab('sent')}
        />
      </div>
      <div
        role="tabpanel"
        id="notifications-panel-sent"
        aria-labelledby="notifications-tab-sent"
        hidden={tab !== 'sent'}
      >
        <SentPanel client={client} canRecall={canRecall} onCompose={() => setTab('compose')} refreshKey={sentVersion} />
      </div>
    </div>
  );
}
