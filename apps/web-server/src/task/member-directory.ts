import { canAccessWorkspace } from '@kwtech/module-permissions';
import { PermissionsService } from '@kwtech/module-permissions/server';
import { TASK_FEATURE } from '@kwtech/module-task';
import type { TaskMember, TaskMemberDirectory } from '@kwtech/module-task/server';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Who a task can be assigned to, who is still here, and names.
 *
 * ## Why it lives here
 *
 * It composes three things no module has together: workspace membership
 * (`module-permissions`), whether each member holds `task:write` (the
 * permissions context), and names (`auth_user`, which `module-auth` owns) —
 * `QueueStaffDirectoryAdapter`'s reasoning.
 *
 * ⚠ These are ACCOUNT names, shown to signed-in members of the workspace.
 */
@Injectable()
export class TaskMemberDirectoryAdapter implements TaskMemberDirectory {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Active members of the workspace who hold `task:write` there — somebody
   * assigned work must be able to move it.
   *
   * ⚠ One permission context per member, so it is CAPPED. It runs when
   * somebody opens the picker or assigns, never on a hot path, and a
   * workspace's members are bounded by the plan's seat cap.
   */
  async listAssignable(organizationId: string, workspaceId: string): Promise<readonly TaskMember[]> {
    const members = await this.activeMemberIds(organizationId, workspaceId);
    const eligible: string[] = [];
    // One at a time: each loads a permission context, and a burst of them on a
    // large workspace would hold that many connections at once.
    for (const userId of members) {
      const context = await this.permissions.loadContext(userId, { organizationId, workspaceId });
      if (context && canAccessWorkspace(context, workspaceId) && context.effective.includes(TASK_FEATURE.write)) {
        eligible.push(userId);
      }
    }
    return this.describe(eligible);
  }

  async activeMembers(
    organizationId: string,
    workspaceId: string,
    userIds: readonly string[],
  ): Promise<ReadonlySet<string>> {
    const active = new Set(await this.activeMemberIds(organizationId, workspaceId));
    return new Set(userIds.filter((userId) => active.has(userId)));
  }

  async describe(userIds: readonly string[]): Promise<readonly TaskMember[]> {
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

/** The same number, and the same argument, as the queue's staff directory. */
const MAX_MEMBER_LOOKUP = 200;
