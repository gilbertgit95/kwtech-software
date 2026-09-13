import { PermissionsService } from '@kwtech/module-permissions/server';
import type { QueueStaffDirectory, QueueStaffMember } from '@kwtech/module-queuing-window/server';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueueStaffAccess } from './staff-check.js';

/**
 * Who a window can be assigned to, and names for the console.
 *
 * ## Why it lives here
 *
 * It composes three things no module has together: workspace membership
 * (`module-permissions`), whether each member can serve (the permissions
 * context), and their names (`auth_user`, which `module-auth` owns). The same
 * reason `ChatUserDirectory` is app-side.
 *
 * ⚠ These are ACCOUNT names, shown to staff on the console. The queue module
 * never puts one on a public display — only a nickname the person chose.
 */
@Injectable()
export class QueueStaffDirectoryAdapter implements QueueStaffDirectory {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly prisma: PrismaService,
    private readonly staff: QueueStaffAccess,
  ) {}

  /**
   * Active members of the workspace who can serve there.
   *
   * ⚠ One permission context per member, so it is CAPPED. It runs when an
   * assigner opens the picker, never on a hot path, and a workspace's members
   * are themselves bounded by the plan's seat cap.
   */
  async listServers(organizationId: string, workspaceId: string): Promise<readonly QueueStaffMember[]> {
    const detail = await this.permissions.listWorkspaceDetail(organizationId, workspaceId);
    if (!detail || detail.workspace.archived) return [];

    const active = new Set(
      detail.organizationMembers.filter((member) => member.status === 'active').map((member) => member.userId),
    );
    const members = detail.workspace.members
      .map((member) => member.userId)
      .filter((userId) => userId !== '' && active.has(userId))
      .slice(0, MAX_STAFF_LOOKUP);

    const eligible: string[] = [];
    for (const userId of members) {
      if (await this.staff.canServe(organizationId, workspaceId, userId)) eligible.push(userId);
    }
    return this.describe(eligible);
  }

  async describe(userIds: readonly string[]): Promise<readonly QueueStaffMember[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.authUser.findMany({
      where: { id: { in: [...new Set(userIds)].slice(0, MAX_STAFF_LOOKUP) } },
      select: { id: true, displayName: true, username: true },
    });
    return rows
      .map((row) => ({ userId: row.id, displayName: row.displayName ?? row.username ?? row.id }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
}

/** The same number, and the same argument, as `users.resolver.ts`'s. */
const MAX_STAFF_LOOKUP = 200;
