import type { QueueWorkspaceLocation, QueueWorkspaceLocator } from '@kwtech/module-queuing-window/server';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Organization and workspace KEYS → ids, for the public display URL.
 *
 * App-side because both keys are `module-permissions`' columns and the queue
 * may not import it (PLAN §9). A read of two unique keys, so it needs no
 * service — the same way `ChatUserDirectory` reads `auth_user`.
 *
 * ⚠ If either key ever becomes renamable, every TV URL for that tenant breaks.
 */
@Injectable()
export class QueueWorkspaceLocatorAdapter implements QueueWorkspaceLocator {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ⚠ NULL FOR EVERY MISS — unknown organization, unknown workspace, archived
   * workspace — so the public page cannot tell them apart. See
   * `QueueDisplayService.openDisplay`.
   */
  async locate(organizationKey: string, workspaceKey: string): Promise<QueueWorkspaceLocation | null> {
    const organization = await this.prisma.permOrganization.findUnique({
      where: { key: organizationKey },
      select: { id: true },
    });
    if (!organization) return null;

    const workspace = await this.prisma.permWorkspace.findUnique({
      where: { organizationId_key: { organizationId: organization.id, key: workspaceKey } },
      select: { id: true, name: true, archivedAt: true },
    });
    if (!workspace || workspace.archivedAt) return null;

    return { organizationId: organization.id, workspaceId: workspace.id, workspaceName: workspace.name };
  }

  /**
   * Ids → keys, for the display link the console shows to holders of
   * `queue:start`. Scoped by BOTH ids, so a workspace id from another tenant
   * finds nothing.
   */
  async keysFor(
    organizationId: string,
    workspaceId: string,
  ): Promise<{ organizationKey: string; workspaceKey: string } | null> {
    const workspace = await this.prisma.permWorkspace.findFirst({
      where: { id: workspaceId, organizationId },
      select: { key: true, organization: { select: { key: true } } },
    });
    return workspace ? { organizationKey: workspace.organization.key, workspaceKey: workspace.key } : null;
  }
}
