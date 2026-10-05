import { canAccessWorkspace } from '@kwtech/module-permissions';
import { PermissionsService } from '@kwtech/module-permissions/server';
import { STUDIO_FEATURE } from '@kwtech/module-print-studio';
import type { StudioAccessCheck } from '@kwtech/module-print-studio/server';
import { Injectable } from '@nestjs/common';

/**
 * `module-print-studio`'s `studio:manage_all` check, answered by the
 * permissions module.
 *
 * ## Why it lives here and can live nowhere else
 *
 * The studio decides that changing somebody ELSE's shared layout, and reading
 * everybody's print history, needs `studio:manage_all` — and cannot ask: grants
 * are `module-permissions`' tables, and neither module may import the other
 * (PLAN §9). The app depends on both, so the app answers — the same
 * arrangement as `NoteManageAllAccess`.
 */
@Injectable()
export class StudioManageAllAccess implements StudioAccessCheck {
  constructor(private readonly permissions: PermissionsService) {}

  /**
   * ⚠ BOTH questions the guard would ask, in the guard's order: may this person
   * be IN the workspace, and does their resolved context — after the plan filter
   * — carry `studio:manage_all` there. A key the organization's plan does not
   * sell is a key nobody holds.
   *
   * One context load, asked only when the answer decides something — never on
   * the common path of somebody working with their own layouts.
   */
  async holdsManageAll(organizationId: string, workspaceId: string, userId: string): Promise<boolean> {
    const context = await this.permissions.loadContext(userId, { organizationId, workspaceId });
    if (!context || !canAccessWorkspace(context, workspaceId)) return false;
    return context.effective.includes(STUDIO_FEATURE.manageAll);
  }
}
