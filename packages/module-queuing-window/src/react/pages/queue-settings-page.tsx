'use client';

import { useHoldsFeature } from '@kwtech/module-kit/react';
import { QUEUE_FEATURE } from '../../feature-keys.js';
import { AssignmentsSection, DisplaySection, LinesSection, WindowsSection } from '../components/settings-sections.js';
import { ErrorBanner, QueuePage } from '../components/ui.js';
import { queueConsoleHref } from '../routes.js';
import { useQueueConsole } from '../use-queue-console.js';

/**
 * `…/queue/settings` — lines, windows, assignments and displays.
 *
 * Unlisted: reached from the console. Gated on `queue:read` like the console,
 * with each section shown only to the key that may change it — following a
 * bookmark here without any of them explains itself instead of refusing.
 */
export function QueueSettingsPage({ params }: { params: Record<string, string> }) {
  const organizationId = params.organizationId ?? '';
  const workspaceId = params.workspaceId ?? '';
  const state = useQueueConsole(organizationId, workspaceId);
  const canManage = useHoldsFeature(QUEUE_FEATURE.manageWindows);
  const canAssign = useHoldsFeature(QUEUE_FEATURE.assignWindows);
  const canStart = useHoldsFeature(QUEUE_FEATURE.start);

  return (
    <QueuePage
      title="Queue settings"
      back={{ href: queueConsoleHref(organizationId, workspaceId), label: 'Back to the queue' }}
    >
      <ErrorBanner message={state.error} onDismiss={state.dismissError} />
      {state.view === null && state.error === null ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {!canManage && !canAssign && !canStart ? (
        <p className="text-sm text-muted-foreground">
          There is nothing here you can change. Lines and windows are managed, and windows assigned, by people whose
          role allows it.
        </p>
      ) : null}
      {canManage ? <LinesSection state={state} /> : null}
      {canManage ? <WindowsSection state={state} /> : null}
      {canAssign ? <AssignmentsSection state={state} /> : null}
      {canStart ? <DisplaySection state={state} /> : null}
    </QueuePage>
  );
}
