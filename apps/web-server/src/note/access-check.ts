import { NOTE_FEATURE } from '@kwtech/module-note';
import type { NoteAccessCheck } from '@kwtech/module-note/server';
import { canAccessWorkspace } from '@kwtech/module-permissions';
import { PermissionsService } from '@kwtech/module-permissions/server';
import { Injectable } from '@nestjs/common';

/**
 * `module-note`'s `note:manage_all` check, answered by the permissions module.
 *
 * ## Why it lives here and can live nowhere else
 *
 * Notes decide that trashing somebody ELSE's shared note needs
 * `note:manage_all`, and cannot ask: grants are `module-permissions`' tables,
 * and neither module may import the other (PLAN §9). The app depends on both,
 * so the app answers — the same arrangement as `QueueStaffAccess`.
 */
@Injectable()
export class NoteManageAllAccess implements NoteAccessCheck {
  constructor(private readonly permissions: PermissionsService) {}

  /**
   * ⚠ BOTH questions the guard would ask, in the guard's order: may this person
   * be IN the workspace, and does their resolved context — after the plan filter
   * — carry `note:manage_all` there. A key the organization's plan does not sell
   * is a key nobody holds.
   *
   * One context load, asked only when the module is about to bin somebody
   * else's shared note — never on a read.
   */
  async holdsManageAll(organizationId: string, workspaceId: string, userId: string): Promise<boolean> {
    const context = await this.permissions.loadContext(userId, { organizationId, workspaceId });
    if (!context || !canAccessWorkspace(context, workspaceId)) return false;
    return context.effective.includes(NOTE_FEATURE.manageAll);
  }
}
