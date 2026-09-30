import type { PosWorkspaceTimeZone } from '@kwtech/module-basic-pos/server';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * The workspace's time zone for the POS — which day a sale belongs to — read
 * from `perm_workspace`, which module-permissions owns and the POS may not read
 * (PLAN §9). The member directories read `auth_user` the same way.
 *
 * ⚠ SCOPED BY ORGANIZATION as well as id, so a workspace id from another
 * tenant answers nothing rather than that tenant's zone. Null falls to the
 * module's default (Asia/Manila).
 */
@Injectable()
export class PosWorkspaceTimeZoneAdapter implements PosWorkspaceTimeZone {
  constructor(private readonly prisma: PrismaService) {}

  async timeZoneOf(organizationId: string, workspaceId: string): Promise<string | null> {
    const workspace = await this.prisma.permWorkspace.findFirst({
      where: { id: workspaceId, organizationId },
      select: { timeZone: true },
    });
    return workspace?.timeZone ?? null;
  }
}
