'use client';

import { useHoldsFeature } from '@kwtech/module-kit/react';
import { QUEUE_FEATURE } from '../../feature-keys.js';
import { MyWindowPanel } from '../components/my-window-panel.js';
import { NicknameField } from '../components/nickname-field.js';
import { SessionPanel } from '../components/session-panel.js';
import { buttonClass, ErrorBanner, QueuePage } from '../components/ui.js';
import { WindowsOverview } from '../components/windows-overview.js';
import { queueSettingsHref } from '../routes.js';
import { useQueueConsole } from '../use-queue-console.js';

/**
 * `/organizations/:organizationId/workspaces/:workspaceId/queue` — the console.
 *
 * Ordered by how often each part is touched: whether queuing is running (and
 * the code, for whoever starts it), my window with Call next, then every window
 * and the recent calls. Every control is also refused at the API; hiding one
 * is an affordance, not the check.
 */
export function QueueConsolePage({ params }: { params: Record<string, string> }) {
  const organizationId = params.organizationId ?? '';
  const workspaceId = params.workspaceId ?? '';
  const state = useQueueConsole(organizationId, workspaceId);
  const canServe = useHoldsFeature(QUEUE_FEATURE.serve);
  // Each hook unconditionally, in the same order every render — then combined.
  const canManage = useHoldsFeature(QUEUE_FEATURE.manageWindows);
  const canAssign = useHoldsFeature(QUEUE_FEATURE.assignWindows);
  const canStart = useHoldsFeature(QUEUE_FEATURE.start);
  const canConfigure = canManage || canAssign || canStart;

  return (
    <QueuePage
      title="Queue"
      {...(state.live
        ? {}
        : {
            description: 'Live updates are off in this browser — this page refreshes when you act, not when others do.',
          })}
      actions={
        canConfigure ? (
          <a href={queueSettingsHref(organizationId, workspaceId)} className={buttonClass('secondary')}>
            Queue settings
          </a>
        ) : null
      }
    >
      <ErrorBanner message={state.error} onDismiss={state.dismissError} />
      {state.view === null && state.error === null ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      <SessionPanel state={state} />
      <MyWindowPanel state={state} />
      {canServe ? <NicknameField state={state} /> : null}
      <WindowsOverview state={state} />
    </QueuePage>
  );
}
