import type { BooksFeatureKey } from '@kwtech/module-basic-bookkeeping';
import type { BooksAccessCheck } from '@kwtech/module-basic-bookkeeping/server';
import { canAccessWorkspace } from '@kwtech/module-permissions';
import { PermissionsService } from '@kwtech/module-permissions/server';
import { Injectable } from '@nestjs/common';

/**
 * `module-basic-bookkeeping`'s key check, answered by the permissions module —
 * `PosKeyAccess`'s arrangement.
 *
 * The books ask where an operation is bound to one key but what it touches
 * needs another — voiding an investor's payout runs under `books:record` and
 * needs `books:manage_investors` too — and cannot ask themselves: grants are
 * `module-permissions`' tables, and neither module may import the other
 * (PLAN §9).
 */
@Injectable()
export class BooksKeyAccess implements BooksAccessCheck {
  constructor(private readonly permissions: PermissionsService) {}

  /**
   * ⚠ BOTH questions the guard would ask, in the guard's order: may this person
   * be IN the workspace, and does their resolved context — after the plan filter
   * — carry the key there.
   */
  async holds(organizationId: string, workspaceId: string, userId: string, key: BooksFeatureKey): Promise<boolean> {
    const context = await this.permissions.loadContext(userId, { organizationId, workspaceId });
    if (!context || !canAccessWorkspace(context, workspaceId)) return false;
    return context.effective.includes(key);
  }
}
