import type { JobsEntitledWorkspaces } from '@kwtech/module-jobs/server';
import type { ProcessWorkspacePage } from '@kwtech/module-kit';
import { APP_DEFAULT } from '@kwtech/module-permissions';
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
 * ENTITLEMENTS, as one query: an `active` subscription IN FORCE (`accessUntil`
 * ahead or open-ended, #92), to a plan that is not archived, carrying the
 * feature, the feature not deprecated — held by the organization as a whole
 * (`workspaceId: null`) or by this workspace. And, as there, an organization
 * with NO organization-wide subscription in force falls back to the
 * `organization.fallback_plan` default (Free, PLAN §12.131) when that plan
 * sells the feature. If that rule changes there, it changes here: a reminder
 * must never reach a workspace whose people would be refused the app, nor miss
 * one whose people may use it. (#94 found this adapter still on the rule from
 * before #92: it reached expired organizations, and missed Free ones.)
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
    const now = new Date();
    const inForce = {
      status: 'active' as const,
      OR: [{ accessUntil: null }, { accessUntil: { gt: now } }],
    };
    const sells = {
      ...inForce,
      plan: { archivedAt: null, features: { some: { featureKey, feature: { deprecatedAt: null } } } },
    };
    const fallbackSells = await this.fallbackSells(featureKey);
    const rows = await this.prisma.permWorkspace.findMany({
      where: {
        archivedAt: null,
        ...(cursor === null ? {} : { id: { gt: cursor } }),
        OR: [
          { organization: { subscriptions: { some: { ...sells, workspaceId: null } } } },
          { subscriptions: { some: sells } },
          // No organization-wide subscription in force: the fallback plan applies, if it sells this.
          ...(fallbackSells
            ? [
                {
                  organization: {
                    subscriptions: { none: { ...inForce, workspaceId: null, plan: { archivedAt: null } } },
                  },
                },
              ]
            : []),
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

  /** Whether the fallback plan (`organization.fallback_plan`) is live and sells `featureKey`. Unset: no. */
  private async fallbackSells(featureKey: string): Promise<boolean> {
    const row = await this.prisma.permDefault.findFirst({
      where: { key: APP_DEFAULT.organizationFallbackPlan },
      select: { value: true },
    });
    if (!row?.value) return false;
    const plan = await this.prisma.permPlan.findFirst({
      where: {
        key: row.value,
        archivedAt: null,
        features: { some: { featureKey, feature: { deprecatedAt: null } } },
      },
      select: { key: true },
    });
    return plan !== null;
  }
}
