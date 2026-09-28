import { canAccessWorkspace } from '@kwtech/module-permissions';
import { PermissionsService } from '@kwtech/module-permissions/server';
import { TASK_FEATURE } from '@kwtech/module-task';
import type { TaskAccessCheck } from '@kwtech/module-task/server';
import { Injectable } from '@nestjs/common';

/**
 * `module-task`'s `task:assign` and `task:manage_all` checks, answered by the
 * permissions module — `NoteManageAllAccess`'s arrangement, for two keys.
 *
 * Tasks decide that assigning somebody else, or deleting somebody else's task
 * or comment, needs a key, and cannot ask: grants are `module-permissions`'
 * tables, and neither module may import the other (PLAN §9).
 */
@Injectable()
export class TaskKeyAccess implements TaskAccessCheck {
  constructor(private readonly permissions: PermissionsService) {}

  async holdsAssign(organizationId: string, workspaceId: string, userId: string): Promise<boolean> {
    return this.holds(organizationId, workspaceId, userId, TASK_FEATURE.assign);
  }

  async holdsManageAll(organizationId: string, workspaceId: string, userId: string): Promise<boolean> {
    return this.holds(organizationId, workspaceId, userId, TASK_FEATURE.manageAll);
  }

  /**
   * ⚠ BOTH questions the guard would ask, in the guard's order: may this person
   * be IN the workspace, and does their resolved context — after the plan filter
   * — carry the key there. A key the organization's plan does not sell is a key
   * nobody holds. Asked only when it decides something, never on a read.
   */
  private async holds(organizationId: string, workspaceId: string, userId: string, key: string): Promise<boolean> {
    const context = await this.permissions.loadContext(userId, { organizationId, workspaceId });
    if (!context || !canAccessWorkspace(context, workspaceId)) return false;
    return context.effective.includes(key);
  }
}
