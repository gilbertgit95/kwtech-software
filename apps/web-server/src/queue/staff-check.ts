import { canAccessWorkspace } from '@kwtech/module-permissions';
import { PermissionsService } from '@kwtech/module-permissions/server';
import { QUEUE_FEATURE } from '@kwtech/module-queuing-window';
import type { QueueStaffCheck } from '@kwtech/module-queuing-window/server';
import { Injectable } from '@nestjs/common';

/**
 * `module-queuing-window`'s staff check, answered by the permissions module.
 *
 * ## Why it lives here and can live nowhere else
 *
 * The queue decides that only somebody who can SERVE may be assigned a window,
 * and cannot ask: membership and grants are `module-permissions`' tables, and
 * neither module may import the other (PLAN §9). The app depends on both, so
 * the app answers — the same arrangement as `ChatPlatformAdmin`.
 */
@Injectable()
export class QueueStaffAccess implements QueueStaffCheck {
  constructor(private readonly permissions: PermissionsService) {}

  /**
   * ⚠ BOTH questions the guard would ask, in the guard's order: may this person
   * be IN the workspace, and does their resolved context — after the plan filter
   * — carry `queue:serve` there. A person who is a member but whose organization
   * is on the free plan cannot serve, and must not be assigned a window that
   * then refuses every call.
   *
   * One context load per person. Asked when a window is assigned and once per
   * seat when the console loads, both bounded by the window cap.
   */
  async canServe(organizationId: string, workspaceId: string, userId: string): Promise<boolean> {
    const context = await this.permissions.loadContext(userId, { organizationId, workspaceId });
    if (!context || !canAccessWorkspace(context, workspaceId)) return false;
    return context.effective.includes(QUEUE_FEATURE.serve);
  }
}
