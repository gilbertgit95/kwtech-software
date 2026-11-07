import { LIMIT } from '@kwtech/module-permissions';
import type { BillingPlan, PlatformBillingPlans } from '@kwtech/module-platform-billing/server';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Plans and how much of each cap an organization uses, for billing (D6). Both
 * are `module-permissions`' tables, so the app answers.
 *
 * ⚠ USAGE COUNTS ONLY THE CAPS PERMISSIONS' OWN TABLES HOLD: members and
 * workspaces of the organization, and the largest workspace's members. A
 * sub-app's caps (queue windows, notes per person) are counted in that
 * module's tables, and a downgrade is not refused on them yet — it stays
 * allowed, and what is over a cap stays, with only additions refused (D6).
 * PLAN §12 records the gap.
 */
@Injectable()
export class PlatformBillingPlansAdapter implements PlatformBillingPlans {
  constructor(private readonly prisma: PrismaService) {}

  async plans(): Promise<readonly BillingPlan[]> {
    const rows = await this.prisma.permPlan.findMany({
      select: {
        key: true,
        label: true,
        isPublic: true,
        archivedAt: true,
        features: { select: { featureKey: true } },
        limits: { select: { limitKey: true, value: true } },
      },
      orderBy: { key: 'asc' },
    });
    return rows.map((row) => ({
      key: row.key,
      label: row.label,
      isPublic: row.isPublic,
      archived: row.archivedAt !== null,
      features: row.features.map((feature) => feature.featureKey),
      limits: Object.fromEntries(row.limits.map((limit) => [limit.limitKey, limit.value])),
    }));
  }

  async usage(organizationId: string): Promise<Readonly<Record<string, number>>> {
    const [members, workspaces, perWorkspace] = await Promise.all([
      this.prisma.permMembership.count({ where: { organizationId, status: 'active' } }),
      this.prisma.permWorkspace.count({ where: { organizationId, archivedAt: null } }),
      this.prisma.permWorkspaceMember.groupBy({
        by: ['workspaceId'],
        where: { workspace: { organizationId, archivedAt: null } },
        _count: { _all: true },
      }),
    ]);
    const largest = perWorkspace.reduce((most, group) => Math.max(most, group._count._all), 0);
    return {
      [LIMIT.organizationMembers]: members,
      [LIMIT.organizationWorkspaces]: workspaces,
      [LIMIT.workspaceMembers]: largest,
    };
  }
}
