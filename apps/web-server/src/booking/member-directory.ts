import { BOOKING_FEATURE } from '@kwtech/module-booking';
import type { BookingMember, BookingMemberDirectory } from '@kwtech/module-booking/server';
import { canAccessWorkspace } from '@kwtech/module-permissions';
import { PermissionsService } from '@kwtech/module-permissions/server';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Who works the bookings in a workspace, and names.
 *
 * ## Why it lives here
 *
 * It composes three things no module has together: workspace membership
 * (`module-permissions`), whether each member holds
 * `booking:manage_appointments` (the permissions context), and names
 * (`auth_user`, which `module-auth` owns) — `TaskMemberDirectoryAdapter`'s
 * reasoning.
 *
 * ⚠ These are ACCOUNT names, shown to signed-in members of the workspace.
 */
@Injectable()
export class BookingMemberDirectoryAdapter implements BookingMemberDirectory {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Active members of the workspace who hold `booking:manage_appointments`
   * there: who a staff resource may be linked to, and who is told a booking is
   * about to start.
   *
   * ⚠ One permission context per member, so it is CAPPED. It runs when somebody
   * opens the resource form, and once per workspace with a reminder due — not
   * per booking — and a workspace's members are bounded by the plan's seat cap.
   */
  async listDesk(organizationId: string, workspaceId: string): Promise<readonly BookingMember[]> {
    const members = await this.activeMemberIds(organizationId, workspaceId);
    const desk: string[] = [];
    // One at a time: each loads a permission context, and a burst of them on a
    // large workspace would hold that many connections at once.
    for (const userId of members) {
      const context = await this.permissions.loadContext(userId, { organizationId, workspaceId });
      if (
        context &&
        canAccessWorkspace(context, workspaceId) &&
        context.effective.includes(BOOKING_FEATURE.manageAppointments)
      ) {
        desk.push(userId);
      }
    }
    return this.describe(desk);
  }

  async describe(userIds: readonly string[]): Promise<readonly BookingMember[]> {
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
