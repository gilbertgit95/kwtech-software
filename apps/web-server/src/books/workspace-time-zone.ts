import type { BooksWorkspaceTimeZone } from '@kwtech/module-basic-bookkeeping/server';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * The workspace's time zone for the books — which day "today" is, so nothing is
 * dated in the future — read from `perm_workspace`, which module-permissions
 * owns and the books may not read (PLAN §9). The POS's adapter, for the books.
 *
 * ⚠ SCOPED BY ORGANIZATION as well as id, so a workspace id from another
 * tenant answers nothing rather than that tenant's zone. Null falls to the
 * module's default (Asia/Manila).
 */
@Injectable()
export class BooksWorkspaceTimeZoneAdapter implements BooksWorkspaceTimeZone {
  constructor(private readonly prisma: PrismaService) {}

  async timeZoneOf(organizationId: string, workspaceId: string): Promise<string | null> {
    const workspace = await this.prisma.permWorkspace.findFirst({
      where: { id: workspaceId, organizationId },
      select: { timeZone: true },
    });
    return workspace?.timeZone ?? null;
  }
}
