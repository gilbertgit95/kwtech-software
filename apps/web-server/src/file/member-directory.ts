import { FILE_FEATURE } from '@kwtech/module-file-manager';
import type { FileMember, FileMemberDirectory } from '@kwtech/module-file-manager/server';
import { canAccessWorkspace } from '@kwtech/module-permissions';
import { PermissionsService } from '@kwtech/module-permissions/server';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Who a file can be shared with, and names — `TaskMemberDirectoryAdapter`'s
 * reasoning: it composes workspace membership (`module-permissions`), whether
 * each member holds `file:read` (the permissions context, plan applied), and
 * account names (`auth_user`, which `module-auth` owns).
 *
 * ⚠ `file:read`, not `file:write`: somebody who can open the app can see a
 * file shared with them, and that is all being shared with needs.
 */
@Injectable()
export class FileMemberDirectoryAdapter implements FileMemberDirectory {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * ⚠ One permission context per member, so it is CAPPED. It runs when
   * somebody opens the app with `file:write`, or shares with chosen people,
   * never on a hot path, and a workspace's members are bounded by the seat cap.
   */
  async listShareable(organizationId: string, workspaceId: string): Promise<readonly FileMember[]> {
    const members = await this.activeMemberIds(organizationId, workspaceId);
    const eligible: string[] = [];
    // One at a time: each loads a permission context, and a burst would hold that many connections at once.
    for (const userId of members) {
      const context = await this.permissions.loadContext(userId, { organizationId, workspaceId });
      if (context && canAccessWorkspace(context, workspaceId) && context.effective.includes(FILE_FEATURE.read)) {
        eligible.push(userId);
      }
    }
    return this.describe(eligible);
  }

  async describe(userIds: readonly string[]): Promise<readonly FileMember[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.authUser.findMany({
      where: { id: { in: [...new Set(userIds)].slice(0, MAX_MEMBER_LOOKUP) } },
      select: { id: true, displayName: true, username: true },
    });
    return rows
      .map((row) => ({ userId: row.id, displayName: row.displayName ?? row.username ?? row.id }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  /** Members of a live workspace who are active in its organization. An archived workspace has none. */
  private async activeMemberIds(organizationId: string, workspaceId: string): Promise<string[]> {
    const detail = await this.permissions.listWorkspaceDetail(organizationId, workspaceId);
    if (!detail || detail.workspace.archived) return [];
    const active = new Set(
      detail.organizationMembers.filter((member) => member.status === 'active').map((member) => member.userId),
    );
    return detail.workspace.members
      .map((member) => member.userId)
      .filter((userId) => userId !== '' && active.has(userId))
      .slice(0, MAX_MEMBER_LOOKUP);
  }
}

/** The same number, and the same argument, as the task and queue directories. */
const MAX_MEMBER_LOOKUP = 200;
