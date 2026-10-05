import type { NotificationSender } from '@kwtech/module-notification/server';
import type { TaskDueNotice, TaskNotice, TaskNotifier } from '@kwtech/module-task/server';

/**
 * `module-task`'s notifier, spoken as notifications (`module-notification`'s
 * recipe). The module says what happened — somebody was assigned, somebody
 * commented, a task is due today — and this chooses the words, the severity
 * and the source.
 *
 * ⚠ The TITLE carries the task's title, and a task's recipients are always
 * people who can open its board: a private board's tasks are assigned only to
 * its owner, and the owner is never told about their own act.
 *
 * The button opens the workspace's Apps page: there is no link to one task yet
 * (a sub-app has no route of its own — PLAN §12.80's gap, for tasks too).
 */
export class TaskNotifierAdapter implements TaskNotifier {
  constructor(private readonly sender: NotificationSender) {}

  async assigned(event: TaskNotice): Promise<void> {
    await this.sender.sendSafely({
      recipientIds: event.recipientIds,
      severity: 'info',
      title: `You were assigned “${event.taskTitle}”`,
      body: `On the board ${event.boardName}.`,
      source: 'task.assigned',
      context: { scope: 'workspace', organizationId: event.organizationId, workspaceId: event.workspaceId },
      actions: [{ kind: 'link', key: 'open', label: 'Open tasks', href: appsHref(event), target: 'self' }],
    });
  }

  async commented(event: TaskNotice & { commentPreview: string }): Promise<void> {
    await this.sender.sendSafely({
      recipientIds: event.recipientIds,
      severity: 'info',
      title: `New comment on “${event.taskTitle}”`,
      body: event.commentPreview,
      source: 'task.comment',
      context: { scope: 'workspace', organizationId: event.organizationId, workspaceId: event.workspaceId },
      actions: [{ kind: 'link', key: 'open', label: 'Open tasks', href: appsHref(event), target: 'self' }],
      // A busy thread folds into one unread row per task.
      group: { key: `task:${event.taskId}:comments`, title: `{count} new comments on “${event.taskTitle}”` },
    });
  }

  /**
   * Sent by the `task.due_today` background process, not by a person. `warning`
   * rather than `info`: it is the one task notice that asks for something
   * today. No day in the words — "today" is the workspace's own, and the
   * process only sends this on it.
   */
  async dueToday(event: TaskDueNotice): Promise<void> {
    await this.sender.sendSafely({
      recipientIds: event.recipientIds,
      severity: 'warning',
      title: `Due today: “${event.taskTitle}”`,
      body: `On the board ${event.boardName}.`,
      source: 'task.due',
      context: { scope: 'workspace', organizationId: event.organizationId, workspaceId: event.workspaceId },
      actions: [{ kind: 'link', key: 'open', label: 'Open tasks', href: appsHref(event), target: 'self' }],
    });
  }
}

/**
 * The workspace's Apps page — `module-app-hub`'s `appHubHref`, restated because
 * the app's server may not import a module's React entry point.
 */
function appsHref(event: Pick<TaskNotice, 'organizationId' | 'workspaceId'>): string {
  return `/organizations/${encodeURIComponent(event.organizationId)}/workspaces/${encodeURIComponent(event.workspaceId)}/apps`;
}
