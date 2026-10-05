import type { BookingWorkspaceTimeZone } from '@kwtech/module-booking/server';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * The workspace's time zone for booking — what 9:00 means there, and which day
 * a booking belongs to — read from `perm_workspace`, which module-permissions
 * owns and booking may not read (PLAN §9). The point of sale's adapter, for
 * booking's port.
 *
 * ⚠ SCOPED BY ORGANIZATION as well as id, so a workspace id from another
 * tenant answers nothing rather than that tenant's zone. Null falls to the
 * module's default (Asia/Manila).
 */
@Injectable()
export class BookingWorkspaceTimeZoneAdapter implements BookingWorkspaceTimeZone {
  constructor(private readonly prisma: PrismaService) {}

  async timeZoneOf(organizationId: string, workspaceId: string): Promise<string | null> {
    const workspace = await this.prisma.permWorkspace.findFirst({
      where: { id: workspaceId, organizationId },
      select: { timeZone: true },
    });
    return workspace?.timeZone ?? null;
  }
}
