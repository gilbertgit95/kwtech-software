import type { PosFeatureKey } from '@kwtech/module-basic-pos';
import type { PosAccessCheck } from '@kwtech/module-basic-pos/server';
import { canAccessWorkspace } from '@kwtech/module-permissions';
import { PermissionsService } from '@kwtech/module-permissions/server';
import { Injectable } from '@nestjs/common';

/**
 * `module-basic-pos`'s key checks, answered by the permissions module —
 * `TaskKeyAccess`'s arrangement.
 *
 * The POS asks where a key changes WHAT an operation returns or keeps — are
 * costs in this answer, does a fixed discount survive this edit — and cannot
 * ask itself: grants are `module-permissions`' tables, and neither module may
 * import the other (PLAN §9).
 */
@Injectable()
export class PosKeyAccess implements PosAccessCheck {
  constructor(private readonly permissions: PermissionsService) {}

  /**
   * ⚠ BOTH questions the guard would ask, in the guard's order: may this person
   * be IN the workspace, and does their resolved context — after the plan filter
   * — carry the key there. A key the organization's plan does not sell is a key
   * nobody holds.
   */
  async holds(organizationId: string, workspaceId: string, userId: string, key: PosFeatureKey): Promise<boolean> {
    const context = await this.permissions.loadContext(userId, { organizationId, workspaceId });
    if (!context || !canAccessWorkspace(context, workspaceId)) return false;
    return context.effective.includes(key);
  }
}
