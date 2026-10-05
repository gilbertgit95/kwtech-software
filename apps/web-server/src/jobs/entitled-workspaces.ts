import type { JobsEntitledWorkspaces } from '@kwtech/module-jobs/server';
import type { ProcessWorkspacePage } from '@kwtech/module-kit';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Which workspaces a background process may reach: those of organizations
 * whose PLAN includes the feature it serves (JOBS-PLAN D12).
 *
 * App-side because plans and subscriptions are `module-permissions`' tables and
 * the runner may not import it (PLAN §9). A read of other modules' rows, so it
 * needs no service — as `QueueWorkspaceLocatorAdapter` reads two keys.
 *
 * ⚠ THE SAME TEST `PermissionsService.loadContext` APPLIES TO A PERSON'S
 * ENTITLEMENTS, as one query: an `active` subscription, to a plan that is not
 * archived, carrying the feature, the feature not deprecated — held by the
 * organization as a whole (`workspaceId: null`) or by this workspace. If that
 * rule changes there, it changes here: a reminder must never reach a workspace
 * whose people would be refused the app.
 *
 * ⚠ ENTITLEMENT ONLY. No grant is read: a run is the application acting, and
 * there is no user whose roles to ask about. App-level roles bypass the plan
 * filter for a PERSON; nothing bypasses it for a process.
 *
 * Archived workspaces are left out. Ordered by id, and the cursor is the last
 * id, so pages are stable while workspaces come and go.
 */
@Injectable()
export class JobsEntitledWorkspacesAdapter implements JobsEntitledWorkspaces {
  constructor(private readonly prisma: PrismaService) {}

  async page(featureKey: string, cursor: string | null, limit: number): Promise<ProcessWorkspacePage> {
    const sells = {
      status: 'active' as const,
      plan: { archivedAt: null, features: { some: { featureKey, feature: { deprecatedAt: null } } } },
    };
    const rows = await this.prisma.permWorkspace.findMany({
      where: {
        archivedAt: null,
        ...(cursor === null ? {} : { id: { gt: cursor } }),
        OR: [
          { organization: { subscriptions: { some: { ...sells, workspaceId: null } } } },
          { subscriptions: { some: sells } },
        ],
      },
      select: { id: true, organizationId: true, timeZone: true },
      orderBy: { id: 'asc' },
      // One more than asked, to know whether another page follows without a second query.
      take: limit + 1,
    });

    const page = rows.slice(0, limit);
    return {
      workspaces: page.map((row) => ({
        organizationId: row.organizationId,
        workspaceId: row.id,
        timeZone: row.timeZone,
      })),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }
}
