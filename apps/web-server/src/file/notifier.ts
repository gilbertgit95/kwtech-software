import type { FileNotifier, FileSharedNotice } from '@kwtech/module-file-manager/server';
import type { NotificationSender } from '@kwtech/module-notification/server';

/**
 * `module-file-manager`'s notifier, spoken as notifications
 * (`module-notification`'s recipe): somebody shared a file with you by name.
 *
 * ⚠ The TITLE carries the file's name, and the recipients are exactly the
 * people the file was just shared with — who can see it — never the person
 * who shared it. Sharing with the whole workspace tells nobody: a notice to
 * everybody for every upload would be noise.
 *
 * The button opens the workspace's Apps page: a sub-app has no route of its
 * own (PLAN §12.80's gap, for files too).
 */
export class FileNotifierAdapter implements FileNotifier {
  constructor(private readonly sender: NotificationSender) {}

  async shared(event: FileSharedNotice): Promise<void> {
    await this.sender.sendSafely({
      recipientIds: event.recipientIds,
      severity: 'info',
      title: `A file was shared with you: “${event.fileName}”`,
      body: 'It is in Files. Like every file there, it is deleted by the nightly clean-up.',
      source: 'file.shared',
      context: { scope: 'workspace', organizationId: event.organizationId, workspaceId: event.workspaceId },
      actions: [{ kind: 'link', key: 'open', label: 'Open files', href: appsHref(event), target: 'self' }],
    });
  }
}

/** The workspace's Apps page — `module-app-hub`'s `appHubHref`, restated: the server may not import a module's React. */
function appsHref(event: Pick<FileSharedNotice, 'organizationId' | 'workspaceId'>): string {
  return `/organizations/${encodeURIComponent(event.organizationId)}/workspaces/${encodeURIComponent(event.workspaceId)}/apps`;
}
