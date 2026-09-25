'use client';

import type { NotificationView } from '../../notification-client.js';
import { type ComposeDraft, composeButton } from '../../view/compose-view.js';
import { NotificationItem } from '../notification-item.js';
import { ToastCard } from '../toast-stack.js';

/**
 * What the recipient will see, as they will see it: the pop-up and the row in
 * their inbox. Drawn with the SAME components the recipient's screen uses, so
 * the preview cannot say one thing while the real toast says another.
 */
export function NotificationPreview({ draft, now }: { draft: ComposeDraft; now: Date }) {
  const title = draft.title.trim() || 'Your title appears here';
  const body = draft.body.trim() || null;
  const button = composeButton(draft);
  const external = button.linkHref !== null && !button.linkHref.startsWith('/');

  const item: NotificationView = {
    id: 'preview',
    severity: draft.severity,
    title,
    body,
    source: 'platform',
    sourceLabel: 'Platform',
    organizationId: null,
    workspaceId: null,
    contextLabel: null,
    actions: button.linkHref
      ? [
          {
            kind: 'link',
            key: 'open',
            label: button.linkLabel ?? 'Open',
            href: button.linkHref,
            target: external ? 'blank' : 'self',
            filename: null,
          },
        ]
      : [],
    groupCount: 1,
    createdAt: now.toISOString(),
    occurredAt: now.toISOString(),
    readAt: null,
    archivedAt: null,
    expiresAt: null,
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Pop-up</p>
        {/* `inert`: the preview's link must not navigate away from a half-written message. */}
        <div inert className={draft.title.trim() ? undefined : 'opacity-60'}>
          <ToastCard
            toast={{ severity: draft.severity, title, body, sourceLabel: 'Platform', contextLabel: null, href: null }}
          />
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">In their inbox</p>
        <div inert className="overflow-hidden rounded-lg border border-border bg-card">
          <NotificationItem item={item} now={now} compact />
        </div>
      </div>
    </div>
  );
}
